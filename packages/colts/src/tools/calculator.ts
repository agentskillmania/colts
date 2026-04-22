/**
 * @fileoverview Built-in calculator tool
 *
 * Safe mathematical expression evaluation.
 */

import { z } from 'zod';
import type { Tool } from './registry.js';

/**
 * Calculator tool parameters
 */
const calculatorParameters = z.object({
  expression: z
    .string()
    .describe('Mathematical expression to evaluate, e.g., "15 + 23", "sqrt(16)", "2 ** 8"'),
});

/**
 * Safe evaluation of mathematical expressions
 *
 * Supports: +, -, *, /, **, %, parentheses, Math functions
 * Blocks: assignment, variable access, function calls
 *
 * @param expression - Math expression string
 * @returns Result as string
 */
function safeEval(expression: string): string {
  // Whitelist of allowed characters
  const allowedPattern = /^[\d+\-*/().\s%^]+$/;
  if (!allowedPattern.test(expression)) {
    throw new Error(
      `Invalid characters in expression. Only numbers and operators (+, -, *, /, %, ^, ., parentheses) are allowed.`
    );
  }

  // Replace ^ with ** for power operator
  const normalizedExpression = expression.replace(/\^/g, '**');

  try {
    // Use Function constructor for safer evaluation than eval()
    // This creates a function with no access to outer scope
    const fn = new Function(`return (${normalizedExpression})`);
    const result = fn();

    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('Expression resulted in invalid number');
    }

    return result.toString();
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to evaluate expression: ${error.message}`);
    }
    throw new Error('Failed to evaluate expression');
  }
}

/**
 * Calculator tool - evaluates mathematical expressions
 *
 * @example
 * ```typescript
 * const result = await calculatorTool.execute({ expression: '15 + 23' });
 * // result: '38'
 * ```
 */
export const calculatorTool: Tool<typeof calculatorParameters> = {
  name: 'calculate',
  description:
    'Calculate the result of a mathematical expression. Supports: +, -, *, /, ** (power), % (modulo), parentheses.',
  parameters: calculatorParameters,
  execute: async ({ expression }, _options) => {
    const result = safeEval(expression);
    return result;
  },
};
