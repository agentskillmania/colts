/**
 * @fileoverview Settings YAML main module.
 *
 * Provides the {@link Settings} class for reading and managing YAML configuration files
 * with support for default values, deep merging, and runtime overrides.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { deepMerge } from './deepMerge.js';

/**
 * Initialization options for the {@link Settings} class.
 */
export interface InitializeOptions<T extends Record<string, unknown>> {
  /**
   * Optional object for overriding configuration values (e.g., command line arguments).
   * This takes the highest priority during merging.
   */
  override?: Partial<T>;

  /**
   * Optional default configuration provided as a YAML string.
   * This takes the lowest priority during merging.
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
   * Create a Settings instance.
   *
   * @param configPath - Absolute path, relative path, or ~-prefixed home directory path to the config file.
   */
  constructor(configPath: string) {
    this.configPath = configPath.startsWith('~')
      ? path.join(os.homedir(), configPath.slice(1))
      : configPath;
  }

  /**
   * Initialize configuration.
   *
   * - If the config file doesn't exist and a defaultYaml is provided, the file is created with defaults.
   * - If the config file doesn't exist and no defaultYaml is provided, an error is thrown.
   * - If the config file exists, it is read and deep-merged with the defaults.
   * - If parent directories don't exist, they are created recursively.
   * - Supports an override parameter for temporary configuration overrides (highest priority).
   *
   * Merge priority: override > config file > defaultYaml
   *
   * @param options - Initialization options.
   * @returns A promise that resolves when initialization is complete.
   * @throws {Error} When the config file is not found and no defaultYaml is provided.
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
      await fs.mkdir(dir, { recursive: true });

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
   * Get configuration values.
   *
   * @returns {T} The frozen configuration object.
   * @throws {Error} If the settings have not been initialized.
   */
  getValues(): T {
    if (this.values === null) {
      throw new Error('Settings not initialized. Call initialize() first.');
    }
    return this.values;
  }

  /**
   * Check if a nested key exists by dot-separated path.
   *
   * @param keyPath - Dot-separated key path (e.g. "llm.provider").
   * @returns {boolean} `true` if the key exists in the configuration, otherwise `false`.
   * @throws {Error} If the settings have not been initialized.
   *
   * @example
   * ```typescript
   * settings.has('llm.apiKey'); // true or false
   * ```
   */
  has(keyPath: string): boolean {
    if (this.values === null) {
      throw new Error('Settings not initialized. Call initialize() first.');
    }
    const keys = keyPath.split('.');
    let current: unknown = this.values;
    for (const key of keys) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return false;
      }
      if (!(key in (current as Record<string, unknown>))) {
        return false;
      }
      current = (current as Record<string, unknown>)[key];
    }
    return true;
  }

  /**
   * Update a nested configuration value by dot-separated path.
   *
   * Modifies the in-memory config. Call {@link save} to persist to disk.
   * The config object remains frozen between operations.
   *
   * @param keyPath - Dot-separated key path (e.g. "llm.provider").
   * @param value - New value to set.
   * @returns {void}
   * @throws {Error} If the settings have not been initialized.
   *
   * @example
   * ```typescript
   * settings.set('llm.apiKey', 'sk-new-key');
   * await settings.save();
   * ```
   */
  set(keyPath: string, value: unknown): void {
    if (this.values === null) {
      throw new Error('Settings not initialized. Call initialize() first.');
    }

    // Deep copy via deepMerge, modify, then freeze
    const obj = deepMerge(this.values as Record<string, unknown>, {} as T);
    const keys = keyPath.split('.');
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (current[key] === null || current[key] === undefined || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }

    current[keys[keys.length - 1]] = value;
    this.values = Object.freeze(obj) as T;
  }

  /**
   * Return a mutable deep copy of the current configuration.
   *
   * Uses deep copy to ensure the returned object is fully isolated from internal state.
   *
   * @returns {Record<string, unknown>} A mutable copy of the configuration object.
   * @throws {Error} If the settings have not been initialized.
   */
  toObject(): Record<string, unknown> {
    if (this.values === null) {
      throw new Error('Settings not initialized. Call initialize() first.');
    }
    return deepMerge(this.values as Record<string, unknown>, {} as T);
  }

  /**
   * Persist current configuration to the YAML file on disk.
   *
   * Creates parent directories if they don't exist.
   * The in-memory values remain frozen after save.
   *
   * @returns {Promise<void>} A promise that resolves when the file has been written.
   * @throws {Error} If the settings have not been initialized.
   *
   * @example
   * ```typescript
   * settings.set('llm.model', 'gpt-4o');
   * await settings.save();
   * ```
   */
  async save(): Promise<void> {
    if (this.values === null) {
      throw new Error('Settings not initialized. Call initialize() first.');
    }

    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true });

    const content = yaml.dump(this.values as Record<string, unknown>);
    await fs.writeFile(this.configPath, content, 'utf-8');
  }
}
