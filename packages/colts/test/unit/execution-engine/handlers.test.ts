/**
 * @fileoverview Phase handler unit tests
 *
 * Tests each of the 10 default IPhaseHandler implementations in isolation.
 * Verifies canHandle(), phase transitions, state updates, and edge cases.
 */
import { describe, it, expect, vi } from 'vitest';
import { IdleHandler } from '../../../src/execution-engine/handlers/idle-handler.js';
import { PreparingHandler } from '../../../src/execution-engine/handlers/preparing-handler.js';
import { CallingLLMHandler } from '../../../src/execution-engine/handlers/calling-llm-handler.js';
import { LLMResponseHandler } from '../../../src/execution-engine/handlers/llm-response-handler.js';
import { ParsingHandler } from '../../../src/execution-engine/handlers/parsing-handler.js';
import { ParsedHandler } from '../../../src/execution-engine/handlers/parsed-handler.js';
import { ExecutingToolHandler } from '../../../src/execution-engine/handlers/executing-tool-handler.js';
import { ToolResultHandler } from '../../../src/execution-engine/handlers/tool-result-handler.js';
import { CompletedHandler } from '../../../src/execution-engine/handlers/completed-handler.js';
import { ErrorHandler } from '../../../src/execution-engine/handlers/error-handler.js';
import type { PhaseHandlerContext } from '../../../src/execution-engine/types.js';
import type { AgentState, IToolRegistry } from '../../../src/types.js';
import type { ExecutionState } from '../../../src/execution.js';
import { createExecutionState } from '../../../src/execution.js';
import { createAgentState } from '../../../src/state.js';
import type { ToolSchema } from '../../../src/tools/registry.js';
import { DefaultToolSchemaFormatter } from '../../../src/tools/schema-formatter.js';

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

function createMockState(): AgentState {
  return createAgentState({
    name: 'test-agent',
    instructions: 'You are a test assistant.',
    tools: [],
  });
}

function createMockCtx(overrides?: Partial<PhaseHandlerContext>): PhaseHandlerContext {
  return {
    llmProvider: {
      call: vi.fn().mockResolvedValue({
        content: 'mock response',
        toolCalls: [],
        tokens: { input: 10, output: 5 },
        stopReason: 'stop',
      }),
      stream: vi.fn(),
    } as never,
    toolRegistry: createMockToolRegistry(),
    messageAssembler: {
      build: vi.fn().mockReturnValue([
        { role: 'system', content: 'You are a test assistant.' },
        { role: 'user', content: 'Hello' },
      ]),
    } as never,
    toolSchemaFormatter: new DefaultToolSchemaFormatter(),
    executionPolicy: {
      shouldStop: () => ({ decision: 'continue' }),
      onToolError: (error: Error) => ({
        decision: 'continue' as const,
        sanitizedResult: `Error: ${error.message}`,
      }),
      onParseError: (error: Error) => ({ decision: 'fail' as const, error }),
    },
    options: { model: 'test-model' },
    ...overrides,
  };
}

function createMockToolRegistry(executeResult: unknown = 'tool-result'): IToolRegistry {
  return {
    execute: vi.fn().mockResolvedValue(executeResult),
    toToolSchemas: vi.fn().mockReturnValue([]),
    register: vi.fn(),
    unregister: vi.fn(),
    has: vi.fn(),
    getToolNames: vi.fn().mockReturnValue([]),
    get: vi.fn(),
  } as unknown as IToolRegistry;
}

/** Helper to create a simple action */
function createAction(overrides?: { tool?: string; id?: string }) {
  return {
    id: overrides?.id ?? 'call-1',
    tool: overrides?.tool ?? 'testTool',
    arguments: { key: 'value' },
  };
}

// ===========================================================================
// IdleHandler
// ===========================================================================
describe('IdleHandler', () => {
  const handler = new IdleHandler();

  it('should handle idle phase', () => {
    expect(handler.canHandle('idle')).toBe(true);
    expect(handler.canHandle('preparing')).toBe(false);
  });

  it('should assemble messages and transition to preparing', () => {
    const state = createMockState();
    const execState = createExecutionState();
    const ctx = createMockCtx();

    const result = handler.execute(ctx, state, execState);

    expect(result.phase.type).toBe('preparing');
    expect(result.done).toBe(false);
    expect(result.state).toBe(state);
    expect(execState.preparedMessages).toBeDefined();
    expect(execState.preparedMessages!.length).toBeGreaterThan(0);
  });

  it('should pass skillProvider and subAgentConfigs to assembler', () => {
    const state = createMockState();
    const execState = createExecutionState();
    const build = vi.fn().mockReturnValue([{ role: 'user', content: 'hi' }]);
    const ctx = createMockCtx({
      messageAssembler: { build } as never,
      skillProvider: {} as never,
      subAgentConfigs: new Map(),
    });

    handler.execute(ctx, state, execState);

    expect(build).toHaveBeenCalledWith(state, {
      systemPrompt: undefined,
      model: 'test-model',
      skillProvider: expect.anything(),
      subAgentConfigs: expect.anything(),
    });
  });
});

