/**
 * @fileoverview Test helper: safe arithmetic expression evaluator
 *
 * Replaces raw `eval(expression)` calls in test tool handlers.
 * Uses `new Function()` with try/catch for safer evaluation.
 * Only supports numeric expressions (arithmetic operators, Math functions).
 */

/**
 * Safely evaluate a numeric expression string.
 *
 * @param expression - Arithmetic expression (e.g. "2+2", "Math.PI * 2")
 * @returns The numeric result
 * @throws SyntaxError if the expression is invalid
 * @throws Error if the result is not a finite number
 */
export function safeEval(expression: string): number {
  try {
    const fn = new Function(`"use strict"; return (${expression});`);
    const result = fn();
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      throw new Error(`safeEval: expression "${expression}" did not produce a finite number`);
    }
    return result;
  } catch (err) {
    if (err instanceof SyntaxError) throw err;
    throw new Error(`safeEval: failed to evaluate "${expression}": ${(err as Error).message}`);
  }
}
