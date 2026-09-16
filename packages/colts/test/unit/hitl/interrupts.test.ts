import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

// HITL interrupt-terminal-state port (R2P-108, aligned with Rust
// a2d508d / ca8276f / 9a2bcd3): pendingInterrupts persistence + typed
// suspension signal.
import {
  upsertPendingInterrupt,
  removePendingInterrupt,
  retargetToolCallId,
} from '../../../src/hitl/interrupts.js';
import { ToolSuspensionError, ToolRegistry } from '../../../src/tools/registry.js';
import { createAskHumanTool } from '../../../src/tools/ask-human.js';
import { createAgentState } from '../../../src/state/index.js';
import type { HumanRequest } from '../../../src/hitl/types.js';
import type { AgentState } from '../../../src/types.js';

function makeState(): AgentState {
  return createAgentState({ name: 'test', instructions: 'test', tools: [] });
}

function questionRequest(id: string): HumanRequest {
  return {
    type: 'question',
    questions: [{ id: 'q1', question: 'name?', type: 'text' }],
    toolCallId: id,
  };
}

// ─── retarget_tool_call_id (ca8276f: anti-400 id anchoring) ──────────────────

describe('HITL interrupts: retargetToolCallId', () => {
  it('rewrites a question request to the LLM action id', () => {
    const req = retargetToolCallId(questionRequest('human-made-up'), 'call_00_real');
    expect(req.type).toBe('question');
    if (req.type === 'question') {
      expect(req.toolCallId).toBe('call_00_real');
      expect(req.questions[0].id).toBe('q1');
    }
  });

  it('rewrites a tool-confirm request to the LLM action id', () => {
    const confirm: HumanRequest = {
      type: 'tool-confirm',
      toolName: 'a2ui_wait',
      args: {},
      toolCallId: 'human-made-up',
    };
    const req = retargetToolCallId(confirm, 'call_01_real');
    expect(req.type).toBe('tool-confirm');
    if (req.type === 'tool-confirm') {
      expect(req.toolCallId).toBe('call_01_real');
      expect(req.toolName).toBe('a2ui_wait');
    }
  });
});

// ─── Typed suspension signal (9a2bcd3: ToolError::Suspend equivalent) ───────

describe('HITL interrupts: typed suspension signal', () => {
  it('ToolSuspensionError carries the request', () => {
    const err = new ToolSuspensionError(questionRequest('human-1'));
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ToolSuspensionError');
    expect(err.request.type).toBe('question');
    expect(err.request.toolCallId).toBe('human-1');
  });

  it('ask_human tool converts a suspend outcome into ToolSuspensionError', async () => {
    const registry = new ToolRegistry();
    registry.register(
      createAskHumanTool(async ({ questions, context }) => ({
        type: 'suspend' as const,
        questions,
        context,
        // Bridge-invented id: only a transitional frontend requestId — the
        // kernel retargets it to the LLM's action.id before persisting.
        toolCallId: 'human-bridge-1',
      }))
    );

    await expect(
      registry.execute(
        'ask_human',
        { questions: [{ id: 'q1', question: 'name?', type: 'text' }], context: 'need name' },
        {}
      )
    ).rejects.toBeInstanceOf(ToolSuspensionError);

    try {
      await registry.execute(
        'ask_human',
        { questions: [{ id: 'q1', question: 'name?', type: 'text' }] },
        {}
      );
      expect.unreachable('must throw');
    } catch (e) {
      const err = e as ToolSuspensionError;
      expect(err.request.type).toBe('question');
      if (err.request.type === 'question') {
        expect(err.request.questions[0].id).toBe('q1');
        expect(err.request.toolCallId).toBe('human-bridge-1');
      }
    }
  });

  it('ask_human tool still returns answers for blocking handlers (backward compat)', async () => {
    const registry = new ToolRegistry();
    registry.register(createAskHumanTool(async () => ({ q1: { type: 'direct', value: 'Alice' } })));

    const result = await registry.execute(
      'ask_human',
      { questions: [{ id: 'q1', question: 'name?', type: 'text' }] },
      {}
    );
    expect(result).toEqual({ q1: { type: 'direct', value: 'Alice' } });
  });

  it('rejects a suspend signal with empty questions (nothing to ask — never persisted)', async () => {
    const registry = new ToolRegistry();
    registry.register(
      createAskHumanTool(async () => ({ type: 'suspend' as const, questions: [] }))
    );

    // A plain error (error-policy path), NOT a suspension — an empty
    // question list must never reach pendingInterrupts.
    await expect(
      registry.execute(
        'ask_human',
        { questions: [{ id: 'q1', question: 'name?', type: 'text' }] },
        {}
      )
    ).rejects.toThrow(/at least one question/i);
    try {
      await registry.execute(
        'ask_human',
        { questions: [{ id: 'q1', question: 'name?', type: 'text' }] },
        {}
      );
      expect.unreachable('must throw');
    } catch (e) {
      expect(e).not.toBeInstanceOf(ToolSuspensionError);
    }
  });
});

// ─── Cross-copy suspension detection (P2-b) ─────────────────────────────────

