/**
 * @fileoverview 配置管理 — 使用 settings-yaml 读取配置
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Settings, mkdirp } from '@agentskillmania/settings-yaml';
import type { AppConfig } from './app.js';

/** 配置文件默认路径 */
const CONFIG_DIR = path.join(os.homedir(), '.agentskillmania', 'colts');
const CONFIG_FILE = 'config.yaml';

/**
 * colts-cli 配置结构
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
 * 默认配置 YAML
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
 * 加载配置的选项
 */
export interface LoadConfigOptions {
  /** 覆盖全局配置目录（测试用） */
  globalDir?: string;
}

/**
 * 查找配置文件路径
 *
 * 查找顺序：./colts.yaml > {globalDir}/config.yaml
 */
async function findConfigPath(globalDir?: string): Promise<string | null> {
  // 1. 本地项目配置
  const localPath = path.resolve('colts.yaml');
  try {
    await fs.access(localPath);
    return localPath;
  } catch {
    // 本地配置不存在，继续查找
  }

  // 2. 全局配置
  const dir = globalDir ?? CONFIG_DIR;
  const globalPath = path.join(dir, CONFIG_FILE);
  try {
    await fs.access(globalPath);
    return globalPath;
  } catch {
    // 全局配置也不存在
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
 * 检查配置是否有效（包含必要的 LLM 配置）
 */
function isValidConfig(config: ColtsConfig): boolean {
  return !!(config.llm?.apiKey && config.llm?.provider);
}

/**
 * 加载配置
 *
 * 优先从配置文件读取，没有配置文件时返回未配置状态。
 *
 * @param options - 加载选项（测试时可注入 globalDir）
 */
export async function loadConfig(options?: LoadConfigOptions): Promise<AppConfig> {
  const configPath = await findConfigPath(options?.globalDir);

  if (!configPath) {
    return { hasValidConfig: false };
  }

  try {
    const settings = new Settings<ColtsConfig>(configPath);
    await settings.initialize({ defaultYaml: DEFAULT_CONFIG_YAML });
    const config = settings.getValues();

    if (!isValidConfig(config)) {
      return { hasValidConfig: false };
    }

    return {
      hasValidConfig: true,
      llm: {
        provider: config.llm!.provider!,
        apiKey: config.llm!.apiKey!,
        model: config.llm!.model ?? 'gpt-4',
        baseUrl: config.llm!.baseUrl,
      },
    };
  } catch {
    return { hasValidConfig: false };
  }
}

/**
 * 保存配置
 *
 * @param keyPath - 要更新的配置项路径（支持嵌套路径，如 "llm.provider"）
 * @param value - 配置值
 * @param options - 保存选项（测试时可注入 globalDir）
 */
export async function saveConfig(
  keyPath: string,
  value: string,
  options?: { globalDir?: string }
): Promise<void> {
  const configPath = getGlobalConfigPath(options?.globalDir);

  // 确保目录存在
  await mkdirp(path.dirname(configPath));

  // 读取现有配置或使用空对象
  let existing: Record<string, unknown> = {};
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const yaml = await import('js-yaml');
    existing = yaml.load(content) as Record<string, unknown>;
  } catch {
    // 文件不存在，使用空对象
  }

  // 按点号路径设置值
  setNestedValue(existing, keyPath, value);

  // 写入文件
  const yaml = await import('js-yaml');
  const content = yaml.dump(existing);
  await fs.writeFile(configPath, content, 'utf-8');
}

/**
 * 按点号分隔路径设置嵌套对象的值
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
