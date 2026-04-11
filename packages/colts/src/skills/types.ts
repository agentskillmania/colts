/**
 * @fileoverview Skill type definitions
 *
 * Defines core interfaces and metadata structures for the Skill system.
 */

/**
 * Skill manifest (Level 1, always loaded)
 *
 * Describes basic information about a skill without loading full content.
 */
export interface SkillManifest {
  /** Skill name (unique identifier) */
  name: string;
  /** Skill description */
  description: string;
  /** Skill source directory path */
  source: string;
  /** Relative paths to resource files */
  resources?: string[];
  /** Relative paths to script files */
  scripts?: string[];
}

/**
 * Skill provider interface
 *
 * Defines the abstract interface for skill discovery, loading, and resource access.
 * Supports different storage backends (filesystem, remote services, etc.).
 */
export interface ISkillProvider {
  /**
   * Get manifest for a specific skill
   *
   * @param name - Skill name
   * @returns Skill manifest, or undefined if not found
   */
  getManifest(name: string): SkillManifest | undefined;

  /**
   * Load a skill's instruction content (SKILL.md body section)
   *
   * @param name - Skill name
   * @returns SKILL.md body content
   * @throws Error when skill is not found
   */
  loadInstructions(name: string): Promise<string>;

  /**
   * Load a skill's resource file content
   *
   * @param name - Skill name
   * @param relativePath - Resource file path relative to the skill directory
   * @returns Resource file content
   * @throws Error when skill is not found or resource cannot be read
   */
  loadResource(name: string, relativePath: string): Promise<string>;

  /**
   * List all discovered skill manifests
   *
   * @returns Array of all skill manifests
   */
  listSkills(): SkillManifest[];

  /**
   * Rescan directories and refresh skill cache
   */
  refresh(): void;
}