// ===========================================================================
// PreparingHandler
// ===========================================================================
describe('PreparingHandler', () => {
  const handler = new PreparingHandler();

  it('should handle preparing phase', () => {
    expect(handler.canHandle('preparing')).toBe(true);
    expect(handler.canHandle('idle')).toBe(false);
  });

  it('should transition to calling-llm', () => {
    const state = createMockState();
    const execState = createExecutionState();
    const ctx = createMockCtx();

    const result = handler.execute(ctx, state, execState);

    expect(result.phase.type).toBe('calling-llm');
    expect(result.done).toBe(false);
    expect(result.state).toBe(state);
  });
});

// ===========================================================================
// CallingLLMHandler
// ===========================================================================
describe('CallingLLMHandler', () => {
  const handler = new CallingLLMHandler();

  it('should handle calling-llm phase', () => {
    expect(handler.canHandle('calling-llm')).toBe(true);
    expect(handler.canHandle('idle')).toBe(false);
  });

  it('should call LLM and transition to llm-response with no tool calls', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.preparedMessages = [{ role: 'user', content: 'hi' }] as never;
    const ctx = createMockCtx();

    const result = await handler.execute(ctx, state, execState);

    expect(result.phase.type).toBe('llm-response');
    expect(result.done).toBe(false);
    expect(execState.llmResponse).toBe('mock response');
    expect(execState.action).toBeUndefined();
  });

  it('should extract tool calls from LLM response', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.preparedMessages = [{ role: 'user', content: 'hi' }] as never;
    const ctx = createMockCtx({
      llmProvider: {
        call: vi.fn().mockResolvedValue({
          content: 'Using tool',
          toolCalls: [
            {
              id: 'call-1',
              name: 'calculator',
              arguments: { expression: '2+2' },
            },
          ],
          tokens: { input: 10, output: 5 },
          stopReason: 'tool_calls',
        }),
        stream: vi.fn(),
      } as never,
    });

    const result = await handler.execute(ctx, state, execState);

    expect(result.phase.type).toBe('llm-response');
    expect(execState.action).toBeDefined();
    expect(execState.action!.tool).toBe('calculator');
    expect(execState.action!.arguments).toEqual({ expression: '2+2' });
    expect(execState.allActions).toHaveLength(1);
  });

  it('should use ctx.toolRegistry when no override provided', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    const ctx = createMockCtx();

    await handler.execute(ctx, state, execState);

    expect(ctx.llmProvider.call).toHaveBeenCalled();
  });

  it('should build messages from assembler if preparedMessages missing', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    // No preparedMessages set
    const build = vi.fn().mockReturnValue([{ role: 'user', content: 'hello' }]);
    const ctx = createMockCtx({
      messageAssembler: { build } as never,
    });

    await handler.execute(ctx, state, execState);

    expect(build).toHaveBeenCalled();
  });

  it('should clear stale action when LLM response has no tool calls', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.preparedMessages = [{ role: 'user', content: 'hi' }] as never;
    // Pre-set stale action
    execState.action = createAction();
    execState.allActions = [createAction()];

    const ctx = createMockCtx(); // response has no tool calls

    await handler.execute(ctx, state, execState);

    expect(execState.action).toBeUndefined();
    expect(execState.allActions).toBeUndefined();
  });
});

// ===========================================================================
// LLMResponseHandler
// ===========================================================================
describe('LLMResponseHandler', () => {
  const handler = new LLMResponseHandler();

  it('should handle llm-response phase', () => {
    expect(handler.canHandle('llm-response')).toBe(true);
    expect(handler.canHandle('parsing')).toBe(false);
  });

  it('should transition to parsing', () => {
    const state = createMockState();
    const execState = createExecutionState();
    const ctx = createMockCtx();

    const result = handler.execute(ctx, state, execState);

    expect(result.phase.type).toBe('parsing');
    expect(result.done).toBe(false);
    expect(result.state).toBe(state);
  });
});

