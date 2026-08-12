/**
 * @fileoverview Node default SkillFsOps implementation
 *
 * Backed by node:fs/promises, node:path, and node:os. Kept in its own module
 * so the rest of colts (including FilesystemSkillProvider) stays free of
 * node: imports — browsers can bundle colts without node:fs stubs and inject
 * an OPFS-backed SkillFsOps instead.
 *
 * Node callers register this via `setDefaultSkillFsOps(nodeFsOps)` at
 * startup (e.g. `import { nodeFsOps } from '@agentskillmania/colts/skills/node-fs-ops'`).
 */

import { readFile, readdir, stat, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { SkillFsOps } from './fs-ops.js';

/**
 * Node default SkillFsOps implementation (node:fs/promises)
 */
export const nodeFsOps: SkillFsOps = {
  async readFile(path) {
    return readFile(path, 'utf-8');
  },
  async readdir(path) {
    return readdir(path);
  },
  async exists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
  async stat(path) {
    const s = await stat(path);
    return { mtimeMs: s.mtimeMs, isDirectory: () => s.isDirectory() };
  },
  join: (...parts) => join(...parts),
  homeDir: () => homedir(),
};
