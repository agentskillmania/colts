/**
 * @fileoverview PhaseRouter unit tests
 *
 * Tests routing logic, handler registration, and error handling.
 */
import { describe, it, expect } from 'vitest';
import { PhaseRouter } from '../../src/execution-engine/router.js';
import type { IPhaseHandler, PhaseHandlerContext } from '../../src/execution-engine/types.js';
import type { AgentState } from '../../src/types.js';
import type { ExecutionState, AdvanceResult } from '../../src/execution.js';
import { createExecutionState } from '../../src/execution.js';

function createMockHandler(phaseType: string, resultPhase?: Partial<AdvanceResult>): IPhaseHandler {
  return {
    canHandle(type: string): boolean {
      return type === phaseType;
    },
    execute(
      _ctx: PhaseHandlerContext,
      state: AgentState,
      execState: ExecutionState
    ): AdvanceResult {
      const phase = { type: phaseType };
      return (
        resultPhase ?? {
          state,
          phase: { type: 'completed', answer: `handled-${phaseType}` },
          done: true,
        }
      );
    },
  };
}

function createMockState(): AgentState {
  return {
    id: 'test',
    config: { name: 'test', instructions: '', tools: [] },
    context: { messages: [], stepCount: 0 },
  };
}

function createMockCtx(): PhaseHandlerContext {
  return {
    llmProvider: {} as never,
    toolRegistry: {} as never,
    messageAssembler: {} as never,
    options: { model: 'test' },
  };
}

describe('PhaseRouter', () => {
  describe('register', () => {
    it('should register a handler by inferring its phase type', () => {
      const handler = createMockHandler('idle');
      const router = new PhaseRouter([handler]);

      expect(router.getHandler('idle')).toBe(handler);
    });

    it('should register multiple handlers', () => {
      const idle = createMockHandler('idle');
      const preparing = createMockHandler('preparing');
      const completed = createMockHandler('completed');
      const router = new PhaseRouter([idle, preparing, completed]);

      expect(router.getHandler('idle')).toBe(idle);
      expect(router.getHandler('preparing')).toBe(preparing);
      expect(router.getHandler('completed')).toBe(completed);
    });

    it('should throw if handler phase type cannot be inferred', () => {
      const badHandler: IPhaseHandler = {
        canHandle: () => false,
        execute: () => ({
          state: createMockState(),
          phase: { type: 'error', error: new Error() },
          done: true,
        }),
      };

      expect(() => new PhaseRouter([badHandler])).toThrow('Cannot infer phase type');
    });
  });

  describe('execute', () => {
    it('should route to the correct handler', async () => {
      const handler = createMockHandler('idle');
      const router = new PhaseRouter([handler]);
      const execState = createExecutionState();

      const result = await router.execute(createMockCtx(), createMockState(), execState);

      expect(result.done).toBe(true);
    });

    it('should return error phase for unregistered phase type', async () => {
      const handler = createMockHandler('idle');
      const router = new PhaseRouter([handler]);
      const execState = createExecutionState();
      // Manually set phase to an unregistered type
      execState.phase = { type: 'calling-llm' };

      const result = await router.execute(createMockCtx(), createMockState(), execState);

      expect(result.phase.type).toBe('error');
      expect(result.done).toBe(true);
    });

    it('should pass toolRegistry and options to handler', async () => {
      let receivedRegistry: unknown = 'NOT_CALLED';
      let receivedOptions: unknown = 'NOT_CALLED';

      const handler: IPhaseHandler = {
        canHandle: (type) => type === 'executing-tool',
        execute: (_ctx, state, _execState, toolRegistry?, options?) => {
          receivedRegistry = toolRegistry ?? null;
          receivedOptions = options ?? null;
          return { state, phase: { type: 'completed', answer: '' }, done: true };
        },
      };

      const router = new PhaseRouter([handler]);
      const execState = createExecutionState();
      execState.phase = { type: 'executing-tool' };

      const mockRegistry = { name: 'mock-registry' } as never;
      const mockOptions = { signal: undefined };
      await router.execute(
        createMockCtx(),
        createMockState(),
        execState,
        mockRegistry,
        mockOptions
      );

      expect(receivedRegistry).toBe(mockRegistry);
      expect(receivedOptions).toBe(mockOptions);
    });

    it('should handle all 10 default phase types', () => {
      const types = [
        'idle',
        'preparing',
        'calling-llm',
        'llm-response',
        'parsing',
        'parsed',
        'executing-tool',
        'tool-result',
        'completed',
        'error',
      ];

      const handlers = types.map((t) => createMockHandler(t));
      const router = new PhaseRouter(handlers);

      for (const type of types) {
        expect(router.getHandler(type)).toBeDefined();
      }
    });
  });
});
