/**
 * @fileoverview Per-turn usage persistence — Message.usage (R2P-106)
 *
 * The runner stamps the run's usage summary onto the turn's LAST assistant
 * message at the common terminal exit, mirroring the Rust port's
 * `stamp_turn_usage` hooked into `finish_run` (commit c904595):
 *
 * - WaitingHuman endings do not stamp (turn unfinished; the final run after
 *   resume writes it once — same accounting as its done frame);
 * - all-zero usage does not stamp (command-interception runs; absent means
 *   "no usage");
 * - no assistant row this run → nowhere to attach, skipped;
 * - abort exits still stamp the partial account.
 */

import { describe, it, expect } from 'vitest';
import type { LLMResponse, TokenStats } from '@agentskillmania/llm-client';
import { z } from 'zod';
import { AgentRunner, stampTurnUsage } from '../../../src/runner/index.js';
import type { RunResult } from '../../../src/execution/index.js';
import { createAgentState, addUserMessage, updateState } from '../../../src/state/index.js';
import type { AgentConfig, AgentState, Message, TurnUsage } from '../../../src/types.js';
import { createMockLLMClient } from '../../helpers/mock-llm.js';

const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a helpful assistant.',
  tools: [],
};

function tokens(input: number, output: number): TokenStats {
  return { input, output, cacheRead: 40, cacheWrite: 10 };
}

function runResult(
  type: RunResult['type'],
  overrides: Partial<RunResult> & { tokens: TokenStats; duration: number }
): RunResult {
  return {
    type,
    totalSteps: 1,
    ...overrides,
  } as RunResult;
}

/**
 * Two-turn conversation shape: u1 / a1 (carries old usage, simulating a
 * previous turn) / u2 / a2 (this turn's last row). Mirrors the Rust
 * `two_turn_state` fixture.
 */
function twoTurnState(): AgentState {
  let state = createAgentState(defaultConfig);
  state = addUserMessage(state, 'one');
  state = updateState(state, (draft) => {
    const a1: Message = {
      id: 'a1',
      role: 'assistant',
      content: 'answer one',
      timestamp: 1,
      usage: { inputTokens: 1, outputTokens: 1, cacheRead: 0, cacheWrite: 0, durationMs: 5 },
    };
    draft.context.messages.push(a1);
  });
  state = addUserMessage(state, 'two');
  return updateState(state, (draft) => {
    draft.context.messages.push({
      id: 'a2',
      role: 'assistant',
      content: 'answer two',
      timestamp: 2,
    });
  });
}

function findMessage(state: AgentState, content: string): Message {
  const msg = state.context.messages.find((m) => m.content === content);
  if (!msg) throw new Error(`message not found: ${content}`);
  return msg;
}

