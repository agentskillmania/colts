/**
 * @fileoverview Deep merge utility module.
 *
 * Provides functions for recursively merging configuration objects with nested object and array support.
 */

/** Error thrown when deepMerge encounters invalid input. */
export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsError';
  }
}

/**
 * Recursively merge two arrays element by element.
 *
 * Rules:
 * - Same index, both plain objects → recursively deepMerge
 * - Same index, both arrays → recursively deepMergeArrays
 * - Target has element, default doesn't → deep copy target's element
 * - Default has element, target doesn't → deep copy default's element
 *
 * @param targetArr - The target array (higher priority).
 * @param defaultArr - The default array (lower priority).
 * @returns {unknown[]} A new array containing the deeply merged elements.
 */
function deepMergeArrays(
  targetArr: unknown[],
  defaultArr: unknown[],
  visited: WeakSet<object>
): unknown[] {
  const maxLen = Math.max(targetArr.length, defaultArr.length);
  const result: unknown[] = new Array(maxLen);

  for (let i = 0; i < maxLen; i++) {
    const t = targetArr[i];
    const d = defaultArr[i];

    // Both plain objects → merge
    if (
      t !== null &&
      t !== undefined &&
      typeof t === 'object' &&
      !Array.isArray(t) &&
      d !== null &&
      d !== undefined &&
      typeof d === 'object' &&
      !Array.isArray(d)
    ) {
      result[i] = deepMergeInternal(
        t as Record<string, unknown>,
        d as Record<string, unknown>,
        visited
      );
      continue;
    }

    // Both arrays → merge recursively
    if (Array.isArray(t) && Array.isArray(d)) {
      result[i] = deepMergeArrays(t, d, visited);
      continue;
    }

    // Target takes priority, fallback to default for missing slots.
    // Note: Unlike objects, undefined array elements fall back to defaults.
    // This is intentional: short arrays should have missing tail elements filled from defaults,
    // rather than producing undefined (objects use `key in target` to distinguish; arrays cannot).
    const value = t !== undefined ? t : d;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[i] = deepMergeInternal(value as Record<string, unknown>, {}, visited);
    } else if (Array.isArray(value)) {
      result[i] = deepMergeArrays(value, [], visited);
    } else {
      result[i] = value;
    }
  }

  return result;
}

/**
 * Deep merge objects: prefer target values, fill missing from defaultValue.
 *
 * All values are deep copied — the result shares no references with inputs.
 *
 * Rules:
 * - Both target and default have a plain object at the same key → recursively merge
 * - Both have arrays at the same key → merge element by element
 * - Target has a value and default doesn't → deep copy target's value
 * - Target doesn't have a key → deep copy default's value
 *
 * @param target - Target object (user config, higher priority).
 * @param defaultValue - Default values object.
 * @returns {T} Deep-copied merged object.
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
function deepMergeInternal<T extends Record<string, unknown>>(
  target: Record<string, unknown>,
  defaultValue: T,
  visited: WeakSet<object>
): T {
  if (visited.has(target)) {
    throw new SettingsError('Circular reference detected in target object');
  }
  visited.add(target);

  const result: Record<string, unknown> = {};

  // Deep copy default values for keys not present in target
  for (const key of Object.keys(defaultValue)) {
    if (!(key in target)) {
      const d = defaultValue[key as keyof T];
      if (d !== null && typeof d === 'object' && !Array.isArray(d)) {
        result[key] = deepMergeInternal(
          {} as Record<string, unknown>,
          d as Record<string, unknown>,
          visited
        );
      } else if (Array.isArray(d)) {
        result[key] = deepMergeArrays([], d, visited);
      } else {
        result[key] = d;
      }
    }
  }

  // Handle target keys: merge with default where applicable
  for (const key of Object.keys(target)) {
    const targetValue = target[key];
    const defaultValueFieldValue = defaultValue[key as keyof T];

    if (targetValue !== null && typeof targetValue === 'object' && !Array.isArray(targetValue)) {
      if (
        defaultValueFieldValue !== null &&
        typeof defaultValueFieldValue === 'object' &&
        !Array.isArray(defaultValueFieldValue)
      ) {
        // Both are plain objects → recursively merge
        result[key] = deepMergeInternal(
          targetValue as Record<string, unknown>,
          defaultValueFieldValue as Record<string, unknown>,
          visited
        );
      } else {
        // Only target has an object → deep copy it
        result[key] = deepMergeInternal(targetValue as Record<string, unknown>, {}, visited);
      }
    } else if (Array.isArray(targetValue)) {
      if (Array.isArray(defaultValueFieldValue)) {
        // Both are arrays → merge element by element
        result[key] = deepMergeArrays(targetValue, defaultValueFieldValue, visited);
      } else {
        // Only target has an array → deep copy it
        result[key] = deepMergeArrays(targetValue, [], visited);
      }
    } else {
      // Primitives, null → direct assignment (immutable)
      result[key] = targetValue;
    }
  }

  return result as T;
}

export function deepMerge<T extends Record<string, unknown>>(
  target: Record<string, unknown>,
  defaultValue: T
): T {
  return deepMergeInternal(target, defaultValue, new WeakSet<object>());
}
