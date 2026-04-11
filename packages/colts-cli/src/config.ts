/**
 * @fileoverview 配置管理 — 使用 settings-yaml 读写 CLI 配置
 *
 * 配置文件查找顺序：./colts.yaml > ~/.agentskillmania/colts/config.yaml
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Settings } from '@agentskillmania/settings-yaml';

/** 默认配置目录 */
const CONFIG_DIR = path.join(os.homedir(), '.agentskillmania', 'colts');
const CONFIG_FILE = 'config.yaml';

/**
 * colts.yaml 配置结构
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
 * 应用配置（经过验证的结构）
 */
export interface AppConfig {
  /** 是否有有效配置（provider + apiKey） */
  hasValidConfig: boolean;
  /** 配置文件路径 */
  configPath?: string;
  /** LLM 配置 */
  llm?: {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl?: string;
  };
  /** Agent 配置 */
  agent?: {
    name: string;
    instructions: string;
  };
  /** Skill 目录列表 */
  skills?: string[];
  /** SubAgent 配置列表 */
  subAgents?: ColtsConfig['subAgents'];
}

/** 默认配置 YAML */
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
 * 配置加载选项
 */
export interface LoadConfigOptions {
  /** 覆盖全局配置目录（测试用） */
  globalDir?: string;
}

/**
 * 查找配置文件路径
 *
 * 搜索顺序：./colts.yaml → {globalDir}/config.yaml
 *
 * @param globalDir - 全局配置目录
 * @returns 配置文件路径，未找到返回 null
 */
async function findConfigPath(globalDir?: string): Promise<string | null> {
  const localPath = path.resolve('colts.yaml');
  try {
    await fs.access(localPath);
    return localPath;
  } catch {
    // 本地配置不存在
  }

  const dir = globalDir ?? CONFIG_DIR;
  const globalPath = path.join(dir, CONFIG_FILE);
  try {
    await fs.access(globalPath);
    return globalPath;
  } catch {
    // 全局配置不存在
  }

  return null;
}

/**
 * 获取全局配置文件路径
 */
function getGlobalConfigPath(globalDir?: string): string {
  return path.join(globalDir ?? CONFIG_DIR, CONFIG_FILE);
}

/**
 * 检查配置是否包含必要的 LLM 设置
 */
function isValidConfig(config: ColtsConfig): boolean {
  return !!(config.llm?.apiKey && config.llm?.provider);
}

/**
 * 加载配置
 *
 * 搜索顺序：./colts.yaml → {globalDir}/config.yaml
 * 如果都找不到，通过 Settings.initialize() 创建默认配置。
 *
 * @param options - 加载选项
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
        instructions: config.agent?.instructions ?? 'You are a helpful assistant.',
      },
      skills: config.skills,
      subAgents: config.subAgents,
    };
  } catch {
    return { hasValidConfig: false, configPath };
  }
}

/**
 * 保存配置值
 *
 * 使用 Settings 类读写配置。自动创建配置文件。
 *
 * @param keyPath - 点分隔的配置键路径（如 "llm.provider"）
 * @param value - 配置值
 * @param options - 保存选项
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
 * 通过点分隔路径设置嵌套值
 *
 * @param obj - 目标对象
 * @param keyPath - 点分隔键路径
 * @param value - 值
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
