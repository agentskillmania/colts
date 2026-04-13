/**
 * @fileoverview Filesystem Skill Provider
 *
 * Scans and loads skills from filesystem directories, with YAML frontmatter parsing support.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { SkillManifest, ISkillProvider } from './types.js';

/**
 * SKILL.md filename constant
 */
const SKILL_FILE = 'SKILL.md';

/**
 * Cache entry for file content
 */
interface CacheEntry {
  /** Cached content */
  content: string;
  /** File modification time (ms) */
  mtime: number;
}

/**
 * Parse YAML frontmatter from SKILL.md content
 *
 * Uses the 'yaml' library for robust parsing, supporting:
 * - Simple key-value pairs: `name: value`
 * - Multiline strings: `description: |` or `description: >`
 * - Arrays: `tags: [a, b, c]`
 * - Nested objects (values are converted to strings)
 *
 * @param content - Full SKILL.md file content
 * @returns Parsed result with frontmatter fields and body content
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const result: { frontmatter: Record<string, string>; body: string } = {
    frontmatter: {},
    body: '',
  };

  // Match frontmatter block starting with ---
  const frontmatterRegex = /^---\s*\n/;
  if (!frontmatterRegex.test(content)) {
    // No frontmatter, entire content is the body
    result.body = content;
    return result;
  }

  // Remove first ---, find second ---
  const afterFirstDelimiter = content.replace(frontmatterRegex, '');
  const secondDelimiterIndex = afterFirstDelimiter.indexOf('\n---');

  if (secondDelimiterIndex === -1) {
    // No closing ---, entire content is the body
    result.body = content;
    return result;
  }

  const frontmatterText = afterFirstDelimiter.substring(0, secondDelimiterIndex);
  const bodyStart = afterFirstDelimiter.indexOf('\n', secondDelimiterIndex + 4);
  result.body = bodyStart === -1 ? '' : afterFirstDelimiter.substring(bodyStart + 1);

  // Parse YAML using the yaml library
  try {
    const parsed = parseYaml(frontmatterText) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (value === null || value === undefined) {
        result.frontmatter[key] = '';
      } else if (typeof value === 'string') {
        result.frontmatter[key] = value;
      } else if (Array.isArray(value)) {
        // Convert arrays to comma-separated strings
        result.frontmatter[key] = value.join(', ');
      } else if (typeof value === 'object') {
        // Convert objects to JSON strings
        result.frontmatter[key] = JSON.stringify(value);
      } else {
        // Convert other types to strings
        result.frontmatter[key] = String(value);
      }
    }
  } catch {
    // YAML parsing failed, fall back to empty frontmatter
    // This maintains backward compatibility with malformed files
  }

  return result;
}

/**
 * Scan a directory for sub-directories containing SKILL.md
 *
 * @param directory - Root directory to scan
 * @returns Array of discovered skill manifests
 */
function expandHome(filePath: string): string {
  if (filePath.startsWith('~/') || filePath === '~') {
    return filePath.replace('~', process.env.HOME ?? '');
  }
  return filePath;
}