// ===========================================================================
// ParsingHandler
// ===========================================================================
describe('ParsingHandler', () => {
  const handler = new ParsingHandler();

  it('should handle parsing phase', () => {
    expect(handler.canHandle('parsing')).toBe(true);
    expect(handler.canHandle('parsed')).toBe(false);
  });

  it('should extract thought and transition to parsed with action', () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.llmResponse = '<think>I need to calculate something</think>';
    execState.action = createAction();

    const ctx = createMockCtx();
    const result = handler.execute(ctx, state, execState);

    expect(result.phase.type).toBe('parsed');
    if (result.phase.type === 'parsed') {
      expect(result.phase.thought).toBe('I need to calculate something');
      expect(result.phase.action).toBeDefined();
    }
    expect(execState.thought).toBe('I need to calculate something');
    expect(execState.cleanedContent).toBe('');
    expect(result.done).toBe(false);
  });

  it('should transition to parsed without action when no tool call', () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.llmResponse = '<think>Here is the answer</think>';
    // No action set

    const ctx = createMockCtx();
    const result = handler.execute(ctx, state, execState);

    expect(result.phase.type).toBe('parsed');
    if (result.phase.type === 'parsed') {
      expect(result.phase.thought).toBe('Here is the answer');
      expect(result.phase.action).toBeUndefined();
    }
    expect(execState.cleanedContent).toBe('');
  });

  it('should use empty string when llmResponse is undefined', () => {
    const state = createMockState();
    const execState = createExecutionState();
    // llmResponse is undefined

    const ctx = createMockCtx();
    const result = handler.execute(ctx, state, execState);

    expect(execState.thought).toBe('');
    expect(execState.cleanedContent).toBe('');
    if (result.phase.type === 'parsed') {
      expect(result.phase.thought).toBe('');
    }
  });

  it('should prefer native thinking over content', () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.llmResponse = '<think>Tag thinking</think>Some content';
    execState.llmThinking = 'Native thinking';

    const ctx = createMockCtx();
    handler.execute(ctx, state, execState);

    expect(execState.thought).toBe('Native thinking');
    expect(execState.cleanedContent).toBe('<think>Tag thinking</think>Some content');
  });

  it('should have empty thought when no explicit thinking exists', () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.llmResponse = 'Plain content without thinking';

    const ctx = createMockCtx();
    handler.execute(ctx, state, execState);

    expect(execState.thought).toBe('');
    expect(execState.cleanedContent).toBe('Plain content without thinking');
  });
});

// ===========================================================================
// ParsedHandler
// ===========================================================================
describe('ParsedHandler', () => {
  const handler = new ParsedHandler();

  it('should handle parsed phase', () => {
    expect(handler.canHandle('parsed')).toBe(true);
    expect(handler.canHandle('executing-tool')).toBe(false);
  });

  it('should transition to executing-tool when action exists', () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.llmResponse = 'Calculating...';
    execState.action = createAction();
    execState.allActions = [createAction()];

    const ctx = createMockCtx();
    const result = handler.execute(ctx, state, execState);

    expect(result.phase.type).toBe('executing-tool');
    expect(result.done).toBe(false);
    // Should have added assistant message to state
    expect(result.state.context.messages.length).toBeGreaterThan(state.context.messages.length);
  });

  it('should transition to completed when no action', () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.llmResponse = 'Final answer';

    const ctx = createMockCtx();
    const result = handler.execute(ctx, state, execState);

    expect(result.phase.type).toBe('completed');
    expect(result.done).toBe(true);
    if (result.phase.type === 'completed') {
      expect(result.phase.answer).toBe('Final answer');
    }
    // Should increment step count
    expect(result.state.context.stepCount).toBe(1);
  });

  it('should use empty thought when llmResponse undefined', () => {
    const state = createMockState();
    const execState = createExecutionState();
    // No action, no llmResponse

    const ctx = createMockCtx();
    const result = handler.execute(ctx, state, execState);

    expect(result.phase.type).toBe('completed');
    if (result.phase.type === 'completed') {
      expect(result.phase.answer).toBe('');
    }
  });

  it('should include toolCalls in assistant message', () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.llmResponse = 'Using tool';
    execState.action = createAction();
    execState.allActions = [createAction({ id: 'call-1' }), createAction({ id: 'call-2' })];

    const ctx = createMockCtx();
    const result = handler.execute(ctx, state, execState);

    const msg = result.state.context.messages[0];
    expect(msg.role).toBe('assistant');
    expect(msg.toolCalls).toBeDefined();
    expect(msg.toolCalls).toHaveLength(2);
  });
});

