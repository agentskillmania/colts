/**
 * @fileoverview MiddlewareExecutor unit tests
 */

import { describe, it, expect, vi } from 'vitest';
import { MiddlewareExecutor } from '../../../src/middleware/executor.js';
import type { AgentMiddleware } from '../../../src/middleware/types.js';
import { createAgentState } from '../../../src/state/index.js';
import { createExecutionState } from '../../../src/execution/index.js';
import type { AdvanceResult } from '../../../src/execution/index.js';

const defaultConfig = {
  name: 'test',
  instructions: 'test',
  tools: [],
};

function makeState() {
  return createAgentState(defaultConfig);
}

function makeExecState() {
  return createExecutionState();
}

function makeAdvanceResult(overrides?: Partial<AdvanceResult>): AdvanceResult {
  return {
    state: makeState(),
    execState: makeExecState(),
    phase: { type: 'completed', answer: 'done' },
    done: true,
    ...overrides,
  };
}

// ─── isEmpty / list ──────────────────────────────────────────────

describe('MiddlewareExecutor', () => {
  it('should report isEmpty when no middlewares', () => {
    const executor = new MiddlewareExecutor([]);
    expect(executor.isEmpty).toBe(true);
    expect(executor.list).toEqual([]);
  });

  it('should expose list of registered middlewares', () => {
    const mw: AgentMiddleware = { name: 'test' };
    const executor = new MiddlewareExecutor([mw]);
    expect(executor.isEmpty).toBe(false);
    expect(executor.list).toHaveLength(1);
    expect(executor.list[0]!.name).toBe('test');
  });

  // ─── beforeAdvance ──────────────────────────────────────────────

  describe('runBeforeAdvance', () => {
    it('should return empty result when all hooks return void', async () => {
      const mw: AgentMiddleware = {
        name: 'observer',
        beforeAdvance: vi.fn().mockResolvedValue(undefined),
      };
      const executor = new MiddlewareExecutor([mw]);

      const result = await executor.runBeforeAdvance({
        state: makeState(),
        execState: makeExecState(),
        fromPhase: { type: 'idle' },
        stepNumber: 0,
      });

      expect(result.stopResult).toBeUndefined();
      expect(result.state).toBeUndefined();
      expect(result.execState).toBeUndefined();
    });

    it('should merge state overrides from multiple middlewares in order', async () => {
      const state1 = createAgentState({ ...defaultConfig, name: 's1' });
      const state2 = createAgentState({ ...defaultConfig, name: 's2' });

      const mw1: AgentMiddleware = {
        name: 'mw1',
        beforeAdvance: vi.fn().mockResolvedValue({ state: state1 }),
      };
      const mw2: AgentMiddleware = {
        name: 'mw2',
        beforeAdvance: vi.fn().mockResolvedValue({ state: state2 }),
      };

      const executor = new MiddlewareExecutor([mw1, mw2]);
      const result = await executor.runBeforeAdvance({
        state: makeState(),
        execState: makeExecState(),
        fromPhase: { type: 'idle' },
        stepNumber: 0,
      });

      // 后者覆盖前者
      expect(result.state).toBe(state2);
    });

    it('should stop immediately when middleware returns stop:true', async () => {
      const mw1: AgentMiddleware = {
        name: 'mw1',
        beforeAdvance: vi.fn().mockResolvedValue({ stop: true as const }),
      };
      const mw2: AgentMiddleware = {
        name: 'mw2',
        beforeAdvance: vi.fn().mockResolvedValue(undefined),
      };

      const executor = new MiddlewareExecutor([mw1, mw2]);
      const result = await executor.runBeforeAdvance({
        state: makeState(),
        execState: makeExecState(),
        fromPhase: { type: 'idle' },
        stepNumber: 0,
      });

      expect(result.stopResult).toBeUndefined();
      // mw2 should NOT have been called
      expect(mw2.beforeAdvance).not.toHaveBeenCalled();
    });

    it('should carry custom result when stop with result', async () => {
      const customResult = makeAdvanceResult({ phase: { type: 'completed', answer: 'blocked' } });

      const mw: AgentMiddleware = {
        name: 'guard',
        beforeAdvance: vi.fn().mockResolvedValue({ stop: true as const, result: customResult }),
      };

      const executor = new MiddlewareExecutor([mw]);
      const result = await executor.runBeforeAdvance({
        state: makeState(),
        execState: makeExecState(),
        fromPhase: { type: 'idle' },
        stepNumber: 0,
      });

      expect(result.stopResult).toBe(customResult);
    });

    it('should skip middlewares without beforeAdvance hook', async () => {
      const mw: AgentMiddleware = { name: 'no-hooks' };
      const executor = new MiddlewareExecutor([mw]);

      const result = await executor.runBeforeAdvance({
        state: makeState(),
        execState: makeExecState(),
        fromPhase: { type: 'idle' },
        stepNumber: 0,
      });

      expect(result.stopResult).toBeUndefined();
      expect(result.state).toBeUndefined();
    });
  });

  // ─── afterAdvance ───────────────────────────────────────────────

  describe('runAfterAdvance', () => {
    it('should run after hooks in reverse order', async () => {
      const order: string[] = [];

      const mw1: AgentMiddleware = {
        name: 'mw1',
        afterAdvance: vi.fn().mockImplementation(async () => {
          order.push('mw1');
        }),
      };
      const mw2: AgentMiddleware = {
        name: 'mw2',
        afterAdvance: vi.fn().mockImplementation(async () => {
          order.push('mw2');
        }),
      };

      const executor = new MiddlewareExecutor([mw1, mw2]);
      await executor.runAfterAdvance({
        state: makeState(),
        execState: makeExecState(),
        result: makeAdvanceResult(),
        stepNumber: 0,
      });

      expect(order).toEqual(['mw2', 'mw1']);
    });

    it('should support stop in after hook', async () => {
      const customResult = makeAdvanceResult({ phase: { type: 'completed', answer: 'replaced' } });

      const mw1: AgentMiddleware = {
        name: 'mw1',
        afterAdvance: vi.fn().mockResolvedValue(undefined),
      };
      const mw2: AgentMiddleware = {
        name: 'mw2',
        afterAdvance: vi.fn().mockResolvedValue({ stop: true as const, result: customResult }),
      };

      const executor = new MiddlewareExecutor([mw1, mw2]);
      const result = await executor.runAfterAdvance({
        state: makeState(),
        execState: makeExecState(),
        result: makeAdvanceResult(),
        stepNumber: 0,
      });

      expect(result.stopResult).toBe(customResult);
      // mw1 is after mw2 in reverse order (mw2 runs first, stops, mw1 never runs)
      expect(mw1.afterAdvance).not.toHaveBeenCalled();
    });
  });

  // ─── Step Hooks ─────────────────────────────────────────────────

  describe('runBeforeStep', () => {
    it('should merge state overrides', async () => {
      const state1 = createAgentState({ ...defaultConfig, name: 's1' });

      const mw: AgentMiddleware = {
        name: 'mw',
        beforeStep: vi.fn().mockResolvedValue({ state: state1 }),
      };

      const executor = new MiddlewareExecutor([mw]);
      const result = await executor.runBeforeStep({
        state: makeState(),
        stepNumber: 3,
      });

      expect(result.stopped).toBe(false);
      expect(result.state).toBe(state1);
    });

    it('should handle stop signal', async () => {
      const mw: AgentMiddleware = {
        name: 'mw',
        beforeStep: vi.fn().mockResolvedValue({ stop: true as const }),
      };

      const executor = new MiddlewareExecutor([mw]);
      const result = await executor.runBeforeStep({
        state: makeState(),
        stepNumber: 0,
      });

      expect(result.stopped).toBe(true);
    });
  });

  describe('runAfterStep', () => {
    it('should run in reverse order', async () => {
      const order: string[] = [];

      const mw1: AgentMiddleware = {
        name: 'mw1',
        afterStep: vi.fn().mockImplementation(async () => {
          order.push('mw1');
        }),
      };
      const mw2: AgentMiddleware = {
        name: 'mw2',
        afterStep: vi.fn().mockImplementation(async () => {
          order.push('mw2');
        }),
      };

      const executor = new MiddlewareExecutor([mw1, mw2]);
      await executor.runAfterStep({
        state: makeState(),
        result: { type: 'done', answer: 'ok', tokens: { input: 0, output: 0 } },
        stepNumber: 0,
      });

      expect(order).toEqual(['mw2', 'mw1']);
    });

    it('should stop immediately when middleware returns stop:true', async () => {
      const mw1: AgentMiddleware = {
        name: 'mw1',
        afterStep: vi.fn().mockResolvedValue(undefined),
      };
      const mw2: AgentMiddleware = {
        name: 'mw2',
        afterStep: vi.fn().mockResolvedValue({ stop: true as const }),
      };

      const executor = new MiddlewareExecutor([mw1, mw2]);
      const result = await executor.runAfterStep({
        state: makeState(),
        result: { type: 'done', answer: 'ok', tokens: { input: 0, output: 0 } },
        stepNumber: 0,
      });

      expect(result.stopped).toBe(true);
      // mw1 runs after mw2 in reverse order, but mw2 stopped the chain
      expect(mw1.afterStep).not.toHaveBeenCalled();
    });

    it('should merge state overrides in afterStep', async () => {
      const overridden = createAgentState({ ...defaultConfig, name: 'after-step-override' });

      const mw: AgentMiddleware = {
        name: 'mw',
        afterStep: vi.fn().mockResolvedValue({ state: overridden }),
      };

      const executor = new MiddlewareExecutor([mw]);
      const result = await executor.runAfterStep({
        state: makeState(),
        result: { type: 'done', answer: 'ok', tokens: { input: 0, output: 0 } },
        stepNumber: 0,
      });

      expect(result.stopped).toBe(false);
      expect(result.state).toBe(overridden);
    });
  });

  // ─── Run Hooks ──────────────────────────────────────────────────

  describe('runBeforeRun', () => {
    it('should handle stop signal', async () => {
      const mw: AgentMiddleware = {
        name: 'mw',
        beforeRun: vi.fn().mockResolvedValue({ stop: true as const }),
      };

      const executor = new MiddlewareExecutor([mw]);
      const result = await executor.runBeforeRun({ state: makeState() });

      expect(result.stopped).toBe(true);
    });

    it('should merge state overrides from multiple middlewares', async () => {
      const state1 = createAgentState({ ...defaultConfig, name: 's1' });
      const state2 = createAgentState({ ...defaultConfig, name: 's2' });

      const mw1: AgentMiddleware = {
        name: 'mw1',
        beforeRun: vi.fn().mockResolvedValue({ state: state1 }),
      };
      const mw2: AgentMiddleware = {
        name: 'mw2',
        beforeRun: vi.fn().mockResolvedValue({ state: state2 }),
      };

      const executor = new MiddlewareExecutor([mw1, mw2]);
      const result = await executor.runBeforeRun({ state: makeState() });

      expect(result.stopped).toBe(false);
      expect(result.state).toBe(state2);
    });
  });

  describe('runAfterRun', () => {
    it('should run in reverse order without stop support', async () => {
      const order: string[] = [];

      const mw1: AgentMiddleware = {
        name: 'mw1',
        afterRun: vi.fn().mockImplementation(async () => {
          order.push('mw1');
        }),
      };
      const mw2: AgentMiddleware = {
        name: 'mw2',
        afterRun: vi.fn().mockImplementation(async () => {
          order.push('mw2');
        }),
      };

      const executor = new MiddlewareExecutor([mw1, mw2]);
      await executor.runAfterRun({
        state: makeState(),
        result: { type: 'success', answer: 'ok', totalSteps: 1, tokens: { input: 0, output: 0 } },
      });

      expect(order).toEqual(['mw2', 'mw1']);
    });
  });

  // ─── Error Handling ─────────────────────────────────────────────

  describe('error propagation', () => {
    it('should propagate errors from middleware hooks', async () => {
      const mw: AgentMiddleware = {
        name: 'failing',
        beforeAdvance: vi.fn().mockRejectedValue(new Error('middleware error')),
      };

      const executor = new MiddlewareExecutor([mw]);
      await expect(
        executor.runBeforeAdvance({
          state: makeState(),
          execState: makeExecState(),
          fromPhase: { type: 'idle' },
          stepNumber: 0,
        })
      ).rejects.toThrow('middleware error');
    });
  });
});
