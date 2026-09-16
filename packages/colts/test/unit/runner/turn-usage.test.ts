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
 * - abort exits still stamp the partial account;
 * - lower-bound guard: only assistant rows added during THIS run may receive
 *   the account — a turn whose first LLM call fails errors out with zero
 *   tokens but nonzero duration (not all-zero), and the reverse search must
 *   not reach back into the previous turn's row.
 */

import { describe, it, expect, vi } from 'vitest';
import type { LLMClient, TokenStats } from '@agentskillmania/llm-client';
import { z } from 'zod';
import { AgentRunner, stampTurnUsage } from '../../../src/runner/index.js';
import type { RunResult } from '../../../src/execution/index.js';
import type { AgentMiddleware } from '../../../src/middleware/types.js';
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

// Typed per-variant builders (no casts): a missing variant-required field is
// a compile error, unlike the old `as RunResult` spread builder.
function successResult(tkns: TokenStats, duration: number, answer = 'done'): RunResult {
  return { type: 'success', answer, totalSteps: 1, tokens: tkns, duration };
}
function errorResult(tkns: TokenStats, duration: number): RunResult {
  return { type: 'error', error: new Error('boom'), totalSteps: 1, tokens: tkns, duration };
}
function abortResult(tkns: TokenStats, duration: number): RunResult {
  return { type: 'abort', totalSteps: 1, tokens: tkns, duration };
}
function waitingHumanResult(tkns: TokenStats, duration: number): RunResult {
  return {
    type: 'waiting-human',
    request: { type: 'question', questions: [], toolCallId: 'tc1' },
    totalSteps: 1,
    tokens: tkns,
    duration,
  };
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

/**
 * Turn-2 shape where this run produced NO assistant row: u1 / a1 (previous
 * turn's account) / u2. The run's first LLM call failed before any assistant
 * message was added.
 */
function failedFirstCallState(): AgentState {
  let state = createAgentState(defaultConfig);
  state = addUserMessage(state, 'one');
  state = updateState(state, (draft) => {
    draft.context.messages.push({
      id: 'a1',
      role: 'assistant',
      content: 'answer one',
      timestamp: 1,
      usage: {
        inputTokens: 900,
        outputTokens: 200,
        cacheRead: 40,
        cacheWrite: 10,
        durationMs: 5000,
      },
    });
  });
  return addUserMessage(state, 'two');
}

describe('stampTurnUsage', () => {
  it('stamps usage on the last assistant row only (prior turns untouched)', () => {
    const state = twoTurnState();
    const stamped = stampTurnUsage(state, successResult(tokens(800, 150), 2000));

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
    const stamped = stampTurnUsage(state, waitingHumanResult(tokens(800, 150), 2000));
    expect(findMessage(stamped, 'answer two').usage).toBeUndefined();
  });

  it('all-zero usage does not stamp (absent, not zero)', () => {
    const state = twoTurnState();
    const stamped = stampTurnUsage(
      state,
      successResult({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 0, '/clear')
    );
    expect(findMessage(stamped, 'answer two').usage).toBeUndefined();
  });

  it('abort result stamps the partial account', () => {
    const state = twoTurnState();
    const stamped = stampTurnUsage(state, abortResult(tokens(120, 8), 900));
    expect(findMessage(stamped, 'answer two').usage?.inputTokens).toBe(120);
  });

  it('lower-bound guard: zero-token error/abort with nonzero duration never touches the previous turn', () => {
    // Turn 2's first LLM call failed → error/abort terminal with all-zero
    // tokens but duration ≥ 1ms — NOT all-zero, so the reverse search would
    // reach back and overwrite turn 1's account without the minIndex guard.
    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const result of [errorResult(zero, 2), abortResult(zero, 2)]) {
      const state = failedFirstCallState();
      // minIndex = 3: the message count at run start (after u2).
      const stamped = stampTurnUsage(state, result, 3);

      // Previous turn's account survives verbatim...
      expect(findMessage(stamped, 'answer one').usage).toEqual({
        inputTokens: 900,
        outputTokens: 200,
        cacheRead: 40,
        cacheWrite: 10,
        durationMs: 5000,
      } satisfies TurnUsage);
      // ...and nothing new was written (a1 is still the only row with usage).
      expect(stamped.context.messages.filter((m) => m.usage !== undefined)).toHaveLength(1);
    }
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
    expect(typeof last.usage?.durationMs).toBe('number');
  });

  it('stamps before run:end and afterRun (persistence sees the account)', async () => {
    const client = createMockLLMClient([
      {
        content: 'Hello!',
        toolCalls: [],
        tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
        stopReason: 'stop',
      },
    ]);
    const seen: { runEnd?: AgentState; afterRun?: AgentState } = {};
    const capture: AgentMiddleware = {
      name: 'capture-final-states',
      afterRun: async (ctx) => {
        seen.afterRun = ctx.state;
      },
    };
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client, middleware: [capture] });
    runner.on('run:end', (e) => {
      seen.runEnd = e.state;
    });

    const state = createAgentState(defaultConfig);
    state.context.messages = [
      { id: 'm1', role: 'user', content: 'hi', type: 'text', timestamp: 0, tokenCount: 1 },
    ];

    await runner.run(state);

    // Ordering contract: the stamp must precede both the run:end event and
    // the afterRun hook (session persistence lives there) — moving it after
    // either would hand them an unaccounted state.
    expect(Object.keys(seen)).toEqual(['runEnd', 'afterRun']);
    for (const [label, st] of Object.entries(seen)) {
      const msgs = st.context.messages;
      const last = msgs[msgs.length - 1];
      expect(last.role, label).toBe('assistant');
      expect(last.usage?.inputTokens, label).toBe(10);
    }
  });

  it('first-call failure does not overwrite the previous turn account (lower bound)', async () => {
    // First LLM call of the turn fails: no assistant row this run, zero
    // tokens, but nonzero duration — the previous turn's row must keep its
    // account (integration view of the minIndex guard via initialMessageCount).
    const client: LLMClient = {
      call: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
      stream: vi.fn().mockImplementation(async function* () {
        await new Promise((resolve) => setTimeout(resolve, 3)); // durationMs >= 1
        throw new Error('LLM unavailable');
      }),
      getModelMeta: vi.fn().mockReturnValue({ contextWindow: 128000, maxTokens: 4096 }),
    } as unknown as LLMClient;
    const runner = new AgentRunner({ model: 'gpt-4', llmClient: client });

    const { state: finalState, result } = await runner.run(failedFirstCallState());
    expect(result.type).toBe('error');

    const messages = finalState.context.messages;
    expect(messages.filter((m) => m.usage !== undefined)).toHaveLength(1);
    expect(findMessage(finalState, 'answer one').usage).toEqual({
      inputTokens: 900,
      outputTokens: 200,
      cacheRead: 40,
      cacheWrite: 10,
      durationMs: 5000,
    } satisfies TurnUsage);
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
