/**
 * @fileoverview Context Compression Helpers
 *
 * Standalone functions for compressing agent context.
 * Extracted from AgentRunner for maintainability.
 */

import { produce } from 'immer';
import type { AgentState, IContextCompressor } from './types.js';

/**
 * Manually compress state using the given compressor
 */
export async function compressState(
  compressor: IContextCompressor,
  state: AgentState
): Promise<AgentState> {
  const result = await compressor.compress(state);
  return produce(state, (draft) => {
    draft.context.compression = { summary: result.summary, anchor: result.anchor };
  });
}

/**
 * Check if compression is needed and apply it
 */
export async function maybeCompress(
  compressor: IContextCompressor | undefined,
  state: AgentState
): Promise<AgentState> {
  if (!compressor || !compressor.shouldCompress(state)) return state;
  return compressState(compressor, state);
}
