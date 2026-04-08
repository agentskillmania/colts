/**
 * Settings YAML main module
 *
 * For reading and managing YAML configuration files
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { deepMerge } from './deepMerge.js';
import { mkdirp } from './mkdirp.js';

// Export utility functions for external use
export { deepMerge } from './deepMerge.js';
export { mkdirp } from './mkdirp.js';

/**
 * Initialization options
 */
export interface InitializeOptions<T extends Record<string, unknown>> {
  /**
   * Object for overriding config (e.g., command line args)
   * Highest priority
   */
  override?: Partial<T>;

  /**
   * Default configuration as YAML string
   * Lowest priority
   */
  defaultYaml?: string;
}

/**
 * Settings class
 *
 * For reading and managing YAML configuration files with default values and deep merging
 *
 * @example
 * ```typescript
 * const settings = new Settings('/path/to/config.yaml');
 * await settings.initialize({
 *   defaultYaml: `
 * server:
 *   port: 3000
 *   host: localhost
 * `
 * });
 * const config = settings.getValues();
 * console.log(config.server.port); // 3000
 * ```
 */
export class Settings<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Configuration file path */
  private readonly configPath: string;

  /** Configuration values (filled after initialization) */
  private values: T | null = null;

  /**
   * Create Settings instance
   *
   * @param configPath - Absolute path, relative path, or ~-prefixed home directory path to config file
   */
  constructor(configPath: string) {
    this.configPath = configPath.startsWith('~')
      ? path.join(os.homedir(), configPath.slice(1))
      : configPath;
  }

  /**
   * Initialize configuration
   *
   * - If config file doesn't exist and has defaultYaml, create file with defaults
   * - If config file doesn't exist and no defaultYaml, throw error
   * - If config file exists, read and deep merge with defaults
   * - If parent directories don't exist, create them recursively
   * - Supports override parameter for temporary config overrides (highest priority)
   *
   * Merge priority: override > config file > defaultYaml
   *
   * @param options - Initialization options
   */
  async initialize(options?: InitializeOptions<T>): Promise<void> {
    const { override, defaultYaml } = options || {};

    // Parse default values
    const defaultValue = defaultYaml ? (yaml.load(defaultYaml) as T) : ({} as T);

    // Check if config file exists
    let exists = false;
    try {
      await fs.access(this.configPath);
      exists = true;
    } catch {
      exists = false;
    }

    if (!exists) {
      // Config file doesn't exist and no default, throw error
      if (!defaultYaml) {
        throw new Error(
          `Config file not found: ${this.configPath}. Provide defaultYaml to create it.`
        );
      }

      // Create parent directories
      const dir = path.dirname(this.configPath);
      await mkdirp(dir);

      // Write default config
      await fs.writeFile(this.configPath, defaultYaml, 'utf-8');

      // Merge: defaults + override
      let result = defaultValue;
      if (override) {
        result = deepMerge(override as Record<string, unknown>, defaultValue);
      }
      this.values = Object.freeze(result) as T;
    } else {
      // Read existing config
      const content = await fs.readFile(this.configPath, 'utf-8');
      const userConfig = yaml.load(content) as Record<string, unknown>;

      // Deep merge: defaults + user config + override
      let result = deepMerge(userConfig || {}, defaultValue);
      if (override) {
        result = deepMerge(override as Record<string, unknown>, result);
      }
      this.values = Object.freeze(result) as T;
    }
  }

  /**
   * Get configuration values
   *
   * @returns Frozen configuration object
   * @throws Error if not initialized
   */
  getValues(): T {
    if (this.values === null) {
      throw new Error('Settings not initialized. Call initialize() first.');
    }
    return this.values;
  }
}
