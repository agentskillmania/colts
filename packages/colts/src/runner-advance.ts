/**
 * @fileoverview Advance Phase Machine
 *
 * Handles phase-by-phase advancement of the ReAct execution cycle.
 * Extracted from AgentRunner for maintainability.
 */

import type { AgentState, ILLMProvider, IToolRegistry } from './types.js';
import type { ISkillProvider } from './skills/types.js';
import type { SubAgentConfig } from './subagent/types.js';
import type { AdvanceResult, ExecutionState, AdvanceOptions } from './execution.js';
import { toolCallToAction } from './execution.js';
import { buildMessages, getToolsForLLM } from './runner-message-builder.js';
import { isSkillSignal, type SkillSignal } from './skills/types.js';
import { addAssistantMessage, addToolMessage, incrementStepCount } from './state.js';

/**
 * Runner context passed to extracted functions instead of `this`
 */
export interface RunnerContext {
  llmProvider: ILLMProvider;
  toolRegistry: IToolRegistry;
  skillProvider?: ISkillProvider;
  /** Sub-agent configuration map (name → SubAgentConfig) */
  subAgentConfigs?: Map<string, SubAgentConfig>;
  options: {
    model: string;
    systemPrompt?: string;
    requestTimeout?: number;
    maxSteps?: number;
  };
}

/**
 * Execute one phase advancement
 */
export async function executeAdvance(
  ctx: RunnerContext,
  state: AgentState,
  execState: ExecutionState,
  toolRegistry?: IToolRegistry,
  options?: AdvanceOptions
): Promise<AdvanceResult> {
  const registry = toolRegistry ?? ctx.toolRegistry;
  const currentPhase = execState.phase;

  try {
    switch (currentPhase.type) {
      case 'idle':
        return advanceToPreparing(ctx, state, execState);

      case 'preparing':
        return advanceToCallingLLM(state, execState);

      case 'calling-llm':
        return await advanceToLLMResponse(ctx, state, execState, registry, options?.signal);

      case 'llm-response':
        return advanceToParsing(state, execState);

      case 'parsing':
        return advanceToParsed(state, execState);

      case 'parsed':
        return advanceFromParsed(state, execState);

      case 'executing-tool':
        return await advanceToToolResult(state, execState, registry, options?.signal);

      case 'tool-result':
        return advanceToCompleted(state, execState);

      case 'completed':
      case 'error':
        return { state, phase: currentPhase, done: true };

      default:
        execState.phase = { type: 'error', error: new Error(`Unknown phase: ${currentPhase}`) };
        return { state, phase: execState.phase, done: true };
    }
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    execState.phase = { type: 'error', error: errorObj };
    return { state, phase: execState.phase, done: true };
  }
}

function advanceToPreparing(
  ctx: RunnerContext,
  state: AgentState,
  execState: ExecutionState
): AdvanceResult {
  const messages = buildMessages(state, {
    systemPrompt: ctx.options.systemPrompt,
    model: ctx.options.model,
    skillProvider: ctx.skillProvider,
    subAgentConfigs: ctx.subAgentConfigs,
  });
  execState.preparedMessages = messages;
  const displayMessages: import('./types.js').Message[] = messages.map((m) => ({
    role: m.role as import('./types.js').MessageRole,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    timestamp: Date.now(),
  }));
  execState.phase = { type: 'preparing', messages: displayMessages };
  return { state, phase: execState.phase, done: false };
}

function advanceToCallingLLM(state: AgentState, execState: ExecutionState): AdvanceResult {
  execState.phase = { type: 'calling-llm' };
  return { state, phase: execState.phase, done: false };
}

async function advanceToLLMResponse(
  ctx: RunnerContext,
  state: AgentState,
  execState: ExecutionState,
  registry?: IToolRegistry,
  signal?: AbortSignal
): Promise<AdvanceResult> {
  const tools = getToolsForLLM(registry);

  const response = await ctx.llmProvider.call({
    model: ctx.options.model,
    messages:
      execState.preparedMessages ??
      buildMessages(state, {
        systemPrompt: ctx.options.systemPrompt,
        model: ctx.options.model,
        skillProvider: ctx.skillProvider,
      }),
    tools,
    priority: 0,
    requestTimeout: ctx.options.requestTimeout,
    signal,
  });

  const responseText = response.content;
  execState.llmResponse = responseText;

  if (response.toolCalls && response.toolCalls.length > 0) {
    const toolCall = response.toolCalls[0];
    execState.action = toolCallToAction(toolCall);
    execState.allActions = response.toolCalls.map(toolCallToAction);
  }

  execState.phase = { type: 'llm-response', response: responseText };
  return { state, phase: execState.phase, done: false };
}

