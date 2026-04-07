/**
 * 深度合并工具函数
 *
 * 用于合并配置对象，支持嵌套对象的递归合并
 */

/**
 * 深度合并对象，用 defaultValue 填充 target 中缺失的字段
 *
 * 合并规则：
 * - 对于嵌套对象，递归合并
 * - 对于数组，直接使用 target 的值（不合并数组元素）
 * - 对于基本类型，直接使用 target 的值
 *
 * @param target - 目标对象（用户配置）
 * @param defaultValue - 默认值对象
 * @returns 合并后的对象
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
      // 两个值都是对象，递归合并
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        defaultValueFieldValue as Record<string, unknown>
      );
    } else {
      // 直接使用 target 的值（包括数组、基本类型等）
      result[key] = targetValue;
    }
  }

  return result as T;
}
