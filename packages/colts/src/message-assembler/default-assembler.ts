/**
 * @fileoverview Default Message Assembler
 *
 * Migrated from runner-message-builder.ts. Converts internal AgentState
 * messages to pi-ai Message format. Handles system prompts, skill guides,
 * compression summaries, and conversation history.
 */

import type { Message as PiAIMessage, TextContent } from '@mariozechner/pi-ai';
import type { AgentState, SkillState } from '../types.js';
import type { BuildMessagesOptions, IMessageAssembler } from './types.js';

/**
 * Build skill mode guide based on current skill state
 *
 * Unified guide for all skill levels. Every active skill must call
 * return_skill when done, and may call load_skill to delegate.
 */
function buildSkillGuide(skillState: SkillState | undefined): string | null {
  if (!skillState || !skillState.current) return null;

  return `=== SKILL MODE ===
You are currently executing the '${skillState.current}' skill.

You may switch to another skill at any time using the \`load_skill\` tool.
When you COMPLETE your task, you MUST call the \`return_skill\` tool:
{
  "result": "Your final answer here (be detailed)",
  "status": "success"
}

Rules:
- ALWAYS use return_skill when done — do NOT just respond with text
- You may call load_skill to delegate sub-tasks to specialized skills
=============================`.trim();
}

/**
 * Default IMessageAssembler implementation
 *
 * Assembles messages from AgentState for LLM consumption.
 * Combines system prompt, agent instructions, skill state,
 * compression summary, and conversation history into pi-ai format.
 */
export class DefaultMessageAssembler implements IMessageAssembler {
  /**
   * Build the message array for an LLM call
   *
   * @param state - Current agent state
   * @param opts - Message building options
   * @returns Array of messages formatted for pi-ai LLM calls
   */
  build(state: AgentState, opts: BuildMessagesOptions): PiAIMessage[] {
    const messages: PiAIMessage[] = [];
    const now = Date.now();

    // Combine system prompts into a single user message prefix
    // pi-ai doesn't have a 'system' role, so we prepend to first user message
    const systemParts: string[] = [];

    if (opts.systemPrompt) {
      systemParts.push(opts.systemPrompt);
    }

    if (state.config.instructions) {
      systemParts.push(state.config.instructions);
    }

    // Inject current skill instructions (if in sub-skill mode)
    if (state.context.skillState?.loadedInstructions) {
      systemParts.push(state.context.skillState.loadedInstructions);
    }

    // Inject dynamic skill guide based on current mode
    const skillGuide = buildSkillGuide(state.context.skillState);
    if (skillGuide) {
      systemParts.push(skillGuide);
    }

    // Always inject global skill list when a skill provider is configured
    if (opts.skillProvider) {
      const skills = opts.skillProvider.listSkills();
      if (skills.length > 0) {
        const skillLines = skills.map((s) => `- ${s.name}: ${s.description}`);
        systemParts.push(
          `Available skills:\n${skillLines.join('\n')}\nUse the load_skill tool to load detailed instructions when needed.`
        );
      }
    }

    // Inject sub-agent list into system prompt
    if (opts.subAgentConfigs && opts.subAgentConfigs.size > 0) {
      const subAgentLines = Array.from(opts.subAgentConfigs.values()).map(
        (sa) => `- ${sa.name}: ${sa.description}`
      );
      systemParts.push(
        `Available sub-agents:\n${subAgentLines.join('\n')}\nUse the delegate tool to delegate tasks to specialized sub-agents.`
      );
    }

    // Add combined system prompt as first message if exists
    if (systemParts.length > 0) {
      messages.push({
        role: 'user',
        content: `[System Instructions]\n${systemParts.join('\n\n')}`,
        timestamp: now,
      });

      // Fake assistant acknowledgment to maintain conversation flow
      messages.push({
        role: 'assistant',
        content: [{ type: 'text', text: 'Understood. I will follow these instructions.' }],
        api: 'openai-completions',
        provider: 'openai',
        model: opts.model,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: now,
      });
    }

    // Add conversation history (respecting compression boundary)
    const compression = state.context.compression;
    const startIdx = compression ? compression.anchor : 0;

    // If compressed, inject summary as a system-like user message
    if (compression && compression.summary) {
      messages.push({
        role: 'user',
        content: `[Conversation History Summary]\n${compression.summary}`,
        timestamp: now,
      });
      messages.push({
        role: 'assistant',
        content: [
          { type: 'text', text: 'Understood. I have the context from our previous conversation.' },
        ],
        api: 'openai-completions',
        provider: 'openai',
        model: opts.model,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: now,
      });
    }

    for (let i = startIdx; i < state.context.messages.length; i++) {
      const msg = state.context.messages[i];
      switch (msg.role) {
        case 'user':
          messages.push({
            role: 'user',
            content: msg.content,
            timestamp: now,
          });
          break;

        case 'assistant': {
          const content: (TextContent | import('@mariozechner/pi-ai').ToolCall)[] = [
            { type: 'text', text: msg.content },
          ];
          if (msg.toolCalls && msg.toolCalls.length > 0) {
            for (const tc of msg.toolCalls) {
              content.push({
                type: 'toolCall',
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
              });
            }
          }
          messages.push({
            role: 'assistant',
            content,
            api: 'openai-completions',
            provider: 'openai',
            model: opts.model,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: msg.toolCalls && msg.toolCalls.length > 0 ? 'toolUse' : 'stop',
            timestamp: now,
          });
          break;
        }

        case 'tool':
          // Tool results use pi-ai's toolResult role
          messages.push({
            role: 'toolResult',
            toolCallId: msg.toolCallId ?? 'unknown',
            toolName: msg.toolName ?? 'unknown',
            content: [{ type: 'text', text: msg.content }],
            isError: false,
            timestamp: now,
          });
          break;
      }
    }

    return messages;
  }
}
