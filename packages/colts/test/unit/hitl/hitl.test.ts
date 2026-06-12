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
  it('should intercept ask_human tool at executing-tool phase', async () => {
    // Import HitlMiddleware — this test should FAIL because it doesn't exist yet
    const { HitlMiddleware } = await import('../../../src/hitl/middleware.js');

    const mw = new HitlMiddleware({ askHumanToolName: 'ask_human' });
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

    // Middleware should stop execution and return an AdvanceResult with waiting-human phase
    expect(chain.stopResult).toBeDefined();
    expect(chain.stopResult.phase.type).toBe('waiting-human');
    expect(chain.stopResult.done).toBe(true);

    // Verify the request contains the question data
    const request = chain.stopResult.phase.request as HumanRequest;
    expect(request.type).toBe('question');
    if (request.type === 'question') {
      expect(request.questions).toHaveLength(1);
      expect(request.questions[0].id).toBe('q1');
      expect(request.toolCallId).toBe('call_1');
    }
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
        stream: vi.fn(),
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

  it('should return waiting-human via runStream()', async () => {
    const { AgentRunner } = await import('../../../src/runner/index.js');
    const { HitlMiddleware } = await import('../../../src/hitl/middleware.js');

    async function* mockStream() {
      yield { type: 'text', delta: '', accumulatedContent: '' };
      yield {
        type: 'tool_call',
        toolCall: { id: 'tc_stream', name: 'delete_file', arguments: { path: '/tmp/x' } },
      };
      yield { type: 'done', roundTotalTokens: { input: 50, output: 20 } };
    }

    const mockLLM = {
      call: vi.fn(),
      stream: vi.fn().mockImplementation(mockStream),
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
      execute: vi.fn().mockResolvedValue({ success: true }),
    });

    const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });

    const gen = runner.runStream(state);
    let lastReturn: any;
    while (true) {
      const { done, value } = await gen.next();
      if (done) {
        lastReturn = value;
        break;
      }
    }

    expect(lastReturn).toBeDefined();
    expect(lastReturn.result.type).toBe('waiting-human');
    if (lastReturn.result.type === 'waiting-human') {
      expect(lastReturn.result.request.type).toBe('tool-confirm');
    }
  });

  it('should let approved tool execute on second run after respond()', async () => {
    const { AgentRunner } = await import('../../../src/runner/index.js');
    const { HitlMiddleware } = await import('../../../src/hitl/middleware.js');
    const { respond } = await import('../../../src/hitl/respond.js');

    const executeFn = vi.fn().mockResolvedValue({ deleted: true });

    const mockLLM = {
      call: vi.fn().mockResolvedValue({
        content: '',
        stopReason: 'tool_call',
        tokens: { input: 50, output: 20 },
        toolCalls: [{ id: 'tc_approve', name: 'delete_file', arguments: { path: '/tmp/x' } }],
      }),
      stream: vi.fn(),
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

    // Need another LLM response for the second run (after tool executes, LLM responds)
    mockLLM.call.mockResolvedValueOnce({
      content: '',
      stopReason: 'tool_call',
      tokens: { input: 50, output: 20 },
      toolCalls: [{ id: 'tc_approve', name: 'delete_file', arguments: { path: '/tmp/x' } }],
    });
    // Second call: tool result processed, LLM gives final answer
    mockLLM.call.mockResolvedValueOnce({
      content: 'File deleted successfully',
      stopReason: 'end_turn',
      tokens: { input: 60, output: 10 },
      toolCalls: [],
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
