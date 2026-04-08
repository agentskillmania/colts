/**
 * Directory creation utility function
 *
 * For recursively creating directories
 */

import * as fs from 'node:fs/promises';

/**
 * Recursively create directory
 *
 * Similar to `mkdir -p`, won't error if directory already exists
 *
 * @param dirPath - Directory path
 *
 * @example
 * ```typescript
 * await mkdirp('/path/to/nested/directory');
 * ```
 */
export async function mkdirp(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}
