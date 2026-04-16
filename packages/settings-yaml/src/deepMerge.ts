/**
 * @fileoverview Deep merge utility module.
 *
 * Provides functions for recursively merging configuration objects with nested object and array support.
 */

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
function deepMergeArrays(targetArr: unknown[], defaultArr: unknown[]): unknown[] {
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
      result[i] = deepMerge(t as Record<string, unknown>, d as Record<string, unknown>);
      continue;
    }

    // Both arrays → merge recursively
    if (Array.isArray(t) && Array.isArray(d)) {
      result[i] = deepMergeArrays(t, d);
      continue;
    }

    // Target takes priority, fallback to default for missing slots.
    // Note: 与对象不同，数组中 undefined 元素使用 default fallback。
    // 这是有意为之：短数组 missing 尾部元素应从 default 填充，
    // 而非产生 undefined（对象用 `key in target` 区分，数组无法区分）。
    const value = t !== undefined ? t : d;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[i] = deepMerge(value as Record<string, unknown>, {});
    } else if (Array.isArray(value)) {
      result[i] = deepMergeArrays(value, []);
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
export function deepMerge<T extends Record<string, unknown>>(
  target: Record<string, unknown>,
  defaultValue: T
): T {
  const result: Record<string, unknown> = {};

  // Deep copy default values for keys not present in target
  for (const key of Object.keys(defaultValue)) {
    if (!(key in target)) {
      const d = defaultValue[key as keyof T];
      if (d !== null && typeof d === 'object' && !Array.isArray(d)) {
        result[key] = deepMerge({} as Record<string, unknown>, d as Record<string, unknown>);
      } else if (Array.isArray(d)) {
        result[key] = deepMergeArrays([], d);
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
        result[key] = deepMerge(
          targetValue as Record<string, unknown>,
          defaultValueFieldValue as Record<string, unknown>
        );
      } else {
        // Only target has an object → deep copy it
        result[key] = deepMerge(targetValue as Record<string, unknown>, {});
      }
    } else if (Array.isArray(targetValue)) {
      if (Array.isArray(defaultValueFieldValue)) {
        // Both are arrays → merge element by element
        result[key] = deepMergeArrays(targetValue, defaultValueFieldValue);
      } else {
        // Only target has an array → deep copy it
        result[key] = deepMergeArrays(targetValue, []);
      }
    } else {
      // Primitives, null → direct assignment (immutable)
      result[key] = targetValue;
    }
  }

  return result as T;
}
