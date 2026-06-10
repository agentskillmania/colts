/**
 * @fileoverview Default Message Assembler
 *
 * Migrated from runner-message-builder.ts. Converts internal AgentState
 * messages to pi-ai Message format. Handles system prompts, skill guides,
 * compression summaries, and conversation history.
 *
 * KV-cache design:
 * - Static prefix: system prompt + instructions + skill catalog + sub-agents + thinking guidance
 * - Dynamic content (active skill): injected as <system-reminder>
 *   into the last user message, keeping the static prefix stable for caching
 * - Same-turn thoughts (after last user message) included; cross-turn skipped
 */

import type { Message as PiAIMessage, TextContent, ToolCall } from '@mariozechner/pi-ai';

import type { AgentState } from '../types.js';
import type { BuildMessagesOptions, IMessageAssembler } from './types.js';

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

    // ── Static prefix ──
    // Only content that never changes within a session.
    // Dynamic content (skill state) is injected later as <system-reminder>.
    const systemParts: string[] = [];

    if (opts.systemPrompt) {
      systemParts.push(opts.systemPrompt);
    }

    if (state.config.instructions) {
      systemParts.push(state.config.instructions);
    }

    // Skill catalog — static, skills don't change during a session
    if (opts.skillProvider) {
      const skills = opts.skillProvider.listSkills();
      if (skills.length > 0) {
        const skillLines = skills.map((s) => `- ${s.name}: ${s.description}`);
        systemParts.push(
          `Available skills:\n${skillLines.join('\n')}\nUse the load_skill tool to load detailed instructions when needed.`
        );
      }
    }

    // Prompt-level thinking guidance
    if (opts.enablePromptThinking) {
      systemParts.push(
        'Before answering or using tools, please think step by step inside <think...</think (closing)> tags. ' +
          'After the closing </think (closing)> tag, provide your final response or tool calls.'
      );
    }

    // Sub-agent list — static
    if (opts.subAgentConfigs && opts.subAgentConfigs.size > 0) {
      const subAgentLines = Array.from(opts.subAgentConfigs.values()).map(
        (sa) => `- ${sa.name}: ${sa.description}`
      );
      systemParts.push(
        `Available sub-agents:\n${subAgentLines.join('\n')}\nUse the delegate tool to delegate tasks to specialized sub-agents.`
      );
    }

    if (systemParts.length > 0) {
      messages.push({
        role: 'user',
        content: `[System Instructions]\n${systemParts.join('\n\n')}`,
        timestamp: now,
      });

      messages.push(this.createFakeAck(opts.model, now));
    }

    // ── Compression summary ──
    const compression = state.context.compression;
    const startIdx = compression ? compression.anchor : 0;

    if (compression && compression.summary) {
      messages.push({
        role: 'user',
        content: `[Conversation History Summary]\n${compression.summary}`,
        timestamp: now,
      });
      messages.push(this.createFakeAck(opts.model, now));
    }

    // ── Turn boundary scan ──
    // Find the last user message index for same-turn thought handling.
    // Thoughts after this index are same-turn (include); at or before are cross-turn (skip).
    let lastUserMsgIdx = -1;
    for (let i = startIdx; i < state.context.messages.length; i++) {
      if (state.context.messages[i].role === 'user') {
        lastUserMsgIdx = i;
      }
    }

    // ── Conversation history ──
    for (let i = startIdx; i < state.context.messages.length; i++) {
      const msg = state.context.messages[i];

      // Skip cross-turn thought messages — old reasoning is irrelevant and wastes tokens.
      // Same-turn thoughts (after last user message) fall through to the assistant handler
      // so the LLM retains its own reasoning context during tool chains.
      if (msg.role === 'assistant' && msg.type === 'thought') {
        if (i <= lastUserMsgIdx) {
          continue; // Cross-turn: skip
        }
        // Same-turn: fall through to normal assistant message conversion
      }

      switch (msg.role) {
        case 'user':
          messages.push({
            role: 'user',
            content: msg.content,
            timestamp: msg.timestamp,
          });
          break;

        case 'assistant': {
          const content: (TextContent | ToolCall)[] = [
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
            timestamp: msg.timestamp,
          });
          break;
        }

        case 'tool':
          messages.push({
            role: 'toolResult',
            toolCallId: msg.toolCallId ?? 'unknown',
            toolName: msg.toolName ?? 'unknown',
            content: [{ type: 'text', text: msg.content }],
            isError: false,
            timestamp: msg.timestamp,
          });
          break;
      }
    }

    // ── Dynamic context injection ──
    // Inject active skill as <system-reminder> into the last user message.
    // This keeps the static prefix stable for KV-cache.
    const reminder = this.buildDynamicReminder(state);
    if (reminder && messages.length > 0) {
      const lastIdx = messages.length - 1;
      const last = messages[lastIdx];
      if (last.role === 'user') {
        // Append to existing user message
        if (typeof last.content === 'string') {
          messages[lastIdx] = {
            ...last,
            content:
              last.content + '\n\n---\n<system-reminder>\n' + reminder + '\n</system-reminder>',
          };
        } else {
          // Array content — append a new text part
          messages[lastIdx] = {
            ...last,
            content: [
              ...last.content,
              {
                type: 'text' as const,
                text: '\n\n---\n<system-reminder>\n' + reminder + '\n</system-reminder>',
              },
            ],
          };
        }
      } else {
        // Last message is not user — add a new user message
        messages.push({
          role: 'user',
          content: '<system-reminder>\n' + reminder + '\n</system-reminder>',
          timestamp: now,
        });
      }
    }

    return messages;
  }

  /**
   * Create a fake assistant acknowledgment
   *
   * Used to maintain the user/assistant conversation flow pattern
   * required by pi-ai (no system role).
   */
  private createFakeAck(model: string, timestamp: number): PiAIMessage {
    return {
      role: 'assistant',
      content: [{ type: 'text', text: 'Understood. I will follow these instructions.' }],
      api: 'openai-completions',
      provider: 'openai',
      model,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp,
    };
  }

  /**
   * Build <system-reminder> content from dynamic state
   *
   * Reads active skill from state.context.skillState.
   * Todolist is a wrangler concern and handled by MarkdownMessageAssembler.
   *
   * @returns Formatted reminder text, or null if no dynamic content exists
   */
  private buildDynamicReminder(state: AgentState): string | null {
    const parts: string[] = [];

    // Active skill — from colts core
    const skillState = state.context.skillState;
    if (skillState?.current) {
      parts.push('## Active Skill: ' + skillState.current);
      if (skillState.loadedInstructions) {
        parts.push(skillState.loadedInstructions);
      }
      parts.push(
        `You are currently executing the '${skillState.current}' skill.\n\n` +
          'You may switch to another skill at any time using the `load_skill` tool.\n' +
          'When you COMPLETE your task, you MUST call the `return_skill` tool.'
      );
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }
}
