/**
 * @fileoverview Context Compression
 *
 * Built-in compressor that prevents conversation history from growing unbounded.
 * Never modifies messages — only affects what buildMessages() sends to the LLM.
 */

import type { AgentState, ILLMProvider, CompressionConfig, CompressResult } from '../types.js';
import { estimateTokens } from '../utils/tokens.js';

/**
 * Context compression strategy
 */
type Strategy = 'truncate' | 'summarize';

/**
 * Default context compressor implementation
 *
 * Supports two strategies:
 * - truncate: Drop old messages without summary
 * - summarize: Call LLM to generate summary of old messages
 *
 * @example
 * ```typescript
 * const compressor = new DefaultContextCompressor(
 *   { strategy: 'summarize', threshold: 50, keepRecent: 10 },
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
  private readonly summaryProvider?: ILLMProvider;
  private readonly summaryModel?: string;

  /**
   * Create a default context compressor
   *
   * @param config - Compression configuration
   * @param llmProvider - LLM provider for normal operations (used as fallback for summarization)
   * @param model - Model identifier for LLM calls (used as fallback for summarization)
   * @throws Error if summarize strategy is used without an LLM provider
   */
  constructor(config?: CompressionConfig, llmProvider?: ILLMProvider, model?: string) {
    this.threshold = config?.threshold ?? 50;
    this.strategy = (config?.strategy ?? 'truncate') as Strategy;
    this.keepRecent = config?.keepRecent ?? 10;
    this.llmProvider = llmProvider;
    this.model = model;
    this.summaryProvider = config?.summaryProvider;
    this.summaryModel = config?.summaryModel;

    // summarize requires an LLM provider (either dedicated or fallback)
    const effectiveProvider = this.summaryProvider ?? llmProvider;
    if (this.strategy === 'summarize' && !effectiveProvider) {
      throw new Error(
        `Strategy '${this.strategy}' requires an LLM provider. ` +
          `Pass llmProvider, summaryProvider in config, or use 'truncate' strategy.`
      );
    }
  }

  /**
   * Check if compression is needed based on message count threshold
   *
   * @param state - Current agent state
   * @returns true if the message count exceeds the threshold
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
   *
   * @param state - Current agent state
   * @returns Compression result with summary and anchor index
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

    const messagesToCompress = messages.slice(existingAnchor, anchor);
    const removedTokenCount = messagesToCompress.reduce(
      (sum, m) => sum + (m.tokenCount ?? estimateTokens(m.content)),
      0
    );

    switch (this.strategy) {
      case 'truncate':
        return {
          summary: '',
          anchor,
          removedTokenCount,
          compressedAt: Date.now(),
        };

      case 'summarize': {
        const summary = await this.generateSummary(
          messagesToCompress,
          state.context.compression?.summary
        );
        return {
          summary,
          anchor,
          summaryTokenCount: estimateTokens(summary),
          removedTokenCount,
          compressedAt: Date.now(),
        };
      }

      default:
        return { summary: '', anchor, removedTokenCount, compressedAt: Date.now() };
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
    const provider = this.summaryProvider ?? this.llmProvider;
    const model = this.summaryModel ?? this.model;
    if (!provider || !model) {
      throw new Error('LLM provider and model required for summarize strategy');
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

    const response = await provider.call({
      model: model,
      messages: [{ role: 'user' as const, content: prompt, timestamp: Date.now() }],
    });

    return response.content;
  }
}
