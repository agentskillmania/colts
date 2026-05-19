/**
 * @fileoverview Context Compression
 *
 * Built-in compressor that prevents conversation history from growing unbounded.
 * Never modifies messages — only affects what buildMessages() sends to the LLM.
 *
 * Pipeline: prune → summarize → truncate
 * - Prune: stub out large tool outputs (zero-cost)
 * - Summarize: generate structured summary of old messages (LLM call)
 * - Truncate: set anchor to keep only recent messages
 */

import type {
  AgentState,
  ILLMProvider,
  CompressionConfig,
  CompressResult,
  Message,
} from '../types.js';
import { estimateTokens } from '../utils/tokens.js';

/**
 * Structured summary format for LLM prompt
 */
const summaryFormat = `## Key Findings
[important facts, root causes, and discoveries]

## Decisions & Rationale
[what was decided, why, and what alternatives were rejected]

## User Preferences
[constraints and preferences revealed during conversation]`;

/**
 * Default context compressor implementation
 *
 * Supports two strategies:
 * - truncate: Drop old messages without summary
 * - summarize: Call LLM to generate structured summary of old messages
 *
 * Compression triggering:
 * - If contextWindowSize is set: trigger when estimated tokens (from anchor onwards) >= 80% of contextWindow
 * - If not set: fall back to message count threshold (backward compatible)
 *
 * Pipeline:
 * 1. Prune: stub out tool outputs exceeding pruneThreshold (default 150 tokens)
 * 2. Summarize: generate structured summary (if strategy='summarize')
 * 3. Truncate: set anchor to keep only recent messages
 *
 * @example
 * ```typescript
 * const compressor = new DefaultContextCompressor(
 *   { strategy: 'summarize', threshold: 50, keepRecent: 10, contextWindowSize: 128000, pruneThreshold: 150 },
 *   llmProvider,
 *   'gpt-4',
 * );
 * ```
 */
export class DefaultContextCompressor {
  private readonly threshold: number;
  private readonly strategy: 'truncate' | 'summarize';
  private readonly keepRecent: number;
  private readonly llmProvider?: ILLMProvider;
  private readonly model?: string;
  private readonly summaryProvider?: ILLMProvider;
  private readonly summaryModel?: string;
  private readonly contextWindowSize?: number;
  private readonly pruneThreshold: number;

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
    this.strategy = (config?.strategy ?? 'truncate') as 'truncate' | 'summarize';
    this.keepRecent = config?.keepRecent ?? 10;
    this.llmProvider = llmProvider;
    this.model = model;
    this.summaryProvider = config?.summaryProvider;
    this.summaryModel = config?.summaryModel;
    this.contextWindowSize = config?.contextWindowSize;
    this.pruneThreshold = config?.pruneThreshold ?? 150;

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
   * Check if compression is needed
   *
   * Triggering logic:
   * - If contextWindowSize is set: estimate tokens from anchor onwards (including existing summary)
   *   and trigger when >= 80% of contextWindow
   * - If not set: fall back to message count threshold (backward compatible)
   *
   * @param state - Current agent state
   * @returns true if compression should be triggered
   */
  shouldCompress(state: AgentState): boolean {
    const messages = state.context.messages;
    const existingAnchor = state.context.compression?.anchor ?? 0;

    // Token-based triggering (when contextWindowSize is configured)
    if (this.contextWindowSize) {
      const effectiveTokens = this.estimateEffectiveTokens(state, existingAnchor);
      const triggerThreshold = Math.floor(this.contextWindowSize * 0.8);
      return effectiveTokens >= triggerThreshold;
    }

    // Message count fallback (backward compatible)
    // Already compressed and still below threshold — skip
    if (state.context.compression) {
      const remaining = messages.length - state.context.compression.anchor;
      if (remaining < this.threshold) return false;
    }

    return messages.length >= this.threshold;
  }

  /**
   * Execute compression with prune → summarize → truncate pipeline
   *
   * @param state - Current agent state
   * @returns Compression result with summary, anchor, and pruned message info
   */
  async compress(state: AgentState): Promise<CompressResult> {
    const messages = state.context.messages;
    const existingAnchor = state.context.compression?.anchor ?? 0;

    // Step 1: Prune large tool outputs
    const prunedMessages = this.pruneToolOutputs(messages, existingAnchor);

    // Step 2: Summarize (if strategy is 'summarize')
    let summary = '';
    let summaryTokenCount: number | undefined;
    if (this.strategy === 'summarize') {
      // Apply prunes to create message copy for summarization
      const messagesForSummary = this.applyPrunes(messages, prunedMessages, existingAnchor);

      // Generate structured summary
      summary = await this.generateSummary(
        messagesForSummary.slice(existingAnchor),
        state.context.compression?.summary
      );
      summaryTokenCount = estimateTokens(summary);
    }

    // Step 3: Truncate (set anchor)
    const anchor = Math.max(existingAnchor, messages.length - this.keepRecent);

    // Nothing to compress
    if (anchor <= existingAnchor) {
      return {
        summary: state.context.compression?.summary ?? '',
        anchor: existingAnchor,
        prunedMessages,
      };
    }

    // Calculate removed token count
    const messagesToCompress = messages.slice(existingAnchor, anchor);
    const removedTokenCount = messagesToCompress.reduce(
      (sum, m) => sum + (m.tokenCount ?? estimateTokens(m.content)),
      0
    );

    return {
      summary,
      anchor,
      summaryTokenCount,
      removedTokenCount,
      compressedAt: Date.now(),
      prunedMessages,
    };
  }