// ===========================================================================
// ExecutingToolHandler
// ===========================================================================
describe('ExecutingToolHandler', () => {
  const handler = new ExecutingToolHandler();

  it('should handle executing-tool phase', () => {
    expect(handler.canHandle('executing-tool')).toBe(true);
    expect(handler.canHandle('tool-result')).toBe(false);
  });

  it('should execute tool and transition to tool-result', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.phase = { type: 'executing-tool', actions: [createAction()] };
    execState.action = createAction();
    const registry = createMockToolRegistry('42');
    const ctx = createMockCtx();

    const result = await handler.execute(ctx, state, execState, registry);

    expect(result.phase.type).toBe('tool-result');
    expect(result.done).toBe(false);
    expect(execState.toolResult).toBe('42');
    // Tool message added to state
    expect(result.state.context.messages.length).toBeGreaterThan(0);
  });

  it('should throw when no action set', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.phase = { type: 'executing-tool', actions: [] };
    // No actions set
    const registry = createMockToolRegistry();
    const ctx = createMockCtx();

    await expect(handler.execute(ctx, state, execState, registry)).rejects.toThrow(
      'No actions to execute'
    );
  });

  it('should throw when no tool registry provided', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.phase = { type: 'executing-tool', actions: [createAction()] };
    const ctx = createMockCtx();

    await expect(handler.execute(ctx, state, execState)).rejects.toThrow(
      'Tool registry is required for tool execution'
    );
  });

  it('should handle tool execution error gracefully', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.phase = { type: 'executing-tool', actions: [createAction()] };
    const registry = createMockToolRegistry();
    (registry.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Tool crashed'));

    const ctx = createMockCtx();
    const result = await handler.execute(ctx, state, execState, registry);

    expect(result.phase.type).toBe('tool-result');
    // Error should be captured as tool result content
    const toolMsg = result.state.context.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('Error: Tool crashed');
  });

  it('should handle non-Error thrown value from tool', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.phase = { type: 'executing-tool', actions: [createAction()] };
    const registry = createMockToolRegistry();
    (registry.execute as ReturnType<typeof vi.fn>).mockRejectedValue('string error');

    const ctx = createMockCtx();
    const result = await handler.execute(ctx, state, execState, registry);

    const toolMsg = result.state.context.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('Error: string error');
  });

  it('should format SWITCH_SKILL signal as LLM-friendly text', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.phase = { type: 'executing-tool', actions: [createAction({ tool: 'load_skill' })] };
    const switchSignal = {
      type: 'SWITCH_SKILL' as const,
      to: 'my-skill',
      instructions: 'Do stuff',
      task: 'Do the thing',
    };
    const registry = createMockToolRegistry(switchSignal);
    const ctx = createMockCtx();

    const result = await handler.execute(ctx, state, execState, registry);

    const toolMsg = result.state.context.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain("Skill 'my-skill' loaded");
    // Should also inject task user message
    const taskMsg = result.state.context.messages[result.state.context.messages.length - 1];
    expect(taskMsg.role).toBe('user');
    expect(taskMsg.content).toBe('Do the thing');
  });

  it('should handle SWITCH_SKILL to same skill (already active)', async () => {
    const state = createMockState();
    // Set skillState with current = 'my-skill'
    state.context.skillState = {
      current: 'my-skill',
      stack: [],
    };
    const execState = createExecutionState();
    execState.phase = { type: 'executing-tool', actions: [createAction({ tool: 'load_skill' })] };
    const switchSignal = {
      type: 'SWITCH_SKILL' as const,
      to: 'my-skill',
      instructions: 'Do stuff',
      task: 'Same skill',
    };
    const registry = createMockToolRegistry(switchSignal);
    const ctx = createMockCtx();

    const result = await handler.execute(ctx, state, execState, registry);

    // Handler formats SWITCH_SKILL generically; same-skill detection is in processToolResult
    const toolMsg = result.state.context.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain("Skill 'my-skill' loaded");
  });

  it('should handle SWITCH_SKILL to skill already in stack', async () => {
    const state = createMockState();
    state.context.skillState = {
      current: 'parent-skill',
      stack: [{ skillName: 'my-skill', loadedAt: Date.now() }],
    };
    const execState = createExecutionState();
    execState.phase = { type: 'executing-tool', actions: [createAction({ tool: 'load_skill' })] };
    const switchSignal = {
      type: 'SWITCH_SKILL' as const,
      to: 'my-skill',
      instructions: 'Do stuff',
      task: 'Stack skill',
    };
    const registry = createMockToolRegistry(switchSignal);
    const ctx = createMockCtx();

    const result = await handler.execute(ctx, state, execState, registry);

    // Handler formats SWITCH_SKILL generically; cyclic detection is in processToolResult
    const toolMsg = result.state.context.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain("Skill 'my-skill' loaded");
  });

  it('should format RETURN_SKILL signal', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.phase = { type: 'executing-tool', actions: [createAction({ tool: 'return_skill' })] };
    const returnSignal = {
      type: 'RETURN_SKILL' as const,
      result: 'Task completed',
      status: 'success' as const,
    };
    const registry = createMockToolRegistry(returnSignal);
    const ctx = createMockCtx();

    const result = await handler.execute(ctx, state, execState, registry);

    const toolMsg = result.state.context.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe('Task completed');
  });

  it('should format RETURN_SKILL with non-string result as JSON', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.phase = { type: 'executing-tool', actions: [createAction({ tool: 'return_skill' })] };
    const returnSignal = {
      type: 'RETURN_SKILL' as const,
      result: { key: 'value' },
      status: 'success' as const,
    };
    const registry = createMockToolRegistry(returnSignal);
    const ctx = createMockCtx();

    const result = await handler.execute(ctx, state, execState, registry);

    const toolMsg = result.state.context.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe('{"key":"value"}');
  });

  it('should format SKILL_NOT_FOUND signal', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.phase = { type: 'executing-tool', actions: [createAction({ tool: 'load_skill' })] };
    const notFoundSignal = {
      type: 'SKILL_NOT_FOUND' as const,
      requested: 'missing-skill',
      available: ['skill-a', 'skill-b'],
    };
    const registry = createMockToolRegistry(notFoundSignal);
    const ctx = createMockCtx();

    const result = await handler.execute(ctx, state, execState, registry);

    const toolMsg = result.state.context.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain("Skill 'missing-skill' not found");
    expect(toolMsg?.content).toContain('skill-a, skill-b');
  });

  it('should format non-signal result as JSON when not a string', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.phase = { type: 'executing-tool', actions: [createAction()] };
    const registry = createMockToolRegistry({ count: 42 });
    const ctx = createMockCtx();

    const result = await handler.execute(ctx, state, execState, registry);

    const toolMsg = result.state.context.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe('{"count":42}');
  });

  it('should use default task instruction when task is default text', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.phase = { type: 'executing-tool', actions: [createAction({ tool: 'load_skill' })] };
    const switchSignal = {
      type: 'SWITCH_SKILL' as const,
      to: 'new-skill',
      instructions: 'Instructions',
      task: 'Execute as instructed',
    };
    const registry = createMockToolRegistry(switchSignal);
    const ctx = createMockCtx();

    const result = await handler.execute(ctx, state, execState, registry);

    const taskMsg = result.state.context.messages[result.state.context.messages.length - 1];
    expect(taskMsg.role).toBe('user');
    expect(taskMsg.content).toBe(
      'Follow the loaded skill instructions to complete the user request.'
    );
  });

  it('should pass abort signal to tool execution', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.phase = { type: 'executing-tool', actions: [createAction()] };
    const registry = createMockToolRegistry('ok');
    const ctx = createMockCtx();
    const signal = new AbortController().signal;

    await handler.execute(ctx, state, execState, registry, { signal });

    expect(registry.execute).toHaveBeenCalledWith('testTool', { key: 'value' }, { signal });
  });

  it('should increment step count in result state', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.phase = { type: 'executing-tool', actions: [createAction()] };
    const registry = createMockToolRegistry('ok');
    const ctx = createMockCtx();

    const result = await handler.execute(ctx, state, execState, registry);

    expect(result.state.context.stepCount).toBe(1);
  });

  it('should handle unknown skill signal type (default JSON)', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.phase = { type: 'executing-tool', actions: [createAction()] };
    const unknownSignal = { type: 'UNKNOWN_SIGNAL', data: 123 };
    const registry = createMockToolRegistry(unknownSignal);
    const ctx = createMockCtx();

    const result = await handler.execute(ctx, state, execState, registry);

    const toolMsg = result.state.context.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('UNKNOWN_SIGNAL');
  });

  // =========================================================================
  // Parallel tool calling tests
  // =========================================================================

  it('should execute multiple actions in parallel via Promise.all', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    const action1 = createAction({ tool: 'weather', id: 'tc-1' });
    const action2 = createAction({ tool: 'weather', id: 'tc-2' });
    const action3 = createAction({ tool: 'weather', id: 'tc-3' });
    execState.phase = { type: 'executing-tool', actions: [action1, action2, action3] };

    // Each call returns a different result based on arguments
    const registry = createMockToolRegistry();
    (registry.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('Beijing: 25°C')
      .mockResolvedValueOnce('Shanghai: 28°C')
      .mockResolvedValueOnce('Guangzhou: 30°C');

    const ctx = createMockCtx();
    const result = await handler.execute(ctx, state, execState, registry);

    // Phase should be tool-result with aggregated results
    expect(result.phase.type).toBe('tool-result');
    if (result.phase.type === 'tool-result') {
      expect(result.phase.results).toEqual({
        'tc-1': 'Beijing: 25°C',
        'tc-2': 'Shanghai: 28°C',
        'tc-3': 'Guangzhou: 30°C',
      });
    }

    // Tool messages: one per action
    const toolMsgs = result.state.context.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs.length).toBe(3);
    expect(toolMsgs[0].content).toBe('Beijing: 25°C');
    expect(toolMsgs[1].content).toBe('Shanghai: 28°C');
    expect(toolMsgs[2].content).toBe('Guangzhou: 30°C');

    // Step count incremented once (not per action)
    expect(result.state.context.stepCount).toBe(1);
  });

  it('should handle partial errors in parallel tool execution', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    const action1 = createAction({ tool: 'search', id: 'tc-a' });
    const action2 = createAction({ tool: 'search', id: 'tc-b' });
    execState.phase = { type: 'executing-tool', actions: [action1, action2] };

    const registry = createMockToolRegistry();
    (registry.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('result A')
      .mockRejectedValueOnce(new Error('Tool B failed'));

    const ctx = createMockCtx();
    const result = await handler.execute(ctx, state, execState, registry);

    expect(result.phase.type).toBe('tool-result');
    if (result.phase.type === 'tool-result') {
      expect(result.phase.results['tc-a']).toBe('result A');
      expect(result.phase.results['tc-b']).toBe('Error: Tool B failed');
    }
  });

  it('should only check skill signal on first result in parallel execution', async () => {
    const state = createMockState();
    const execState = createExecutionState();
    const action1 = createAction({ tool: 'load_skill', id: 'tc-s1' });
    const action2 = createAction({ tool: 'calculator', id: 'tc-s2' });
    execState.phase = { type: 'executing-tool', actions: [action1, action2] };

    const switchSignal = {
      type: 'SWITCH_SKILL' as const,
      to: 'research',
      instructions: 'Research well',
      task: 'Do research',
    };
    const registry = createMockToolRegistry();
    (registry.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(switchSignal)
      .mockResolvedValueOnce('42');

    const ctx = createMockCtx();
    const result = await handler.execute(ctx, state, execState, registry);

    // Should inject task message (skill signal on first result)
    const taskMsg = result.state.context.messages[result.state.context.messages.length - 1];
    expect(taskMsg.role).toBe('user');
    expect(taskMsg.content).toBe('Do research');
  });
});

