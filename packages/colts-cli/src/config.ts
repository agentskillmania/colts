/**
 * @fileoverview Configuration management — uses settings-yaml Settings class for config read/write
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Settings } from '@agentskillmania/settings-yaml';
import type { AppConfig } from './app.js';

/** Default path for global configuration directory */
const CONFIG_DIR = path.join(os.homedir(), '.agentskillmania', 'colts');
const CONFIG_FILE = 'config.yaml';

/**
 * colts-cli configuration structure
 */
export interface ColtsConfig extends Record<string, unknown> {
  llm?: {
    provider?: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
  agent?: {
    name?: string;
    instructions?: string;
  };
  skills?: string[];
  subAgents?: Array<{
    name: string;
    description: string;
    instructions: string;
    tools?: string[];
    maxSteps?: number;
  }>;
  persistence?: {
    enabled?: boolean;
  };
}

/**
 * Default configuration YAML
 */
const DEFAULT_CONFIG_YAML = `llm:
  provider: openai
  model: gpt-4

agent:
  name: colts-agent
  instructions: "You are a helpful assistant."

persistence:
  enabled: true
`;

/**
 * Options for loading configuration
 */
export interface LoadConfigOptions {
  /** Override global config directory (for testing) */
  globalDir?: string;
}

/**
 * Find configuration file path
 *
 * Search order: ./colts.yaml > {globalDir}/config.yaml
 */
async function findConfigPath(globalDir?: string): Promise<string | null> {
  // 1. Local project config
  const localPath = path.resolve('colts.yaml');
  try {
    await fs.access(localPath);
    return localPath;
  } catch {
    // Local config not found, continue searching
  }

  // 2. Global config
  const dir = globalDir ?? CONFIG_DIR;
  const globalPath = path.join(dir, CONFIG_FILE);
  try {
    await fs.access(globalPath);
    return globalPath;
  } catch {
    // Global config not found either
  }

  return null;
}

/**
 * Get global config file path
 */
function getGlobalConfigPath(globalDir?: string): string {
  return path.join(globalDir ?? CONFIG_DIR, CONFIG_FILE);
}

/**
 * Check if config has required LLM settings
 */
function isValidConfig(config: ColtsConfig): boolean {
  return !!(config.llm?.apiKey && config.llm?.provider);
}

/**
 * Load configuration
 *
 * Search order: ./colts.yaml > {globalDir}/config.yaml
 * If neither exists, creates default config at global location via Settings.initialize().
 *
 * @param options - Load options (inject globalDir for testing)
 */
export async function loadConfig(options?: LoadConfigOptions): Promise<AppConfig> {
  // Try local config first, fall back to global
  let configPath = await findConfigPath(options?.globalDir);
  if (!configPath) {
    configPath = getGlobalConfigPath(options?.globalDir);
  }

  try {
    const settings = new Settings<ColtsConfig>(configPath);
    // initialize() creates the file with defaults if it doesn't exist
    await settings.initialize({ defaultYaml: DEFAULT_CONFIG_YAML });
    const config = settings.getValues();

    if (!isValidConfig(config)) {
      return { hasValidConfig: false, configPath };
    }

    return {
      hasValidConfig: true,
      configPath,
      llm: {
        provider: config.llm!.provider!,
        apiKey: config.llm!.apiKey!,
        model: config.llm!.model ?? 'gpt-4',
        baseUrl: config.llm!.baseUrl,
      },
    };
  } catch {
    return { hasValidConfig: false, configPath };
  }
}

/**
 * Save a configuration value
 *
 * Uses the Settings class to read, update, and persist config.
 * Creates the config file with defaults if it doesn't exist yet.
 *
 * @param keyPath - Dot-separated config key path (e.g. "llm.provider")
 * @param value - Config value to set
 * @param options - Save options (inject globalDir for testing)
 */
export async function saveConfig(
  keyPath: string,
  value: string,
  options?: { globalDir?: string }
): Promise<void> {
  const configPath = getGlobalConfigPath(options?.globalDir);
  const settings = new Settings<ColtsConfig>(configPath);

  // Initialize with defaults, creating the file if it doesn't exist
  await settings.initialize({ defaultYaml: DEFAULT_CONFIG_YAML });

  // Update the value and persist
  settings.set(keyPath, value);
  await settings.save();
}

/**
 * Set a nested value in an object by dot-separated path
 *
 * @param obj - Target object to mutate
 * @param keyPath - Dot-separated key path (e.g. "llm.provider")
 * @param value - Value to set
 */
export function setNestedValue(obj: Record<string, unknown>, keyPath: string, value: string): void {
  const keys = keyPath.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
}
