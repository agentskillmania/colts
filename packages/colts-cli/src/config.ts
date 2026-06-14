/**
 * @fileoverview Configuration management — reads/writes CLI config using settings-yaml
 *
 * Config file search order: ./colts.yaml > ~/.agentskillmania/colts/config.yaml
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { SubAgentConfig, ModelEntry, LLMProviderEntry } from '@agentskillmania/colts';
import { Settings } from '@agentskillmania/settings-yaml';

/** Default configuration directory */
const CONFIG_DIR = path.join(os.homedir(), '.agentskillmania', 'colts');
const CONFIG_FILE = 'config.yaml';

/**
 * colts.yaml configuration structure
 */
export type ProviderConfig = LLMProviderEntry;

export type { ModelEntry };

export interface ColtsConfig extends Record<string, unknown> {
  /** LLM provider list */
  providers?: ProviderConfig[];
  /** Agent character settings */
  agent?: {
    /** Agent name */
    name?: string;
    /** System instructions */
    instructions?: string;
  };
  /** Maximum number of execution steps */
  maxSteps?: number;
  /** Request timeout in milliseconds */
  requestTimeout?: number;
  /** Skill directory paths */
  skillDirs?: string[];
  /** SubAgent definitions */
  subAgents?: SubAgentConfig[];
  /** List of tools requiring user confirmation */
  confirmTools?: string[];
}

/**
 * Application configuration (validated structure)
 */
export interface AppConfig {
  /** Whether the configuration is valid */
  hasValidConfig: boolean;
  /** Configuration file path */
  configPath?: string;
  /** LLM providers */
  providers?: ProviderConfig[];
  /** Agent configuration */
  agent?: {
    name: string;
    instructions: string;
  };
  /** Default max steps for run mode */
  maxSteps?: number;
  /** Request timeout in milliseconds */
  requestTimeout?: number;
  /** Skill directory list */
  skillDirs?: string[];
  /** SubAgent configuration list */
  subAgents?: SubAgentConfig[];
  /** List of tools requiring user confirmation */
  confirmTools?: string[];
}

/** Default maximum number of steps */
const DEFAULT_MAX_STEPS = 500;

/** Default request timeout (ms) */
const DEFAULT_REQUEST_TIMEOUT = 1_800_000;

/** Default configuration YAML */
const DEFAULT_CONFIG_YAML = `providers:
  - name: openai
    apiKey: ''
    models:
      - modelId: gpt-4

agent:
  name: colts-agent
  instructions: |
    You are an intelligent agent. Follow these principles:
    - Analyze the user's request carefully before acting.
    - Use available tools to gather information and complete tasks.
    - Break complex tasks into smaller, manageable steps.
    - Report results clearly and concisely.
    - If something is unclear, ask the user for clarification.

maxSteps: 500
requestTimeout: 1800000

skillDirs:
  - ./skills
  - ~/.agentskillmania/colts/skills

`;

/**
 * Configuration loading options
 */
export interface LoadConfigOptions {
  /** Override global config directory (for testing) */
  globalDir?: string;
}

/**
 * Find configuration file path
 *
 * Search order: ./colts.yaml -> {globalDir}/config.yaml
 *
 * @param globalDir - Global config directory
 * @returns Config file path, or null if not found
 */
async function findConfigPath(globalDir?: string): Promise<string | null> {
  const localPath = path.resolve('colts.yaml');
  try {
    await fs.access(localPath);
    return localPath;
  } catch {
    // Local config does not exist
  }

  const dir = globalDir ?? CONFIG_DIR;
  const globalPath = path.join(dir, CONFIG_FILE);
  try {
    await fs.access(globalPath);
    return globalPath;
  } catch {
    // Global config does not exist
  }

  return null;
}

/**
 * Get global config file path
 *
 * @param globalDir - Optional override for the global config directory
 * @returns Absolute path to the global config file
 */
function getGlobalConfigPath(globalDir?: string): string {
  return path.join(globalDir ?? CONFIG_DIR, CONFIG_FILE);
}

/**
 * Check if configuration contains required LLM settings
 *
 * @param config - Raw configuration object
 * @returns True if both provider and apiKey are present
 */
function isValidConfig(config: ColtsConfig): boolean {
  const first = config.providers?.[0];
  return !!(first?.name && first?.apiKey && first?.models && first.models.length > 0);
}

/**
 * Load configuration
 *
 * Search order: ./colts.yaml -> {globalDir}/config.yaml
 * If neither is found, creates a default config via Settings.initialize().
 *
 * @param options - Loading options
 */
export async function loadConfig(options?: LoadConfigOptions): Promise<AppConfig> {
  let configPath = await findConfigPath(options?.globalDir);
  if (!configPath) {
    configPath = getGlobalConfigPath(options?.globalDir);
  }

  try {
    const settings = new Settings<ColtsConfig>(configPath);
    await settings.initialize({ defaultYaml: DEFAULT_CONFIG_YAML });
    const config = settings.getValues();

    if (!isValidConfig(config)) {
      return { hasValidConfig: false, configPath };
    }

    return {
      hasValidConfig: true,
      configPath,
      providers: config.providers,
      agent: {
        name: config.agent?.name ?? 'colts-agent',
        instructions: config.agent?.instructions ?? '',
      },
      maxSteps: config.maxSteps ?? DEFAULT_MAX_STEPS,
      requestTimeout: config.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT,
      skillDirs: config.skillDirs,
      subAgents: config.subAgents,
      confirmTools: config.confirmTools,
    };
  } catch {
    return { hasValidConfig: false, configPath };
  }
}

/**
 * Save a configuration value
 *
 * Uses the Settings class to read/write config. Auto-creates the config file.
 *
 * @param keyPath - Dot-separated config key path (e.g. "llm.provider")
 * @param value - Configuration value
 * @param options - Save options
 */
export async function saveConfig(
  keyPath: string,
  value: unknown,
  options?: { globalDir?: string }
): Promise<void> {
  const configPath = getGlobalConfigPath(options?.globalDir);
  const settings = new Settings<ColtsConfig>(configPath);
  await settings.initialize({ defaultYaml: DEFAULT_CONFIG_YAML });
  settings.set(keyPath, value);
  await settings.save();
}

/**
 * First-time configuration wizard save
 *
 * Writes provider, apiKey, and model to the config file.
 *
 * @param setup - Configuration collected by the wizard
 * @param options - Save options
 */
export async function saveSetup(
  setup: { provider: string; apiKey: string; model: string; baseUrl?: string },
  options?: { globalDir?: string }
): Promise<void> {
  const configPath = getGlobalConfigPath(options?.globalDir);
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  const settings = new Settings<ColtsConfig>(configPath);
  await settings.initialize({ defaultYaml: DEFAULT_CONFIG_YAML });
  settings.set('providers', [
    {
      name: setup.provider,
      apiKey: setup.apiKey,
      baseUrl: setup.baseUrl,
      models: [{ modelId: setup.model }],
    },
  ]);
  await settings.save();
}

/**
 * Set a nested value via a dot-separated path
 *
 * @param obj - Target object
 * @param keyPath - Dot-separated key path
 * @param value - Value to set
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  keyPath: string,
  value: unknown
): void {
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
