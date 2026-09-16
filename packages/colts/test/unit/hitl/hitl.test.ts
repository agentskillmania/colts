import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { DefaultExecutionPolicy } from '../../../src/policy/default-policy.js';
import { createAgentState, addUserMessage, addAssistantMessage } from '../../../src/state/index.js';
import type { HumanRequest, HumanResponse } from '../../../src/hitl/types.js';
import type { AgentMiddleware } from '../../../src/middleware/types.js';
import type { Phase, Action, ExecutionState, AdvanceResult } from '../../../src/execution/index.js';
import { createExecutionState } from '../../../src/execution/index.js';
import { MiddlewareExecutor } from '../../../src/middleware/executor.js';

function makeState() {
  return createAgentState({ name: 'test', instructions: 'test', tools: [] });
}

function makeExecStateWithAction(
  toolName: string,
  args: Record<string, unknown> = {}
): ExecutionState {
  const action: Action = { id: 'call_1', tool: toolName, arguments: args };
  return {
    phase: { type: 'executing-tool', actions: [action] },
    action,
    allActions: [action],
  };
}

describe('HITL V2: ExecutionPolicy', () => {
  const policy = new DefaultExecutionPolicy();

  it('should stop on waiting-human step result', () => {
    const decision = policy.shouldStop(
      {},
      {
        type: 'waiting-human',
        request: { type: 'question', questions: [], toolCallId: 'c1' },
        tokens: { input: 10, output: 5 },
      },
      { stepCount: 1, maxSteps: 100 }
    );

    expect(decision.decision).toBe('stop');
    if (decision.decision === 'stop') {
      expect(decision.runResultType).toBe('waiting-human');
    }
  });
});

describe('HITL V2: HitlMiddleware', () => {
  it('should NOT intercept ask_human by name — suspension is the tool layer’s typed signal (single-track, R2P-108)', async () => {
    // ask_human 挂起单轨化（对齐 Rust a2d508d/9a2bcd3）：中间件不再按名字
    // 拦截 ask_human —— 是否挂起由 ask_human 工具经 ToolSuspensionError 类型化
    // 信号表达，由内核 executing-tool handler 拦截（见下方 kernel 测试）。
    // 名字匹配是隐式约定：任何叫 ask_human 的工具都会被拦，无论它是否想挂起。
    const { HitlMiddleware } = await import('../../../src/hitl/middleware.js');

    const mw = new HitlMiddleware();
    const agentMw: AgentMiddleware = mw;

    const execState = makeExecStateWithAction('ask_human', {
      questions: [{ id: 'q1', question: 'Name?', type: 'text' }],
      context: 'Need name',
    });

    const chain = await (new MiddlewareExecutor([agentMw]) as any).runBeforeAdvance({
      state: makeState(),
      execState,
      fromPhase: { type: 'parsed', thought: 'I need to ask' } as Phase,
      stepNumber: 0,
      runnerOptions: {} as any,
    });

    // Middleware must NOT stop — the action flows to the tool layer, where
    // suspension is expressed (or not) by the tool itself.
    expect(chain.stopResult).toBeUndefined();
  });

  it('should intercept confirmed tools at executing-tool phase', async () => {
    const { HitlMiddleware } = await import('../../../src/hitl/middleware.js');

    const mw = new HitlMiddleware({ confirmTools: ['delete_file', 'send_email'] });

    const execState = makeExecStateWithAction('delete_file', { path: '/tmp/important.txt' });

    const chain = await (
      new MiddlewareExecutor([mw as unknown as AgentMiddleware]) as any
    ).runBeforeAdvance({
      state: makeState(),
      execState,
      fromPhase: { type: 'parsed', thought: 'Deleting file' } as Phase,
      stepNumber: 0,
      runnerOptions: {} as any,
    });

    expect(chain.stopResult).toBeDefined();
    expect(chain.stopResult.phase.type).toBe('waiting-human');

    const request = chain.stopResult.phase.request as HumanRequest;
    expect(request.type).toBe('tool-confirm');
    if (request.type === 'tool-confirm') {
      expect(request.toolName).toBe('delete_file');
      expect(request.args).toEqual({ path: '/tmp/important.txt' });
      expect(request.toolCallId).toBe('call_1');
    }
  });

  it('should NOT intercept non-HITL tools', async () => {
    const { HitlMiddleware } = await import('../../../src/hitl/middleware.js');

    const mw = new HitlMiddleware({ confirmTools: ['delete_file'] });

    const execState = makeExecStateWithAction('calculator', { expression: '2+2' });

    const chain = await (
      new MiddlewareExecutor([mw as unknown as AgentMiddleware]) as any
    ).runBeforeAdvance({
      state: makeState(),
      execState,
      fromPhase: { type: 'parsed', thought: 'Calculating' } as Phase,
      stepNumber: 0,
      runnerOptions: {} as any,
    });

    // Should NOT stop — let the tool execute normally
    expect(chain.stopResult).toBeUndefined();
  });

  it('should NOT intercept when phase is not executing-tool', async () => {
    const { HitlMiddleware } = await import('../../../src/hitl/middleware.js');

    const mw = new HitlMiddleware({ askHumanToolName: 'ask_human', confirmTools: ['delete_file'] });

    const execState = createExecutionState(); // idle phase

    const chain = await (
      new MiddlewareExecutor([mw as unknown as AgentMiddleware]) as any
    ).runBeforeAdvance({
      state: makeState(),
      execState,
      fromPhase: { type: 'idle' } as Phase,
      stepNumber: 0,
      runnerOptions: {} as any,
    });

    expect(chain.stopResult).toBeUndefined();
  });
});

