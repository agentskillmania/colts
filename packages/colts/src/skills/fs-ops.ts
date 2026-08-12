/**
 * @fileoverview Skill filesystem operation interface
 *
 * Abstracts filesystem access for the skill system so it can run on
 * different storage backends: Node uses node:fs, browsers can use OPFS.
 */

/**
 * Skill filesystem operation interface (Node uses node:fs, browsers use OPFS)
 */
export interface SkillFsOps {
  /**
   * Read a file's UTF-8 text content
   *
   * @param path - Absolute path to the file
   * @returns File content
   * @throws Error when the file cannot be read
   */
  readFile(path: string): Promise<string>;

  /**
   * List entry names in a directory
   *
   * @param path - Absolute path to the directory
   * @returns Array of entry names (files and directories)
   * @throws Error when the directory cannot be read
   */
  readdir(path: string): Promise<string[]>;

  /**
   * Check whether a path exists
   *
   * @param path - Path to check
   * @returns True if the path exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Get stat info for a path
   *
   * @param path - Path to stat
   * @returns Stat info with modification time and directory flag
   * @throws Error when the path does not exist or cannot be stat'ed
   */
  stat(path: string): Promise<{ mtimeMs: number; isDirectory(): boolean }>;

  /**
   * Join path segments with the backend's path separator
   *
   * @param parts - Path segments
   * @returns Joined path
   */
  join(...parts: string[]): string;

  /**
   * Home directory used for `~` expansion in directory paths
   *
   * @returns Home directory path (empty string when unknown)
   */
  homeDir(): string;
}

/**
 * Global default SkillFsOps registration point.
 *
 * Node callers register `nodeFsOps` (node:fs based, see ./node-fs-ops.js);
 * browsers register an OPFS-backed implementation. Keeps node: imports out
 * of the browser bundle — colts itself never imports node:fs.
 */
let defaultFsOps: SkillFsOps | undefined;

/**
 * Register the global default SkillFsOps implementation.
 *
 * Idempotent — repeated calls overwrite the previous default. Call before
 * constructing any FilesystemSkillProvider that does not receive an explicit
 * fsOps. Node entrypoints should call this with `nodeFsOps` at startup.
 *
 * @param fsOps - Filesystem operations backend to use as the default
 */
export function setDefaultSkillFsOps(fsOps: SkillFsOps): void {
  defaultFsOps = fsOps;
}

/**
 * Get the globally registered default SkillFsOps.
 *
 * @returns The registered default SkillFsOps
 * @throws Error when no implementation has been registered yet
 */
export function getDefaultSkillFsOps(): SkillFsOps {
  if (!defaultFsOps) {
    throw new Error(
      'Default SkillFsOps not registered — call setDefaultSkillFsOps() (Node: nodeFsOps, browser: OPFS adapter)'
    );
  }
  return defaultFsOps;
}