  /**
   * Identify tool outputs to stub (prune)
   *
   * Scans messages from anchor onwards for tool role messages exceeding pruneThreshold.
   * Skips already-pruned stubs (messages containing ", pruned]").
   *
   * @param messages - All messages
   * @param anchor - Starting index (only scan from here onwards)
   * @returns Array of { index, newContent, newTokenCount } for each pruned message
   * @private
   */
  private pruneToolOutputs(
    messages: Message[],
    anchor: number
  ): Array<{ index: number; newContent: string; newTokenCount: number }> {
    const prunedMessages: Array<{ index: number; newContent: string; newTokenCount: number }> = [];

    for (let i = anchor; i < messages.length; i++) {
      const msg = messages[i];

      // Only process tool role messages
      if (msg.role !== 'tool') continue;

      // Skip already-pruned stubs
      if (msg.content.includes(', pruned]')) continue;

      // Check if content exceeds threshold
      const tokenCount = msg.tokenCount ?? estimateTokens(msg.content);
      if (tokenCount > this.pruneThreshold) {
        const newContent = `[Tool result for ${msg.toolName ?? 'unknown'}: ${tokenCount} tokens, pruned]`;
        const newTokenCount = estimateTokens(newContent);
        prunedMessages.push({ index: i, newContent, newTokenCount });
      }
    }

    return prunedMessages;
  }

  /**
   * Apply prune stubs to messages (creates copy for summarization)
   *
   * @param messages - Original messages
   * @param prunedMessages - Prune operations from pruneToolOutputs()
   * @param anchor - Starting index
   * @returns New message array with prune stubs applied
   * @private
   */
  private applyPrunes(
    messages: Message[],
    prunedMessages: Array<{ index: number; newContent: string; newTokenCount: number }>,
    anchor: number
  ): Message[] {
    // Create a shallow copy of messages from anchor onwards
    const result = messages.slice(anchor);

    // Apply each prune operation
    for (const prune of prunedMessages) {
      const relativeIndex = prune.index - anchor;
      if (relativeIndex >= 0 && relativeIndex < result.length) {
        result[relativeIndex] = {
          ...result[relativeIndex],
          content: prune.newContent,
          tokenCount: prune.newTokenCount,
        };
      }
    }

    return result;
  }

  /**
   * Generate structured summary using LLM
   *
   * @param messages - Messages to summarize (with prunes applied)
   * @param existingSummary - Previous summary to incorporate (if re-compressing)
   * @returns Structured summary text
   * @private
   */
  private async generateSummary(messages: Message[], existingSummary?: string): Promise<string> {
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

    // Build prompt with structured format
    const prompt = existingSummary
      ? `Previous context:\n${existingSummary}\n\nNew messages to incorporate:\n${conversationText}\n\nProvide an updated summary. Preserve ALL key points from the previous context. Add new information. Use this format:\n\n${summaryFormat}`
      : `Summarize the conversation. Focus on facts, decisions, and user preferences — NOT task tracking (that's handled elsewhere). Use this format:\n\n${summaryFormat}\n\nConversation:\n${conversationText}`;

    const response = await provider.call({
      model: model,
      messages: [{ role: 'user' as const, content: prompt, timestamp: Date.now() }],
    });

    return response.content;
  }

  /**
   * Estimate effective token count from anchor onwards
   *
   * Counts tokens from anchor to end, plus existing summary tokens.
   *
   * @param state - Current agent state
   * @param anchor - Starting index
   * @returns Estimated token count
   * @private
   */
  private estimateEffectiveTokens(state: AgentState, anchor: number): number {
    let total = 0;

    // Add existing summary tokens
    if (state.context.compression?.summaryTokenCount) {
      total += state.context.compression.summaryTokenCount;
    }

    // Add tokens from anchor onwards
    for (let i = anchor; i < state.context.messages.length; i++) {
      const msg = state.context.messages[i];
      total += msg.tokenCount ?? estimateTokens(msg.content);
    }

    return total;
  }
}