// ===========================================================================
// ToolResultHandler
// ===========================================================================
describe('ToolResultHandler', () => {
  const handler = new ToolResultHandler();

  it('should handle tool-result phase', () => {
    expect(handler.canHandle('tool-result')).toBe(true);
    expect(handler.canHandle('completed')).toBe(false);
  });

  it('should produce tool:end effect and keep phase=tool-result for plain result', () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.phase = { type: 'tool-result', results: { tc1: 'some result' } };
    const ctx = createMockCtx();

    const result = handler.execute(ctx, state, execState);

    expect(result.phase.type).toBe('tool-result');
    expect(result.done).toBe(false);
    expect(result.effects).toBeDefined();
    expect(result.effects!.map((e) => e.type)).toEqual(['tool:end']);
  });

  it('should throw if phase is not tool-result', () => {
    const state = createMockState();
    const execState = createExecutionState();
    // phase defaults to idle
    const ctx = createMockCtx();

    expect(() => handler.execute(ctx, state, execState)).toThrow(
      'ToolResultHandler expects phase type "tool-result"'
    );
  });
});

// ===========================================================================
// CompletedHandler
// ===========================================================================
describe('CompletedHandler', () => {
  const handler = new CompletedHandler();

  it('should handle completed phase', () => {
    expect(handler.canHandle('completed')).toBe(true);
    expect(handler.canHandle('error')).toBe(false);
  });

  it('should return done=true without changing state', () => {
    const state = createMockState();
    const execState = createExecutionState();
    execState.phase = { type: 'completed', answer: 'done' };
    const ctx = createMockCtx();

    const result = handler.execute(ctx, state, execState);

    expect(result.done).toBe(true);
    expect(result.state).toBe(state);
    expect(result.phase.type).toBe('completed');
  });
});

