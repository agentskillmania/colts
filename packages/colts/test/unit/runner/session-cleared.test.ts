/**
 * @fileoverview AgentRunner `session-cleared` event
 *
 * When a command (`/clear`) resets the conversation mid-run — messages go from
 * non-empty to empty — the runner must emit `session-cleared` before the
 * terminal `complete`, so daemons can forward it and frontends can drop their
 * local view. Mirrors the Rust port's `RunnerEvent::SessionCleared`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMResponse } from '@agentskillmania/llm-client';
import { AgentRunner } from '../../../src/runner/index.js';
import { createAgentState } from '../../../src/state/index.js';
import type { AgentConfig } from '../../../src/types.js';
import { createExecutionState } from '../../../src/execution/index.js';
import type { AgentMiddleware } from '../../../src/middleware/types.js';

const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

function createMockClient(responses: LLMResponse[]) {
  let idx = 0;
  return {
    call: vi.fn().mockImplementation(() => {
      if (idx >= responses.length) throw new Error('No more responses');
      return Promise.resolve(responses[idx++]!);
    }),
    stream: vi.fn().mockImplementation(async function* () {
      if (idx >= responses.length) throw new Error('No more responses');
      const resp = responses[idx]!;
      idx++;
      yield { type: 'text' as const, delta: resp.content, accumulatedContent: resp.content };
      yield { type: 'done' as const, roundTotalTokens: resp.tokens };
    }),
    getModelMeta: vi.fn().mockReturnValue({ contextWindow: 128000, maxTokens: 4096 }),
  } as unknown as import('@agentskillmania/llm-client').LLMClient;
}

describe('AgentRunner session-cleared event', () => {
  it('emits session-cleared when a command stop empties messages (/clear)', async () => {
    // Client should never be called — beforeAdvance short-circuits.
    const client = createMockClient([]);
    const clearedState = createAgentState(defaultConfig);
    clearedState.context.messages = [];
    const mw: AgentMiddleware = {
      name: 'clear',
      beforeAdvance: vi.fn().mockResolvedValue({
        stop: true as const,
        state: clearedState,
        result: {
          state: clearedState,
          execState: createExecutionState(),
          phase: { type: 'completed' as const, answer: 'Session cleared.' },
          done: true,
        },
      }),
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [mw] });

    const state = createAgentState(defaultConfig);
    state.context.messages = [
      { id: 'm1', role: 'user', content: 'hi', type: 'text', timestamp: 0, tokenCount: 1 },
    ];

    let cleared = false;
    runner.on('session-cleared', () => {
      cleared = true;
    });

    await runner.run(state);
    expect(cleared).toBe(true);
    expect(client.call).not.toHaveBeenCalled();
  });

  it('does NOT emit session-cleared on a normal run (messages stay non-empty)', async () => {
    const client = createMockClient([
      { content: 'Hello!', toolCalls: [], tokens: { input: 10, output: 5 }, stopReason: 'stop' },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const state = createAgentState(defaultConfig);
    state.context.messages = [
      { id: 'm1', role: 'user', content: 'hi', type: 'text', timestamp: 0, tokenCount: 1 },
    ];

    let cleared = false;
    runner.on('session-cleared', () => {
      cleared = true;
    });

    await runner.run(state);
    expect(cleared).toBe(false);
  });
});
