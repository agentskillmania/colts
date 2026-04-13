/**
 * @fileoverview Configuration management — reads/writes CLI config using settings-yaml
 *
 * Config file search order: ./colts.yaml > ~/.agentskillmania/colts/config.yaml
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Settings } from '@agentskillmania/settings-yaml';

/** Default configuration directory */
const CONFIG_DIR = path.join(os.homedir(), '.agentskillmania', 'colts');
const CONFIG_FILE = 'config.yaml';

/**
 * colts.yaml configuration structure
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
  maxSteps?: number;
  requestTimeout?: number;
  skills?: string[];
  subAgents?: Array<{
    name: string;
    description: string;
    config: {
      name: string;
      instructions: string;
      tools?: Array<{ name: string; description: string; parameters?: Record<string, unknown> }>;
    };
    maxSteps?: number;
    allowDelegation?: boolean;
  }>;
}

/**
 * Application configuration (validated structure)
 */
export interface AppConfig {
  /** Whether the configuration is valid (provider + apiKey) */
  hasValidConfig: boolean;
  /** Configuration file path */
  configPath?: string;
  /** LLM configuration */
  llm?: {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl?: string;
  };
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
  skills?: string[];
  /** SubAgent configuration list */
  subAgents?: ColtsConfig['subAgents'];
}

/** 默认最大步数 */
const DEFAULT_MAX_STEPS = 20;

/** 默认请求超时（ms） */
const DEFAULT_REQUEST_TIMEOUT = 1_800_000;

/** Default configuration YAML */
const DEFAULT_CONFIG_YAML = `llm:
  provider: openai
  model: gpt-4

agent:
  name: colts-agent
  instructions: |
    You are an intelligent agent. Follow these principles:
    - Analyze the user's request carefully before acting.
    - Use available tools to gather information and complete tasks.
    - Break complex tasks into smaller, manageable steps.
    - Report results clearly and concisely.
    - If something is unclear, ask the user for clarification.

maxSteps: 20
requestTimeout: 1800000

skills:
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
 */
function getGlobalConfigPath(globalDir?: string): string {
  return path.join(globalDir ?? CONFIG_DIR, CONFIG_FILE);
}

/**
 * Check if configuration contains required LLM settings
 */
function isValidConfig(config: ColtsConfig): boolean {
  return !!(config.llm?.apiKey && config.llm?.provider);
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
      llm: {
        provider: config.llm!.provider!,
        apiKey: config.llm!.apiKey!,
        model: config.llm!.model ?? 'gpt-4',
        baseUrl: config.llm!.baseUrl,
      },
      agent: {
        name: config.agent?.name ?? 'colts-agent',
        instructions: config.agent?.instructions ?? '',
      },
      maxSteps: config.maxSteps ?? DEFAULT_MAX_STEPS,
      requestTimeout: config.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT,
      skills: config.skills,
      subAgents: config.subAgents,
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
  value: string,
  options?: { globalDir?: string }
): Promise<void> {
  const configPath = getGlobalConfigPath(options?.globalDir);
  const settings = new Settings<ColtsConfig>(configPath);
  await settings.initialize({ defaultYaml: DEFAULT_CONFIG_YAML });
  settings.set(keyPath, value);
  await settings.save();
}

/**
 * Set a nested value via a dot-separated path
 *
 * @param obj - Target object
 * @param keyPath - Dot-separated key path
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
