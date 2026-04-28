/**
 * @fileoverview Token estimation and statistics utilities
 */

import { encodingForModel } from 'js-tiktoken';
import type { TokenStats } from '../types.js';

const enc = encodingForModel('gpt-4');

/** Estimate token count of a string via js-tiktoken */
export function estimateTokens(text: string): number {
  return enc.encode(text).length;
}

/** Add two TokenStats, handling undefined */
export function addTokenStats(a?: TokenStats, b?: TokenStats): TokenStats {
  return {
    input: (a?.input ?? 0) + (b?.input ?? 0),
    output: (a?.output ?? 0) + (b?.output ?? 0),
  };
}
