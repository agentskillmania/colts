/**
 * @fileoverview Step 12: Context Compression
 *
 * Built-in compressor that prevents conversation history from growing unbounded.
 * Never modifies messages — only affects what buildMessages() sends to the LLM.
 */

import type { AgentState, ILLMProvider, CompressionConfig, CompressResult } from './types.js';

/**
 * Context compression strategy
 */
type Strategy = 'truncate' | 'sliding-window' | 'summarize' | 'hybrid';

/**
 * Default context compressor implementation
 *
 * Supports four strategies:
 * - truncate: Drop old messages without summary
 * - sliding-window: Same as truncate (clearer semantics)
 * - summarize: Call LLM to generate summary of old messages
 * - hybrid: Summarize old messages + keep recent as-is
 *
 * @example
 * ```typescript
 * const compressor = new DefaultContextCompressor(
 *   { strategy: 'hybrid', threshold: 50, keepRecent: 10 },
 *   llmProvider,
 *   'gpt-4',
 * );
 * ```
 */
export class DefaultContextCompressor {
  private readonly threshold: number;
  private readonly strategy: Strategy;
  private readonly keepRecent: number;
  private readonly llmProvider?: ILLMProvider;
  private readonly model?: string;

  constructor(config?: CompressionConfig, llmProvider?: ILLMProvider, model?: string) {
    this.threshold = config?.threshold ?? 50;
    this.strategy = (config?.strategy ?? 'sliding-window') as Strategy;
    this.keepRecent = config?.keepRecent ?? 10;
    this.llmProvider = llmProvider;
    this.model = model;

    // summarize and hybrid require LLM provider
    if ((this.strategy === 'summarize' || this.strategy === 'hybrid') && !llmProvider) {
      throw new Error(
        `Strategy '${this.strategy}' requires an LLM provider. ` +
          `Pass llmProvider or use 'truncate'/'sliding-window' strategy.`
      );
    }
  }

  /**
   * Check if compression is needed based on message count threshold
   */
  shouldCompress(state: AgentState): boolean {
    // Already compressed and still below double threshold — skip
    if (state.context.compression) {
      const remaining = state.context.messages.length - state.context.compression.anchor;
      if (remaining < this.threshold) return false;
    }

    return state.context.messages.length >= this.threshold;
  }

  /**
   * Execute compression, returning metadata without modifying messages
   */
  async compress(state: AgentState): Promise<CompressResult> {
    const messages = state.context.messages;

    // If already compressed, operate on the uncompressed portion
    const existingAnchor = state.context.compression?.anchor ?? 0;
    const anchor = Math.max(existingAnchor, messages.length - this.keepRecent);

    // Nothing to compress
    if (anchor <= existingAnchor) {
      return {
        summary: state.context.compression?.summary ?? '',
        anchor: existingAnchor,
      };
    }

    switch (this.strategy) {
      case 'truncate':
      case 'sliding-window':
        return { summary: '', anchor };

      case 'summarize':
      case 'hybrid': {
        const messagesToCompress = messages.slice(existingAnchor, anchor);
        const summary = await this.generateSummary(
          messagesToCompress,
          state.context.compression?.summary
        );
        return { summary, anchor };
      }

      default:
        return { summary: '', anchor };
    }
  }

  /**
   * Generate summary using LLM
   *
   * @param messages - Messages to summarize
   * @param existingSummary - Previous summary to incorporate
   * @returns Summary text
   * @private
   */
  private async generateSummary(
    messages: AgentState['context']['messages'],
    existingSummary?: string
  ): Promise<string> {
    if (!this.llmProvider || !this.model) {
      throw new Error('LLM provider and model required for summarize/hybrid strategy');
    }

    // Build conversation text from messages
    const conversationText = messages
      .map((m) => {
        const prefix = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'Tool';
        return `${prefix}: ${m.content}`;
      })
      .join('\n');

    const prompt = existingSummary
      ? `Previous conversation summary:\n${existingSummary}\n\nNew conversation to incorporate:\n${conversationText}\n\nPlease provide an updated concise summary that covers the entire conversation history. Focus on key facts, decisions, and results.`
      : `Summarize the following conversation concisely. Focus on key facts, decisions, and results:\n\n${conversationText}`;

    const response = await this.llmProvider.call({
      model: this.model,
      messages: [{ role: 'user' as const, content: prompt, timestamp: Date.now() }],
    });

    return response.content;
  }
}