function advanceToParsing(state: AgentState, execState: ExecutionState): AdvanceResult {
  execState.phase = { type: 'parsing' };
  return { state, phase: execState.phase, done: false };
}

function advanceToParsed(state: AgentState, execState: ExecutionState): AdvanceResult {
  // Action already extracted from raw response in advanceToLLMResponse, no need to re-parse
  const thought = execState.llmResponse ?? '';
  execState.thought = thought;

  if (execState.action) {
    execState.phase = { type: 'parsed', thought, action: execState.action };
  } else {
    execState.phase = { type: 'parsed', thought };
  }

  return { state, phase: execState.phase, done: false };
}

function advanceFromParsed(state: AgentState, execState: ExecutionState): AdvanceResult {
  if (execState.action) {
    const thought = execState.thought ?? '';
    const newState = addAssistantMessage(state, thought, {
      type: 'thought',
      visible: false,
    });
    execState.phase = { type: 'executing-tool', action: execState.action };
    return { state: newState, phase: execState.phase, done: false };
  } else {
    return advanceToCompleted(state, execState);
  }
}

async function advanceToToolResult(
  state: AgentState,
  execState: ExecutionState,
  registry?: IToolRegistry,
  signal?: AbortSignal
): Promise<AdvanceResult> {
  const action = execState.action;
  if (!action) {
    throw new Error('No action to execute');
  }
  if (!registry) {
    throw new Error('Tool registry is required for tool execution');
  }

  let result: unknown;
  try {
    result = await registry.execute(action.tool, action.arguments, { signal });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result = `Error: ${errorMessage}`;
  }

  execState.toolResult = result;
  execState.phase = { type: 'tool-result', result };

  // Format skill signals as LLM-friendly text instead of raw JSON
  let toolResultContent: string;
  if (isSkillSignal(result)) {
    const sig = result as SkillSignal;
    switch (sig.type) {
      case 'SWITCH_SKILL':
        toolResultContent = `Skill '${sig.to}' loaded. You are now in sub-skill mode. Follow its instructions, then call return_skill when done.`;
        break;
      case 'RETURN_SKILL':
        toolResultContent =
          typeof sig.result === 'string' ? sig.result : JSON.stringify(sig.result);
        break;
      case 'SKILL_NOT_FOUND':
        toolResultContent = `Skill '${sig.requested}' not found. Available: ${sig.available.join(', ')}`;
        break;
      default:
        toolResultContent = JSON.stringify(result);
    }
  } else {
    toolResultContent = typeof result === 'string' ? result : JSON.stringify(result);
  }
  const newState = incrementStepCount(addToolMessage(state, toolResultContent));

  return { state: newState, phase: execState.phase, done: false };
}

function advanceToCompleted(state: AgentState, execState: ExecutionState): AdvanceResult {
  const answer = execState.thought ?? '';
  execState.phase = { type: 'completed', answer };

  if (execState.toolResult === undefined) {
    const newState = incrementStepCount(
      addAssistantMessage(state, answer, { type: 'final', visible: true })
    );
    return { state: newState, phase: execState.phase, done: true };
  }

  // tool-result → completed: messages already written (thought + tool message), don't duplicate
  return { state, phase: execState.phase, done: true };
}

/**
 * Get RunnerContext-compatible message builder (for use by stream/run modules)
 * @internal
 */
export function buildMessagesFromCtx(
  ctx: RunnerContext,
  state: AgentState
): import('@mariozechner/pi-ai').Message[] {
  return buildMessages(state, {
    systemPrompt: ctx.options.systemPrompt,
    model: ctx.options.model,
    skillProvider: ctx.skillProvider,
    subAgentConfigs: ctx.subAgentConfigs,
  });
}
