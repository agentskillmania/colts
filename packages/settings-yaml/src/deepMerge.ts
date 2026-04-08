/**
 * Deep merge utility function
 *
 * For merging configuration objects with nested object support
 */

/**
 * Deep merge objects, filling missing fields in target with values from defaultValue
 *
 * Merge rules:
 * - For nested objects, recursively merge
 * - For arrays, use target's value directly (don't merge array elements)
 * - For primitive types, use target's value directly
 *
 * @param target - Target object (user config)
 * @param defaultValue - Default values object
 * @returns Merged object
 *
 * @example
 * ```typescript
 * const result = deepMerge(
 *   { server: { port: 8080 } },
 *   { server: { port: 3000, host: 'localhost' }, debug: false }
 * );
 * // result = { server: { port: 8080, host: 'localhost' }, debug: false }
 * ```
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: Record<string, unknown>,
  defaultValue: T
): T {
  const result: Record<string, unknown> = { ...defaultValue };

  for (const key of Object.keys(target)) {
    const targetValue = target[key];
    const defaultValueFieldValue = defaultValue[key as keyof T];

    if (
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue) &&
      defaultValueFieldValue !== null &&
      typeof defaultValueFieldValue === 'object' &&
      !Array.isArray(defaultValueFieldValue)
    ) {
      // Both values are objects, recursively merge
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        defaultValueFieldValue as Record<string, unknown>
      );
    } else {
      // Use target's value directly (including arrays, primitives, etc.)
      result[key] = targetValue;
    }
  }

  return result as T;
}