describe('HITL V2: respond()', () => {
  it('should add tool-result message for question response', async () => {
    const { respond } = await import('../../../src/hitl/respond.js');

    let state = makeState();
    // Simulate: LLM called ask_human, state has assistant message with tool call
    state = addAssistantMessage(state, 'I need to ask a question', {
      type: 'action',
      toolCalls: [
        {
          id: 'call_abc',
          name: 'ask_human',
          arguments: { questions: [{ id: 'name', question: 'Name?', type: 'text' }] },
        },
      ],
    });

    const request: HumanRequest = {
      type: 'question',
      questions: [{ id: 'name', question: 'Name?', type: 'text' }],
      toolCallId: 'call_abc',
    };
    const response: HumanResponse = {
      type: 'question',
      answers: { name: { type: 'direct', value: 'Alice' } },
    };

    const newState = respond(state, request, response);

    // Should have added a tool-role message with the answers
    const toolMsg = newState.context.messages.find(
      (m) => m.role === 'tool' && m.toolCallId === 'call_abc'
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolName).toBe('ask_human');
    expect(toolMsg!.type).toBe('tool-result');
    expect(toolMsg!.role).toBe('tool');
    expect(toolMsg!.toolCallId).toBe('call_abc');
    // Verify the content is valid JSON containing the answers
    const parsed = JSON.parse(toolMsg!.content);
    expect(parsed).toEqual({ name: { type: 'direct', value: 'Alice' } });
  });

  it('should add approval marker for tool-confirm approved', async () => {
    const { respond } = await import('../../../src/hitl/respond.js');

    let state = makeState();
    state = addAssistantMessage(state, 'Deleting file', {
      type: 'action',
      toolCalls: [{ id: 'call_xyz', name: 'delete_file', arguments: { path: '/tmp/x' } }],
    });

    const request: HumanRequest = {
      type: 'tool-confirm',
      toolName: 'delete_file',
      args: { path: '/tmp/x' },
      toolCallId: 'call_xyz',
    };
    const response: HumanResponse = {
      type: 'tool-confirm',
      approved: true,
    };

    const newState = respond(state, request, response);

    // Should have marked the tool as approved in context
    expect(newState.context.hitlApprovals).toContain('call_xyz');
    // No tool-result message yet (tool will execute on next run)
    const toolMsg = newState.context.messages.find(
      (m) => m.role === 'tool' && m.toolCallId === 'call_xyz'
    );
    expect(toolMsg).toBeUndefined();
  });

  it('should add rejection message for tool-confirm rejected', async () => {
    const { respond } = await import('../../../src/hitl/respond.js');

    let state = makeState();
    state = addAssistantMessage(state, 'Deleting file', {
      type: 'action',
      toolCalls: [{ id: 'call_rej', name: 'delete_file', arguments: { path: '/tmp/x' } }],
    });

    const request: HumanRequest = {
      type: 'tool-confirm',
      toolName: 'delete_file',
      args: { path: '/tmp/x' },
      toolCallId: 'call_rej',
    };
    const response: HumanResponse = {
      type: 'tool-confirm',
      approved: false,
    };

    const newState = respond(state, request, response);

    // Should have added a tool-result message with rejection
    const toolMsg = newState.context.messages.find(
      (m) => m.role === 'tool' && m.toolCallId === 'call_rej'
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toContain('rejected');
    // ERR2: rejected tool result must carry isError so the LLM can tell a
    // rejection apart from a successful tool call.
    expect(toolMsg!.isError).toBe(true);
    // No approval marker
    expect(newState.context.hitlApprovals).toBeUndefined();
  });
});

describe('HITL V2: HitlMiddleware approval passthrough', () => {
  it('should let through confirmed tools that are already approved in hitlApprovals', async () => {
    const { HitlMiddleware } = await import('../../../src/hitl/middleware.js');

    const mw = new HitlMiddleware({ confirmTools: ['delete_file'] });

    const state = makeState();
    // Mark the tool call as already approved
    const approvedState = {
      ...state,
      context: { ...state.context, hitlApprovals: ['call_approved'] },
    };

    const execState = makeExecStateWithAction('delete_file', {
      path: '/tmp/already-approved.txt',
    });
    // Use the approved call ID
    execState.action = { id: 'call_approved', tool: 'delete_file', arguments: { path: '/tmp/x' } };
    execState.allActions = [execState.action];
    execState.phase = {
      type: 'executing-tool' as const,
      actions: [execState.action],
    };

    const chain = await (
      new MiddlewareExecutor([mw as unknown as AgentMiddleware]) as any
    ).runBeforeAdvance({
      state: approvedState,
      execState,
      fromPhase: { type: 'parsed', thought: 'Deleting' } as Phase,
      stepNumber: 0,
      runnerOptions: {} as any,
    });

    // Should NOT intercept — tool is already approved
    expect(chain.stopResult).toBeUndefined();
  });
});

describe('HITL V2: respond() edge cases', () => {
  it('should return unchanged state for unknown response type', async () => {
    const { respond } = await import('../../../src/hitl/respond.js');

    const state = makeState();
    const request: HumanRequest = {
      type: 'question',
      questions: [{ id: 'q1', question: 'Name?', type: 'text' }],
      toolCallId: 'c1',
    };
    // Cast to any to simulate an unknown response type
    const response = { type: 'unknown-type' } as unknown as HumanResponse;

    const newState = respond(state, request, response);

    // State should be unchanged — no new messages, no approvals
    expect(newState.context.messages).toEqual(state.context.messages);
    expect(newState.context.hitlApprovals).toBeUndefined();
  });
});

describe('HITL V2: Integration with runner', () => {
  it(
    'should return waiting-human when LLM calls a confirmed tool',
    { timeout: 10000 },
    async () => {
      const { AgentRunner } = await import('../../../src/runner/index.js');
      const { HitlMiddleware } = await import('../../../src/hitl/middleware.js');
      const { respond } = await import('../../../src/hitl/respond.js');

      // Mock LLM that calls delete_file
      const mockLLM = {
        call: vi.fn().mockResolvedValue({
          content: '',
          stopReason: 'tool_call',
          tokens: { input: 50, output: 20 },
          toolCalls: [{ id: 'tc_1', name: 'delete_file', arguments: { path: '/tmp/x' } }],
        }),
        stream: vi.fn().mockImplementation(async function* () {
          yield {
            type: 'tool_call',
            toolCall: { id: 'tc_1', name: 'delete_file', arguments: { path: '/tmp/x' } },
          };
          yield { type: 'done', roundTotalTokens: { input: 50, output: 20 } };
        }),
        getModelMeta: vi.fn().mockReturnValue({ contextWindow: 128000, maxTokens: 4096 }),
      };

      const runner = new AgentRunner({
        llmClient: mockLLM as any,
        model: 'test-model',
        middleware: [new HitlMiddleware({ confirmTools: ['delete_file'] })],
      });

      const executeFn = vi.fn().mockResolvedValue({ success: true });

      // Register the delete_file tool
      runner.registerTool({
        name: 'delete_file',
        description: 'Delete a file',
        parameters: z.object({ path: z.string() }),
        execute: executeFn,
      });

      const state = createAgentState({
        name: 'test',
        instructions: 'test',
        tools: [],
      });

      const { state: runState, result } = await runner.run(state);

      // Should return waiting-human, not blocked
      expect(result.type).toBe('waiting-human');
      if (result.type === 'waiting-human') {
        expect(result.request.type).toBe('tool-confirm');
        if (result.request.type === 'tool-confirm') {
          expect(result.request.toolName).toBe('delete_file');
        }
      }

      // The delete_file tool should NOT have been executed
      expect(executeFn).not.toHaveBeenCalled();
    }
  );

  it('should let approved tool execute on second run after respond()', async () => {
    const { AgentRunner } = await import('../../../src/runner/index.js');
    const { HitlMiddleware } = await import('../../../src/hitl/middleware.js');
    const { respond } = await import('../../../src/hitl/respond.js');

    const executeFn = vi.fn().mockResolvedValue({ deleted: true });

    // Stream sequence: 1st = delete_file tool call (waiting-human),
    // 2nd = delete_file tool call again (approved → executes),
    // 3rd = final answer.
    const responses = [
      {
        toolCalls: [{ id: 'tc_approve', name: 'delete_file', arguments: { path: '/tmp/x' } }],
        tokens: { input: 50, output: 20 },
      },
      {
        toolCalls: [{ id: 'tc_approve', name: 'delete_file', arguments: { path: '/tmp/x' } }],
        tokens: { input: 50, output: 20 },
      },
      {
        content: 'File deleted successfully',
        tokens: { input: 60, output: 10 },
      },
    ];
    let responseIndex = 0;
    const mockLLM = {
      call: vi.fn(),
      stream: vi.fn().mockImplementation(async function* () {
        const response = responses[responseIndex++] ?? responses[responses.length - 1];
        if (response.toolCalls?.length) {
          for (const toolCall of response.toolCalls) {
            yield { type: 'tool_call', toolCall };
          }
        }
        if (response.content) {
          yield {
            type: 'text',
            delta: response.content,
            accumulatedContent: response.content,
          };
        }
        yield { type: 'done', roundTotalTokens: response.tokens };
      }),
      getModelMeta: vi.fn().mockReturnValue({ contextWindow: 128000, maxTokens: 4096 }),
    };

    const runner = new AgentRunner({
      llmClient: mockLLM as any,
      model: 'test-model',
      middleware: [new HitlMiddleware({ confirmTools: ['delete_file'] })],
    });

    runner.registerTool({
      name: 'delete_file',
      description: 'Delete a file',
      parameters: z.object({ path: z.string() }),
      execute: executeFn,
    });

    let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });

    // First run: should return waiting-human
    const { state: stateAfterFirstRun, result: firstResult } = await runner.run(state);
    expect(firstResult.type).toBe('waiting-human');

    // Approve the tool
    const approvedState = respond(stateAfterFirstRun, (firstResult as any).request, {
      type: 'tool-confirm',
      approved: true,
    });

    // Second run: tool should execute normally
    const { result: secondResult } = await runner.run(approvedState);
    expect(executeFn).toHaveBeenCalledTimes(1);
    // Tool receives (args, options?) — verify args contain the expected path
    const callArgs = executeFn.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs).toEqual(expect.objectContaining({ path: '/tmp/x' }));
    // Run should complete successfully after tool execution + LLM final answer
    if (secondResult.type === 'error') {
      throw new Error(`Unexpected error: ${secondResult.error.message}`);
    }
  });
});

