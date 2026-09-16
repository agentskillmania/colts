/**
 * @fileoverview Context Compression Helpers
 *
 * Standalone functions for compressing agent context.
 * Extracted from AgentRunner for maintainability.
 */

import { produce } from 'immer';

import type { AgentState, IContextCompressor } from '../types.js';

/**
 * 压缩事件的发射回调——复用 StepRunner 既有事件通道（StepEventEmitter 形状），
 * 不发明新通道。步内（StepRunner）与步间（run()）两路压缩点都经
 * maybeCompress 发射（对齐 Rust maybe_compress：step.rs 与 runner.rs 的
 * 压缩点都调它）。R2P-104 返修 P1。
 */
export type CompressionEventEmitter = (type: string, data: Record<string, unknown>) => void;

/**
 * Manually compress state using the given compressor
 *
 * @param compressor - Context compressor implementation
 * @param state - Current agent state
 * @returns New state with compression metadata applied
 */
export async function compressState(
  compressor: IContextCompressor,
  state: AgentState
): Promise<AgentState> {
  const result = await compressor.compress(state);
  return produce(state, (draft) => {
    // Apply pruned message content and updated token counts
    if (result.prunedMessages) {
      for (const { index, newContent, newTokenCount } of result.prunedMessages) {
        draft.context.messages[index].content = newContent;
        draft.context.messages[index].tokenCount = newTokenCount;
      }
    }
    // Update compression metadata
    draft.context.compression = {
      summary: result.summary,
      anchor: result.anchor,
      summaryTokenCount: result.summaryTokenCount,
      removedTokenCount: result.removedTokenCount,
      compressedAt: result.compressedAt,
    };
  });
}

/**
 * Check if compression is needed and apply it
 *
 * 发射随压缩下沉到本 helper：compressing/compressed 在每次真实压缩时发射，
 * 不再依赖调用方轮询（旧实现只在 run() 步间发射，真实压缩器一轮成功后
 * shouldCompress 回落 → 步内压缩全部静默、不可观测）。对齐 Rust
 * maybe_compress 的「压缩即发射」语义。R2P-104 返修 P1。
 *
 * @param compressor - Optional context compressor implementation
 * @param state - Current agent state
 * @param emit - Optional event emitter (StepRunner 的 emit 回调 / run() 的 this.emit 适配)
 * @returns New state with compression metadata if compression was triggered, otherwise the original state
 */
export async function maybeCompress(
  compressor: IContextCompressor | undefined,
  state: AgentState,
  emit?: CompressionEventEmitter
): Promise<AgentState> {
  if (!compressor || !compressor.shouldCompress(state)) return state;
  emit?.('compressing', { timestamp: Date.now() });
  const prevAnchor = state.context.compression?.anchor ?? 0;
  const newState = await compressState(compressor, state);
  if (newState.context.compression) {
    const newAnchor = newState.context.compression.anchor;
    emit?.('compressed', {
      summary: newState.context.compression.summary,
      removedCount: newAnchor - prevAnchor,
      // 本轮新覆盖的消息条数（anchor 增量）——无歧义消息数，
      // 与 removedCount 的单位歧义脱钩；放弃/no-op 时增量为 0
      // （saturating，对齐 Rust saturating_sub）。R2P-104。
      coveredMessages: Math.max(0, newAnchor - prevAnchor),
      timestamp: Date.now(),
    });
  }
  return newState;
}
