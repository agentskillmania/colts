/**
 * 目录创建工具函数
 *
 * 用于递归创建目录
 */

import * as fs from 'node:fs/promises';

/**
 * 递归创建目录
 *
 * 类似于 `mkdir -p`，如果目录已存在则不会报错
 *
 * @param dirPath - 目录路径
 *
 * @example
 * ```typescript
 * await mkdirp('/path/to/nested/directory');
 * ```
 */
export async function mkdirp(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}