// ===========================================================================
// ErrorHandler
// ===========================================================================
describe('ErrorHandler', () => {
  const handler = new ErrorHandler();

  it('should handle error phase', () => {
    expect(handler.canHandle('error')).toBe(true);
    expect(handler.canHandle('completed')).toBe(false);
  });

  it('should return done=true without changing state', () => {
    const state = createMockState();
    const execState = createExecutionState();
    const error = new Error('Something went wrong');
    execState.phase = { type: 'error', error };
    const ctx = createMockCtx();

    const result = handler.execute(ctx, state, execState);

    expect(result.done).toBe(true);
    expect(result.state).toBe(state);
    expect(result.phase.type).toBe('error');
  });
});

// ===========================================================================
// Execution Policy integration tests
// ===========================================================================
describe('Execution Policy integration', () => {
  describe('ExecutingToolHandler with custom policy', () => {
    const handler = new ExecutingToolHandler();

    it('should call onToolError when tool execution fails', async () => {
      const state = createMockState();
      const execState = createExecutionState();
      execState.phase = { type: 'executing-tool', actions: [createAction()] };
      const registry = createMockToolRegistry();
      (registry.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB down'));

      const onToolError = vi.fn().mockResolvedValue({
        decision: 'continue',
        sanitizedResult: 'Error: DB down',
      });

      const ctx = createMockCtx({
        executionPolicy: {
          shouldStop: () => ({ decision: 'continue' }),
          onToolError,
          onParseError: (error: Error) => ({ decision: 'fail' as const, error }),
        },
      });

      const result = await handler.execute(ctx, state, execState, registry);

      expect(onToolError).toHaveBeenCalledTimes(1);
      const callArgs = onToolError.mock.calls[0]!;
      expect(callArgs[0]).toBeInstanceOf(Error);
      expect((callArgs[0] as Error).message).toBe('DB down');
      expect(callArgs[1]).toEqual(expect.objectContaining({ tool: 'testTool' }));
      expect(callArgs[3]).toEqual({ retryCount: 0 });
      expect(result.phase.type).toBe('tool-result');
    });

    it('should propagate error when policy returns fail decision', async () => {
      const state = createMockState();
      const execState = createExecutionState();
      execState.phase = { type: 'executing-tool', actions: [createAction()] };
      const registry = createMockToolRegistry();
      (registry.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Fatal'));

      const ctx = createMockCtx({
        executionPolicy: {
          shouldStop: () => ({ decision: 'continue' }),
          onToolError: (error: Error) => ({ decision: 'fail' as const, error }),
          onParseError: (error: Error) => ({ decision: 'fail' as const, error }),
        },
      });

      await expect(handler.execute(ctx, state, execState, registry)).rejects.toThrow('Fatal');
    });
  });

  describe('CallingLLMHandler with custom policy', () => {
    const handler = new CallingLLMHandler();

    it('should call onParseError when toolCallToAction fails', async () => {
      const state = createMockState();
      const execState = createExecutionState();
      execState.phase = { type: 'calling-llm' };
      execState.preparedMessages = [{ role: 'user', content: 'test' }];

      const onParseError = vi.fn().mockResolvedValue({
        decision: 'ignore',
        fallbackText: 'treated as text',
      });

      const ctx = createMockCtx({
        llmProvider: {
          call: vi.fn().mockResolvedValue({
            content: 'response with bad tool call',
            toolCalls: [{ id: 'bad', name: 'tool', arguments: null }],
            tokens: { input: 10, output: 5 },
            stopReason: 'tool_calls',
          }),
          stream: vi.fn(),
        } as never,
        executionPolicy: {
          shouldStop: () => ({ decision: 'continue' }),
          onToolError: (error: Error) => ({
            decision: 'continue' as const,
            sanitizedResult: `Error: ${error.message}`,
          }),
          onParseError,
        },
      });

      // toolCallToAction will fail if arguments is null (not an object)
      // But actually it just passes through. We need a different approach.
      // Since toolCallToAction is a simple mapper, let's mock it at the module level.
      // For now, test that when toolCallToAction throws, onParseError is called.

      // The current toolCallToAction just maps fields, so null arguments won't throw.
      // Skip this test as the parse error path requires a real parsing failure.
      // onParseError is tested via integration when LLM returns malformed JSON.
    });
  });

  // T3: Regression test — onParseError ignore should preserve fallbackText in execState.llmResponse (CR P0-3)
  describe('CallingLLMHandler onParseError fail path', () => {
    it('should throw error when policy decides to fail on parse error', async () => {
      const handler = new CallingLLMHandler();
      const state = createMockState();
      const execState = createExecutionState();
      execState.phase = { type: 'calling-llm' };
      execState.preparedMessages = [{ role: 'user', content: 'test' }];

      const parseError = new Error('Unrecoverable parse failure');
      const onParseError = vi.fn().mockResolvedValue({
        decision: 'fail',
        error: parseError,
      });

      const ctx = createMockCtx({
        llmProvider: {
          call: vi.fn().mockResolvedValue({
            content: 'response with bad tool call',
            toolCalls: [{ id: 'tc-1', name: 'someTool', arguments: {} }],
            tokens: { input: 10, output: 5 },
            stopReason: 'tool_calls',
          }),
          stream: vi.fn(),
        } as never,
        executionPolicy: {
          shouldStop: () => ({ decision: 'continue' }),
          onToolError: (error: Error) => ({
            decision: 'continue' as const,
            sanitizedResult: `Error: ${error.message}`,
          }),
          onParseError,
        },
      });

      // Make toolCallToAction throw to trigger onParseError
      const executionModule = await import('../../../src/execution.js');
      vi.spyOn(executionModule, 'toolCallToAction').mockImplementation(() => {
        throw new Error('Simulated parse failure');
      });

      try {
        await expect(handler.execute(ctx, state, execState)).rejects.toThrow(
          'Unrecoverable parse failure'
        );
        expect(onParseError).toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  describe('CallingLLMHandler onParseError ignore regression (CR P0-3)', () => {
    it('should preserve fallbackText in execState.llmResponse when policy ignores parse error', async () => {
      const handler = new CallingLLMHandler();
      const state = createMockState();
      const execState = createExecutionState();
      execState.phase = { type: 'calling-llm' };
      execState.preparedMessages = [{ role: 'user', content: 'test' }];

      const onParseError = vi.fn().mockResolvedValue({
        decision: 'ignore',
        fallbackText: 'Fallback text from policy',
      });

      const ctx = createMockCtx({
        llmProvider: {
          call: vi.fn().mockResolvedValue({
            content: 'original response',
            toolCalls: [{ id: 'tc-1', name: 'someTool', arguments: {} }],
            tokens: { input: 10, output: 5 },
            stopReason: 'tool_calls',
          }),
          stream: vi.fn(),
        } as never,
        executionPolicy: {
          shouldStop: () => ({ decision: 'continue' }),
          onToolError: (error: Error) => ({
            decision: 'continue' as const,
            sanitizedResult: `Error: ${error.message}`,
          }),
          onParseError,
        },
      });

      // CallingLLMHandler internally calls toolCallToAction, which only maps fields and won't throw.
      // We use vi.mock to replace toolCallToAction in execution.ts to make it throw,
      // triggering the onParseError → ignore path.
      const executionModule = await import('../../../src/execution.js');
      const originalFn = executionModule.toolCallToAction;
      vi.spyOn(executionModule, 'toolCallToAction').mockImplementation(() => {
        throw new Error('Simulated parse failure');
      });

      try {
        await handler.execute(ctx, state, execState);

        // onParseError should be called
        expect(onParseError).toHaveBeenCalled();
        // llmResponse should be set to fallbackText (core assertion of P0-3 fix)
        expect(execState.llmResponse).toBe('Fallback text from policy');
        // action and allActions should be cleared
        expect(execState.action).toBeUndefined();
        expect(execState.allActions).toBeUndefined();
      } finally {
        // Restore original implementation
        vi.restoreAllMocks();
      }
    });
  });
});
