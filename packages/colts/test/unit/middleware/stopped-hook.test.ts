import { describe, it, expect, vi } from 'vitest';
import { MiddlewareExecutor } from '../../../src/middleware/executor.js';
import type { AgentMiddleware } from '../../../src/middleware/types.js';
import { createAgentState } from '../../../src/state/index.js';

function makeState() {
  return createAgentState({ name: 'test', instructions: 'test', tools: [] });
}

describe('StepHookReturn with result', () => {
  it('propagates stopped StepResult from beforeStep', async () => {
    const stoppedResult = {
      type: 'stopped' as const,
      data: { response: 'handled' },
      tokens: { input: 0, output: 0 },
    };
    const mw: AgentMiddleware = {
      name: 'stopper',
      beforeStep: vi.fn().mockResolvedValue({ stop: true, result: stoppedResult }),
    };
    const executor = new MiddlewareExecutor([mw]);
    const chain = await executor.runBeforeStep({
      state: makeState(),
      stepNumber: 0,
      runnerOptions: {} as any,
    });
    expect(chain.stopped).toBe(true);
    expect(chain.result).toEqual(stoppedResult);
  });
});

describe('RunHookReturn with result', () => {
  it('propagates stopped RunResult from beforeRun', async () => {
    const stoppedResult = {
      type: 'stopped' as const,
      data: 'Command handled',
      totalSteps: 0,
      tokens: { input: 0, output: 0 },
    };
    const mw: AgentMiddleware = {
      name: 'stopper',
      beforeRun: vi.fn().mockResolvedValue({ stop: true, result: stoppedResult }),
    };
    const executor = new MiddlewareExecutor([mw]);
    const chain = await executor.runBeforeRun({
      state: makeState(),
      runnerOptions: {} as any,
    });
    expect(chain.stopped).toBe(true);
    expect(chain.result).toEqual(stoppedResult);
  });
});
