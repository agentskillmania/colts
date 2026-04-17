/**
 * @fileoverview Message Assembler type definitions
 *
 * Defines the interface for assembling messages sent to the LLM.
 * The default implementation handles system prompts, skill guides,
 * compression summaries, and conversation history.
 */

import type { Message as PiAIMessage } from '@mariozechner/pi-ai';
import type { AgentState } from '../types.js';
import type { ISkillProvider } from '../skills/types.js';
import type { SubAgentConfig } from '../subagent/types.js';

/**
 * Options passed to IMessageAssembler.build()
 *
 * Contains all configuration needed to assemble messages, extracted
 * from the RunnerContext so the assembler stays decoupled from the
 * runner internals.
 */
export interface BuildMessagesOptions {
  /** System prompt to prepend */
  systemPrompt?: string;
  /** Model identifier for assistant messages */
  model: string;
  /** Skill provider for injecting skill list into system prompt */
  skillProvider?: ISkillProvider;
  /** Sub-agent config map for injecting sub-agent list into system prompt */
  subAgentConfigs?: Map<string, SubAgentConfig>;
  /** Enable prompt-level thinking guidance */
  enablePromptThinking?: boolean;
}

/**
 * Interface for assembling LLM messages from agent state
 *
 * Implementations convert internal AgentState (messages, skill state,
 * compression) into the pi-ai Message format expected by the LLM.
 *
 * The default implementation ({@link DefaultMessageAssembler}) handles
 * system prompts, skill guides, compression summaries, and conversation
 * history. Inject a custom implementation to add RAG, memory, or
 * modified system prompt strategies without forking AgentRunner.
 */
export interface IMessageAssembler {
  /**
   * Build the message array for an LLM call
   *
   * @param state - Current agent state
   * @param opts - Message building options
   * @returns Array of messages formatted for pi-ai LLM calls
   */
  build(state: AgentState, opts: BuildMessagesOptions): PiAIMessage[];
}
