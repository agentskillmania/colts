/**
 * @fileoverview Filesystem Skill Provider
 *
 * Scans and loads skills from filesystem directories, with YAML frontmatter parsing support.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SkillManifest, ISkillProvider } from './types.js';

/**
 * SKILL.md filename constant
 */
const SKILL_FILE = 'SKILL.md';

/**
 * Parse YAML frontmatter from SKILL.md content
 *
 * Supported formats:
 * - Simple key-value pairs: `name: value`
 * - Multiline strings: `description: |` or `description: >`
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

  // Parse YAML key-value pairs
  const lines = frontmatterText.split('\n');
  let currentKey = '';
  let currentValue = '';
  let inMultiline = false;
  // Note: multiline indicator (| or >) is not stored, currently processed uniformly as folded multiline

  for (const line of lines) {
    if (inMultiline) {
      // Collect multiline value: ends when indentation decreases or empty line
      if (line === '' || (!line.startsWith(' ') && !line.startsWith('\t'))) {
        // End multiline value
        result.frontmatter[currentKey] = currentValue.trim();
        inMultiline = false;
        // Continue processing current line (may be a new key-value pair)
        const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
        if (kvMatch) {
          currentKey = kvMatch[1];
          const value = kvMatch[2].trim();
          if (value === '|' || value === '>') {
            inMultiline = true;
            // No need to distinguish | and >, process uniformly
            currentValue = '';
          } else {
            result.frontmatter[currentKey] = value;
          }
        }
      } else {
        // Collect multiline content (strip one level of indentation)
        const trimmedLine = line.replace(/^ (\s?.*)/, '$1');
        currentValue += (currentValue ? '\n' : '') + trimmedLine;
      }
    } else {
      const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
      if (kvMatch) {
        currentKey = kvMatch[1];
        const value = kvMatch[2].trim();
        if (value === '|' || value === '>') {
          inMultiline = true;
          // No need to distinguish | and >, process uniformly
          currentValue = '';
        } else {
          result.frontmatter[currentKey] = value;
        }
      }
    }
  }

  // Handle the last multiline value
  if (inMultiline && currentKey) {
    result.frontmatter[currentKey] = currentValue.trim();
  }

  return result;
}

/**
 * Scan a directory for sub-directories containing SKILL.md
 *
 * @param directory - Root directory to scan
 * @returns Array of discovered skill manifests
 */
function scanDirectory(directory: string): SkillManifest[] {
  const manifests: SkillManifest[] = [];
  const resolvedDir = resolve(directory);

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
    const content = readFileSync(skillFilePath, 'utf-8');
    const { body } = parseFrontmatter(content);

    return body;
  }

  /**
   * Load a skill's resource file content
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
    return readFileSync(resourcePath, 'utf-8');
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
