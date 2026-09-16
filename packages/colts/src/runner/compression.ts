/**
 * @fileoverview Context Compression Helpers
 *
 * Standalone functions for compressing agent context.
 * Extracted from AgentRunner for maintainability.
 */

import { produce } from 'immer';

import { addSystemMessage } from '../state/index.js';
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
 * The TS counterpart of Rust `apply_compression` (bundled with the `compress`
 * call): applies pruned message content, writes compression metadata, then
 * appends one system marker row so the compression lands in the timeline.
 * Context compression is user-perceivable (the timeline abruptly "gets
 * lighter") while `context.compression` is a single overwriting slot — only a
 * marker row can carry the history of multiple compressions. The row content
 * is compact JSON (`kind` + coverage/token counts of THIS round); frontend
 * shims localize it for display. Messages are never deleted; the assembler
 * skips system rows so the marker never enters the LLM context.
 * (R2P-105, aligned with Rust 0a3ec81.)
 *
 * @param compressor - Context compressor implementation
 * @param state - Current agent state
 * @returns New state with compression metadata and marker row applied
 */
export async function compressState(
  compressor: IContextCompressor,
  state: AgentState
): Promise<AgentState> {
  const result = await compressor.compress(state);
  // 旧锚点先读后写：多次压缩时标记行记录的是"本次新覆盖"的消息数。
  // （anchor 增量，saturating——放弃/no-op 轮照插标记但增量为 0，与
  // maybeCompress 的 coveredMessages 发射同点同语义。）
  const prevAnchor = state.context.compression?.anchor ?? 0;
  const applied = produce(state, (draft) => {
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
  const marker = JSON.stringify({
    kind: 'compact',
    // 本次压缩新覆盖的消息条数（anchor 增量），与消息总数区分开。
    coveredMessages: Math.max(0, result.anchor - prevAnchor),
    removedTokens: result.removedTokenCount ?? 0,
    summaryTokens: result.summaryTokenCount ?? 0,
  });
  return addSystemMessage(applied, marker);
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
