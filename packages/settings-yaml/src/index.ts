/**
 * Settings YAML 主模块
 *
 * 用于读取和管理 YAML 配置文件
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { deepMerge } from './deepMerge.js';
import { mkdirp } from './mkdirp.js';

// 导出工具函数供外部使用
export { deepMerge } from './deepMerge.js';
export { mkdirp } from './mkdirp.js';

/**
 * 初始化选项
 */
export interface InitializeOptions<T extends Record<string, unknown>> {
  /**
   * 用于覆盖配置的对象（如命令行参数）
   * 优先级最高
   */
  override?: Partial<T>;

  /**
   * 默认配置的 YAML 字符串
   * 优先级最低
   */
  defaultYaml?: string;
}

/**
 * Settings 类
 *
 * 用于读取和管理 YAML 配置文件，支持默认值和深度合并
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
  /** 配置文件路径 */
  private readonly configPath: string;

  /** 配置值（初始化后填充） */
  private values: T | null = null;

  /**
   * 创建 Settings 实例
   *
   * @param configPath - 配置文件的绝对路径、相对路径或以 ~ 开头的用户目录路径
   */
  constructor(configPath: string) {
    this.configPath = configPath.startsWith('~')
      ? path.join(os.homedir(), configPath.slice(1))
      : configPath;
  }

  /**
   * 初始化配置
   *
   * - 如果配置文件不存在且有 defaultYaml，创建文件并写入默认值
   * - 如果配置文件不存在且没有 defaultYaml，抛出错误
   * - 如果配置文件存在，读取并与默认值深度合并
   * - 如果中间目录不存在，递归创建
   * - 支持通过 override 参数临时覆盖配置（优先级最高）
   *
   * 合并优先级：override > 配置文件 > defaultYaml
   *
   * @param options - 初始化选项
   */
  async initialize(options?: InitializeOptions<T>): Promise<void> {
    const { override, defaultYaml } = options || {};

    // 解析默认值
    const defaultValue = defaultYaml ? (yaml.load(defaultYaml) as T) : ({} as T);

    // 检查配置文件是否存在
    let exists = false;
    try {
      await fs.access(this.configPath);
      exists = true;
    } catch {
      exists = false;
    }

    if (!exists) {
      // 配置文件不存在且没有默认值，抛出错误
      if (!defaultYaml) {
        throw new Error(
          `Config file not found: ${this.configPath}. Provide defaultYaml to create it.`
        );
      }

      // 创建中间目录
      const dir = path.dirname(this.configPath);
      await mkdirp(dir);

      // 写入默认配置
      await fs.writeFile(this.configPath, defaultYaml, 'utf-8');

      // 合并：默认值 + override
      let result = defaultValue;
      if (override) {
        result = deepMerge(override as Record<string, unknown>, defaultValue);
      }
      this.values = Object.freeze(result) as T;
    } else {
      // 读取现有配置
      const content = await fs.readFile(this.configPath, 'utf-8');
      const userConfig = yaml.load(content) as Record<string, unknown>;

      // 深度合并：默认值 + 用户配置 + override
      let result = deepMerge(userConfig || {}, defaultValue);
      if (override) {
        result = deepMerge(override as Record<string, unknown>, result);
      }
      this.values = Object.freeze(result) as T;
    }
  }

  /**
   * 获取配置值
   *
   * @returns 冻结的配置对象
   * @throws Error 如果尚未初始化
   */
  getValues(): T {
    if (this.values === null) {
      throw new Error('Settings not initialized. Call initialize() first.');
    }
    return this.values;
  }
}