describe('stampTurnUsage', () => {
  it('stamps usage on the last assistant row only (prior turns untouched)', () => {
    const state = twoTurnState();
    const stamped = stampTurnUsage(
      state,
      runResult('success', { tokens: tokens(800, 150), duration: 2000, answer: 'done' })
    );

    // Previous turn's a1 keeps its old account; this turn's a2 gets the new one.
    const a1 = findMessage(stamped, 'answer one');
    expect(a1.usage?.inputTokens).toBe(1);
    const usage = findMessage(stamped, 'answer two').usage;
    expect(usage).toBeDefined();
    expect(usage).toEqual({
      inputTokens: 800,
      outputTokens: 150,
      cacheRead: 40,
      cacheWrite: 10,
      durationMs: 2000,
    } satisfies TurnUsage);
    // Original state stays untouched (immutable update).
    expect(findMessage(state, 'answer two').usage).toBeUndefined();
  });

  it('waiting-human result does not stamp usage', () => {
    const state = twoTurnState();
    const stamped = stampTurnUsage(
      state,
      runResult('waiting-human', {
        tokens: tokens(800, 150),
        duration: 2000,
        request: {
          type: 'question',
          questions: [],
          toolCallId: 'tc1',
        },
      })
    );
    expect(findMessage(stamped, 'answer two').usage).toBeUndefined();
  });

  it('all-zero usage does not stamp (absent, not zero)', () => {
    const state = twoTurnState();
    const stamped = stampTurnUsage(
      state,
      runResult('success', {
        answer: '/clear',
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        duration: 0,
      })
    );
    expect(findMessage(stamped, 'answer two').usage).toBeUndefined();
  });

  it('abort result stamps the partial account', () => {
    const state = twoTurnState();
    const stamped = stampTurnUsage(
      state,
      runResult('abort', { tokens: tokens(120, 8), duration: 900 })
    );
    expect(findMessage(stamped, 'answer two').usage?.inputTokens).toBe(120);
  });

  it('serializes camelCase and old archives without the key round-trip', () => {
    const msg: Message = {
      id: 'm-1',
      role: 'assistant',
      content: 'hi',
      timestamp: 1,
      usage: {
        inputTokens: 800,
        outputTokens: 150,
        cacheRead: 40,
        cacheWrite: 10,
        durationMs: 2000,
      },
    };
    const json = JSON.stringify(msg);
    // camelCase keys, same shape as the frontend skill-ui-state TurnUsage.
    expect(json).toContain('"inputTokens":800');
    expect(json).toContain('"cacheRead":40');
    expect(json).toContain('"durationMs":2000');
    // Full round-trip preserves the account.
    expect((JSON.parse(json) as Message).usage).toEqual(msg.usage);

    // Old archive shape (no usage key) parses back with usage absent.
    const legacy = JSON.parse(
      '{"role":"assistant","id":"m-1","content":"hi","timestamp":1}'
    ) as Message;
    expect(legacy.usage).toBeUndefined();
    expect(legacy.content).toBe('hi');
    // Messages without usage omit the key on serialize (skip-when-absent).
    expect(JSON.stringify({ ...msg, usage: undefined })).not.toContain('"usage"');
  });
});

describe('run() stamps turn usage at the common exit (finalizeRun)', () => {
  it('success exit stamps the final assistant message', async () => {
    const client = createMockLLMClient([
      {
        content: 'Hello!',
        toolCalls: [],
        tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
        stopReason: 'stop',
      },
    ]);
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const state = createAgentState(defaultConfig);
    state.context.messages = [
      { id: 'm1', role: 'user', content: 'hi', type: 'text', timestamp: 0, tokenCount: 1 },
    ];

    const { state: finalState, result } = await runner.run(state);
    expect(result.type).toBe('success');

    const messages = finalState.context.messages;
    const last = messages[messages.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.usage).toBeDefined();
    expect(last.usage?.inputTokens).toBe(10);
    expect(last.usage?.outputTokens).toBe(5);
    expect(last.usage?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('abort exit still stamps the partial account', async () => {
    const controller = new AbortController();
    const client = createMockLLMClient([
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'abort_tool', arguments: {} }],
        tokens: { input: 120, output: 8, cacheRead: 3, cacheWrite: 1 },
        stopReason: 'tool_use',
      },
    ]);
    const runner = new AgentRunner({
      model: 'gpt-4',
      llmClient: client,
      tools: [
        {
          name: 'abort_tool',
          description: 'aborts the run signal',
          parameters: z.object({}),
          execute: async () => {
            controller.abort();
            return 'aborted';
          },
        },
      ],
    });

    const state = createAgentState(defaultConfig);
    state.context.messages = [
      { id: 'm1', role: 'user', content: 'hi', type: 'text', timestamp: 0, tokenCount: 1 },
    ];

    const { state: finalState, result } = await runner.run(state, {
      signal: controller.signal,
    });
    expect(result.type).toBe('abort');

    // The turn's last row is the tool result — the account lands on the
    // last ASSISTANT row (the tool-calling one from step 1).
    const assistantRows = finalState.context.messages.filter((m) => m.role === 'assistant');
    const last = assistantRows[assistantRows.length - 1];
    expect(last.usage?.inputTokens).toBe(120);
    expect(last.usage?.outputTokens).toBe(8);
  });
});