// ============================================================================
// HITL interrupt-terminal-state: typed suspension through the kernel
// (R2P-108, aligned with Rust a2d508d / ca8276f / 9a2bcd3)
// ============================================================================
describe('HITL: typed suspension through the kernel', () => {
  /** Registry whose ask_human tool always requests suspension. */
  async function suspendRegistry() {
    const { ToolRegistry } = await import('../../../src/tools/registry.js');
    const { createAskHumanTool } = await import('../../../src/tools/ask-human.js');
    const registry = new ToolRegistry();
    registry.register(
      createAskHumanTool(async ({ questions, context }) => ({
        type: 'suspend' as const,
        questions,
        context,
        toolCallId: 'human-bridge-made-up',
      }))
    );
    return registry;
  }

  function makeCtx() {
    return {
      executionPolicy: {
        onToolError: vi.fn((error: Error) => ({
          decision: 'continue' as const,
          sanitizedResult: `Error: ${error.message}`,
        })),
      },
    } as any;
  }

  it('handler suspends: waiting-human phase, pendingInterrupts persisted with the LLM action id, no tool result written', async () => {
    const { ExecutingToolHandler } =
      await import('../../../src/execution-engine/handlers/executing-tool-handler.js');
    const handler = new ExecutingToolHandler();
    const state = makeState();
    const execState = {
      phase: {
        type: 'executing-tool' as const,
        actions: [
          {
            id: 'call_00_llm',
            tool: 'ask_human',
            arguments: {
              questions: [{ id: 'q1', question: 'name?', type: 'text' }],
              context: 'need name',
            },
          },
        ],
      },
    } as any;
    const ctx = makeCtx();

    const result = await handler.execute(ctx, state, execState, await suspendRegistry());

    // Terminal phase: waiting-human with the (retargeted) first request.
    expect(result.done).toBe(true);
    expect(result.phase.type).toBe('waiting-human');
    const request = (result.phase as { request: HumanRequest }).request;
    expect(request.type).toBe('question');
    // ca8276f anti-400 invariant: the persisted id is the LLM's action id,
    // never the bridge-invented one.
    expect(request.toolCallId).toBe('call_00_llm');
    expect(request.toolCallId.startsWith('human-')).toBe(false);

    // pendingInterrupts carries the question payload (toolCallId + questions + context).
    const list = result.state.context.pendingInterrupts;
    expect(list).toHaveLength(1);
    expect(list![0].request.toolCallId).toBe('call_00_llm');
    if (list![0].request.type === 'question') {
      expect(list![0].request.questions[0].question).toBe('name?');
      expect(list![0].request.context).toBe('need name');
    }
    expect(typeof list![0].createdAt).toBe('number');

    // No tool result message — the question has no answer yet.
    const toolMsg = result.state.context.messages.find(
      (m) => m.role === 'tool' && m.toolCallId === 'call_00_llm'
    );
    expect(toolMsg).toBeUndefined();

    // Suspension is a control signal, not a failure: the error policy must
    // never see it (9a2bcd3).
    expect(ctx.executionPolicy.onToolError).not.toHaveBeenCalled();
  });

  it('parallel double-ask: both requests enter pendingInterrupts, each paired with its own action id', async () => {
    const { ExecutingToolHandler } =
      await import('../../../src/execution-engine/handlers/executing-tool-handler.js');
    const handler = new ExecutingToolHandler();
    const state = makeState();
    const execState = {
      phase: {
        type: 'executing-tool' as const,
        actions: [
          {
            id: 'call_A',
            tool: 'ask_human',
            arguments: { questions: [{ id: 'qa', question: 'first?', type: 'text' }] },
          },
          {
            id: 'call_B',
            tool: 'ask_human',
            arguments: { questions: [{ id: 'qb', question: 'second?', type: 'text' }] },
          },
        ],
      },
    } as any;

    const result = await handler.execute(makeCtx(), state, execState, await suspendRegistry());

    expect(result.phase.type).toBe('waiting-human');
    const list = result.state.context.pendingInterrupts!;
    expect(list).toHaveLength(2);
    const ids = list.map((p) => p.request.toolCallId).sort();
    expect(ids).toEqual(['call_A', 'call_B']);
    // First request takes the phase.
    const phaseRequest = (result.phase as { request: HumanRequest }).request;
    expect(['call_A', 'call_B']).toContain(phaseRequest.toolCallId);
  });

  it('respond + removePendingInterrupt clears the answered entry and keeps the sibling (no cross-talk)', async () => {
    const { respond } = await import('../../../src/hitl/respond.js');
    const { upsertPendingInterrupt, removePendingInterrupt } =
      await import('../../../src/hitl/interrupts.js');

    const first: HumanRequest = {
      type: 'question',
      questions: [{ id: 'qa', question: 'first?', type: 'text' }],
      toolCallId: 'call_A',
    };
    const second: HumanRequest = {
      type: 'question',
      questions: [{ id: 'qb', question: 'second?', type: 'text' }],
      toolCallId: 'call_B',
    };
    let state = upsertPendingInterrupt(makeState(), first);
    state = upsertPendingInterrupt(state, second);

    // Answer the first (respond injects the tool message; remove consumes
    // the pending entry — same sequence as the Rust respond_and_continue).
    state = respond(state, first, {
      type: 'question',
      answers: { qa: { type: 'direct', value: 'A' } },
    });
    state = removePendingInterrupt(state, 'call_A');

    expect(state.context.pendingInterrupts).toHaveLength(1);
    expect(state.context.pendingInterrupts![0].request.toolCallId).toBe('call_B');

    // The injected tool result pairs with the assistant row's tool call id.
    const toolMsg = state.context.messages.find(
      (m) => m.role === 'tool' && m.toolCallId === 'call_A'
    );
    expect(toolMsg).toBeDefined();
    expect(JSON.parse(toolMsg!.content)).toEqual({ qa: { type: 'direct', value: 'A' } });

    // Answer the sibling too — list clears to undefined.
    state = respond(state, second, {
      type: 'question',
      answers: { qb: { type: 'direct', value: 'B' } },
    });
    state = removePendingInterrupt(state, 'call_B');
    expect(state.context.pendingInterrupts).toBeUndefined();
  });

  it(
    'runner end-to-end: ask_human suspension → waiting-human + persisted pendingInterrupts; answer pairs by action id',
    { timeout: 10000 },
    async () => {
      const { AgentRunner } = await import('../../../src/runner/index.js');
      const { respond } = await import('../../../src/hitl/respond.js');
      const { removePendingInterrupt } = await import('../../../src/hitl/interrupts.js');
      const { createAskHumanTool } = await import('../../../src/tools/ask-human.js');

      // Mock LLM: first round asks via ask_human (LLM-generated call id).
      const mockLLM = {
        call: vi.fn(),
        stream: vi.fn().mockImplementation(async function* () {
          yield {
            type: 'tool_call',
            toolCall: {
              id: 'tc_00_llm',
              name: 'ask_human',
              arguments: {
                questions: [
                  {
                    id: 'q1',
                    question: 'Deploy now?',
                    type: 'single-select',
                    options: ['yes', 'no'],
                  },
                ],
                context: 'release gate',
              },
            },
          };
          yield { type: 'done', roundTotalTokens: { input: 50, output: 20 } };
        }),
        getModelMeta: vi.fn().mockReturnValue({ contextWindow: 128000, maxTokens: 4096 }),
      };

      const runner = new AgentRunner({
        llmClient: mockLLM as any,
        model: 'test-model',
      });
      runner.registerTool(
        createAskHumanTool(async ({ questions, context }) => ({
          type: 'suspend' as const,
          questions,
          context,
          toolCallId: 'human-bridge-made-up',
        }))
      );

      const { state: runState, result } = await runner.run(makeState());

      expect(result.type).toBe('waiting-human');
      if (result.type === 'waiting-human') {
        // The surfaced request carries the LLM's action id, not the bridge's.
        expect(result.request.toolCallId).toBe('tc_00_llm');
      }

      // Persistence: the unanswered question survives in state (round
      // switch / restart does not lose it).
      const list = runState.context.pendingInterrupts;
      expect(list).toHaveLength(1);
      expect(list![0].request.toolCallId).toBe('tc_00_llm');
      if (list![0].request.type === 'question') {
        expect(list![0].request.questions[0].question).toBe('Deploy now?');
        expect(list![0].request.context).toBe('release gate');
      }

      // Answer via respond + removePendingInterrupt, then assert pairing:
      // the tool-result row's toolCallId equals the assistant row's
      // toolCalls id (a mismatch is what OpenAI-compat endpoints reject
      // with 400 "tool_call_ids did not have response messages").
      const answered = respond(runState, list![0].request, {
        type: 'question',
        answers: { q1: { type: 'direct', value: 'yes' } },
      });
      const cleared = removePendingInterrupt(answered, 'tc_00_llm');
      expect(cleared.context.pendingInterrupts).toBeUndefined();

      const msgs = cleared.context.messages;
      const askId = msgs
        .flatMap((m) => (m as { toolCalls?: Array<{ id: string; name: string }> }).toolCalls ?? [])
        .find((tc) => tc.name === 'ask_human')?.id;
      expect(askId).toBe('tc_00_llm');
      expect(askId!.startsWith('human-')).toBe(false);
      expect(msgs.some((m) => m.role === 'tool' && m.toolCallId === askId)).toBe(true);
    }
  );

  it('plain tool errors still go through the error policy (suspension interception does not leak)', async () => {
    const { ExecutingToolHandler } =
      await import('../../../src/execution-engine/handlers/executing-tool-handler.js');
    const { ToolRegistry } = await import('../../../src/tools/registry.js');
    const handler = new ExecutingToolHandler();
    const execState = {
      phase: {
        type: 'executing-tool' as const,
        actions: [{ id: 'call_x', tool: 'boom', arguments: {} }],
      },
    } as any;
    const registry = new ToolRegistry();
    registry.register({
      name: 'boom',
      description: 'always fails',
      parameters: z.object({}),
      execute: async () => {
        throw new Error('kaput');
      },
    });

    const ctx = makeCtx();
    const result = await handler.execute(ctx, makeState(), execState, registry);
    expect(ctx.executionPolicy.onToolError).toHaveBeenCalledTimes(1);
    expect(result.phase.type).toBe('tool-result');
  });
});