describe('HITL interrupts: cross-copy suspension detection', () => {
  it('executing-tool handler honors a name-tagged suspension from a duplicate class copy', async () => {
    const { ExecutingToolHandler } =
      await import('../../../src/execution-engine/handlers/executing-tool-handler.js');
    // Simulate a dual-package copy: an error that is NOT instanceof
    // ToolSuspensionError but carries the class name and the request —
    // instanceof alone would silently degrade it to a tool failure.
    class DuplicateCopySuspension extends Error {
      constructor(public readonly request: HumanRequest) {
        super('tool requested suspension (HITL)');
        this.name = 'ToolSuspensionError';
      }
    }
    const registry = new ToolRegistry();
    registry.register({
      name: 'ask_human',
      description: 'bridge from another package copy',
      parameters: z.object({ questions: z.array(z.object({})) }),
      execute: async () => {
        throw new DuplicateCopySuspension(questionRequest('human-dup'));
      },
    });

    const handler = new ExecutingToolHandler();
    const execState = {
      phase: {
        type: 'executing-tool' as const,
        actions: [{ id: 'call_dup', tool: 'ask_human', arguments: { questions: [] } }],
      },
    } as any;
    const ctx = {
      executionPolicy: {
        onToolError: vi.fn((error: Error) => ({
          decision: 'continue' as const,
          sanitizedResult: `Error: ${error.message}`,
        })),
      },
    } as any;

    const result = await handler.execute(ctx, makeState(), execState, registry);
    expect(result.phase.type).toBe('waiting-human');
    const request = (result.phase as { request: HumanRequest }).request;
    // Retargeted to the LLM's action id even across the copy boundary.
    expect(request.toolCallId).toBe('call_dup');
    expect(ctx.executionPolicy.onToolError).not.toHaveBeenCalled();
  });
});

// ─── pendingInterrupts list operations (a2d508d ①) ───────────────────────────

describe('HITL interrupts: upsertPendingInterrupt', () => {
  it('dedupes by toolCallId', () => {
    const s = upsertPendingInterrupt(makeState(), questionRequest('human-1'));
    const s2 = upsertPendingInterrupt(s, questionRequest('human-1'));
    expect(s2.context.pendingInterrupts).toHaveLength(1);
    expect(s2.context.pendingInterrupts![0].request.toolCallId).toBe('human-1');
    expect(typeof s2.context.pendingInterrupts![0].createdAt).toBe('number');
  });

  it('keeps both entries for different toolCallIds', () => {
    const s = upsertPendingInterrupt(makeState(), questionRequest('human-1'));
    const s2 = upsertPendingInterrupt(s, questionRequest('human-2'));
    expect(s2.context.pendingInterrupts).toHaveLength(2);
  });

  it('touches updatedAt', () => {
    const s = makeState();
    const before = s.context.updatedAt;
    const s2 = upsertPendingInterrupt(s, questionRequest('human-1'));
    expect(s2.context.updatedAt).toBeGreaterThanOrEqual(before);
  });
});

describe('HITL interrupts: removePendingInterrupt', () => {
  it('drops the entry and clears an emptied list to undefined', () => {
    const s = upsertPendingInterrupt(makeState(), questionRequest('human-1'));
    const s2 = removePendingInterrupt(s, 'human-1');
    expect(s2.context.pendingInterrupts).toBeUndefined();
  });

  it('keeps other entries (one pending, one answered — no cross-talk)', () => {
    let s = upsertPendingInterrupt(makeState(), questionRequest('human-1'));
    s = upsertPendingInterrupt(s, questionRequest('human-2'));
    const s2 = removePendingInterrupt(s, 'human-1');
    expect(s2.context.pendingInterrupts).toHaveLength(1);
    expect(s2.context.pendingInterrupts![0].request.toolCallId).toBe('human-2');
  });

  it('is a no-op for an unknown request id', () => {
    const s = upsertPendingInterrupt(makeState(), questionRequest('human-2'));
    const s2 = removePendingInterrupt(s, 'nope');
    expect(s2.context.pendingInterrupts).toEqual(s.context.pendingInterrupts);
    expect(s2.context.updatedAt).toBe(s.context.updatedAt);
  });

  it('is a no-op when the list is absent', () => {
    const s = makeState();
    const s2 = removePendingInterrupt(s, 'nope');
    expect(s2.context.pendingInterrupts).toBeUndefined();
  });
});

// ─── state.json persistence round-trip (a2d508d ①) ───────────────────────────

describe('HITL interrupts: persistence', () => {
  it('pendingInterrupts survive a state JSON round-trip', () => {
    const s = upsertPendingInterrupt(makeState(), questionRequest('human-1'));
    const json = JSON.parse(JSON.stringify(s));
    expect(Array.isArray(json.context.pendingInterrupts)).toBe(true);
    expect(json.context.pendingInterrupts[0].request.type).toBe('question');
    expect(json.context.pendingInterrupts[0].request.toolCallId).toBe('human-1');
    expect(typeof json.context.pendingInterrupts[0].createdAt).toBe('number');

    const back: AgentState = JSON.parse(JSON.stringify(s));
    expect(back.context.pendingInterrupts![0].request.toolCallId).toBe('human-1');
    expect(back.context.pendingInterrupts![0].request.questions[0].question).toBe('name?');
  });

  it('legacy state JSON without pendingInterrupts deserializes (field optional)', () => {
    const s = upsertPendingInterrupt(makeState(), questionRequest('human-1'));
    const json = JSON.parse(JSON.stringify(s)) as {
      context: Record<string, unknown>;
    };
    delete json.context.pendingInterrupts;
    // Simulate loading an old state.json: the field is simply absent.
    const legacyContext = json.context as AgentState['context'];
    expect(legacyContext.pendingInterrupts).toBeUndefined();
  });
});