function scanDirectory(directory: string): SkillManifest[] {
  const manifests: SkillManifest[] = [];
  const resolvedDir = resolve(expandHome(directory));

  if (!existsSync(resolvedDir)) {
    return manifests;
  }

  let entries;
  try {
    entries = readdirSync(resolvedDir);
  } catch {
    // Cannot read directory, skip silently
    return manifests;
  }

  for (const entry of entries) {
    const entryPath = join(resolvedDir, entry);

    // Only process directories
    let stat;
    try {
      stat = statSync(entryPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) {
      continue;
    }

    // Check if SKILL.md exists
    const skillFilePath = join(entryPath, SKILL_FILE);
    if (!existsSync(skillFilePath)) {
      continue;
    }

    // Read and parse SKILL.md
    let content: string;
    try {
      content = readFileSync(skillFilePath, 'utf-8');
    } catch {
      // Cannot read file, skip
      console.warn(`[colts] Cannot read ${skillFilePath}, skipping`);
      continue;
    }

    const { frontmatter } = parseFrontmatter(content);

    // Validate required fields
    const name = frontmatter['name'];
    const description = frontmatter['description'];

    if (!name || !description) {
      console.warn(`[colts] ${skillFilePath} missing required name or description field, skipping`);
      continue;
    }

    // Collect resource file list
    const resources = collectFiles(entryPath, (fileName) => {
      return fileName !== SKILL_FILE;
    });

    // Collect script file list
    const scripts = collectFiles(entryPath, (fileName) => {
      return fileName.endsWith('.js') || fileName.endsWith('.ts') || fileName.endsWith('.mjs');
    });

    manifests.push({
      name,
      description,
      source: entryPath,
      resources: resources.length > 0 ? resources : undefined,
      scripts: scripts.length > 0 ? scripts : undefined,
    });
  }

  return manifests;
}

/**
 * Collect relative file paths in a directory
 *
 * Only collects top-level files, does not recurse into sub-directories.
 *
 * @param dirPath - Absolute directory path
 * @param filter - Filename filter function
 * @returns Array of matching relative file paths
 */
function collectFiles(dirPath: string, filter: (fileName: string) => boolean): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      const entryPath = join(dirPath, entry);
      try {
        const stat = statSync(entryPath);
        if (stat.isFile() && filter(entry)) {
          files.push(entry);
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Cannot read directory
  }
  return files;
}

/**
 * Filesystem Skill Provider
 *
 * Scans specified directories for sub-directories containing SKILL.md,
 * parses YAML frontmatter for metadata, and loads instructions and resources on demand.
 *
 * @example
 * ```typescript
 * const provider = new FilesystemSkillProvider(['/path/to/skills']);
 *
 * // List all discovered skills
 * const skills = provider.listSkills();
 *
 * // Load a skill's instructions
 * const instructions = await provider.loadInstructions('my-skill');
 * ```
 */
export class FilesystemSkillProvider implements ISkillProvider {
  /** Discovered skill manifest cache (name -> manifest) */
  private manifests = new Map<string, SkillManifest>();

  /** Directory list to scan */
  private directories: string[];

  /** Instructions cache: name -> cache entry */
  private instructionCache = new Map<string, CacheEntry>();

  /** Resource cache: "name:relativePath" -> cache entry */
  private resourceCache = new Map<string, CacheEntry>();

  /**
   * Create a filesystem skill provider
   *
   * @param directories - List of directory paths to scan
   */
  constructor(directories: string[]) {
    this.directories = directories;
    this.discover();
  }

  /**
   * Get manifest for a specific skill
   *
   * @param name - Skill name
   * @returns Skill manifest, or undefined if not found
   */
  getManifest(name: string): SkillManifest | undefined {
    return this.manifests.get(name);
  }

  /**
   * Load a skill's instruction content (SKILL.md body section, excluding frontmatter)
   *
   * Uses cache to avoid repeated disk reads. Cache is invalidated when the file
   * modification time changes.
   *
   * @param name - Skill name
   * @returns SKILL.md body content
   * @throws Error when skill is not found
   */
  async loadInstructions(name: string): Promise<string> {
    const manifest = this.manifests.get(name);
    if (!manifest) {
      throw new Error(`Skill not found: ${name}`);
    }

    const skillFilePath = join(manifest.source, SKILL_FILE);

    // Check cache
    const cached = this.instructionCache.get(name);
    try {
      const stats = statSync(skillFilePath);
      if (cached && cached.mtime === stats.mtime.getTime()) {
        return cached.content;
      }

      // Cache miss or stale, read file
      const content = readFileSync(skillFilePath, 'utf-8');
      const { body } = parseFrontmatter(content);

      // Update cache
      this.instructionCache.set(name, {
        content: body,
        mtime: stats.mtime.getTime(),
      });

      return body;
    } catch {
      // If stat fails but we have cached content, return it as fallback
      if (cached) {
        return cached.content;
      }
      throw new Error(`Failed to load instructions for skill: ${name}`);
    }
  }

  /**
   * Load a skill's resource file content
   *
   * Uses cache to avoid repeated disk reads. Cache is invalidated when the file
   * modification time changes.
   *
   * @param name - Skill name
   * @param relativePath - Resource file path relative to the skill directory
   * @returns Resource file content
   * @throws Error when skill is not found or resource cannot be read
   */
  async loadResource(name: string, relativePath: string): Promise<string> {
    const manifest = this.manifests.get(name);
    if (!manifest) {
      throw new Error(`Skill not found: ${name}`);
    }

    const resourcePath = join(manifest.source, relativePath);
    const cacheKey = `${name}:${relativePath}`;

    // Check cache
    const cached = this.resourceCache.get(cacheKey);
    try {
      const stats = statSync(resourcePath);
      if (cached && cached.mtime === stats.mtime.getTime()) {
        return cached.content;
      }

      // Cache miss or stale, read file
      const content = readFileSync(resourcePath, 'utf-8');

      // Update cache
      this.resourceCache.set(cacheKey, {
        content,
        mtime: stats.mtime.getTime(),
      });

      return content;
    } catch {
      // If stat fails but we have cached content, return it as fallback
      if (cached) {
        return cached.content;
      }
      throw new Error(`Failed to load resource for skill: ${name}`);
    }
  }

  /**
   * List all discovered skill manifests
   *
   * @returns Array of all skill manifests
   */
  listSkills(): SkillManifest[] {
    return Array.from(this.manifests.values());
  }

  /**
   * Rescan directories and refresh skill cache
   *
   * Clears existing cache and rediscovers all skills in all directories.
   */
  refresh(): void {
    this.manifests.clear();
    this.instructionCache.clear();
    this.resourceCache.clear();
    this.discover();
  }

  /**
   * Perform directory scan to discover all skills
   */
  private discover(): void {
    for (const dir of this.directories) {
      const found = scanDirectory(dir);
      for (const manifest of found) {
        this.manifests.set(manifest.name, manifest);
      }
    }
  }
}
