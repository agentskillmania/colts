/**
 * CLI 配置生命周期集成测试
 *
 * User Story: CLI Configuration Lifecycle
 * 作为 CLI 用户，我希望通过 CLI 命令配置 LLM provider，
 * 以便设置并持久化 API key、model 和 provider。
 *
 * 测试配置文件的创建、读取、优先级和持久化等完整生命周期。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig, saveConfig } from '../../src/config.js';

describe('CLI 配置生命周期', () => {
  const testDir = path.join(os.tmpdir(), `colts-intg-config-${Date.now()}`);
  const globalDir = path.join(testDir, 'global');

  beforeEach(async () => {
    // 每个用例前创建全新的隔离目录
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(globalDir, { recursive: true });
  });

  afterEach(async () => {
    // 清理测试目录
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  /**
   * 场景 1: 无配置文件 → loadConfig 返回 hasValidConfig: false
   */
  it('无配置文件时 loadConfig 返回 hasValidConfig 为 false', async () => {
    // 创建完全空的隔离目录，无本地也无全局配置
    const emptyDir = path.join(testDir, 'empty');
    await fs.mkdir(emptyDir, { recursive: true });

    const originalCwd = process.cwd();
    process.chdir(emptyDir);

    try {
      const config = await loadConfig({ globalDir: path.join(emptyDir, 'noglobal') });
      expect(config.hasValidConfig).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });

  /**
   * 场景 2: 本地 colts.yaml 存在且有效 → loadConfig 返回正确值
   */
  it('本地存在有效 colts.yaml 时 loadConfig 返回正确配置', async () => {
    const yamlContent = `
llm:
  provider: openai
  apiKey: sk-local-test-key
  model: gpt-4-turbo
agent:
  name: test-agent
  instructions: "You are a test assistant."
`;
    const localConfig = path.join(testDir, 'colts.yaml');
    await fs.writeFile(localConfig, yamlContent, 'utf-8');

    const originalCwd = process.cwd();
    process.chdir(testDir);

    try {
      const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
      expect(config.hasValidConfig).toBe(true);
      expect(config.llm?.provider).toBe('openai');
      expect(config.llm?.apiKey).toBe('sk-local-test-key');
      expect(config.llm?.model).toBe('gpt-4-turbo');
    } finally {
      process.chdir(originalCwd);
    }
  });

  /**
   * 场景 3: 仅全局 config.yaml 存在 → loadConfig 返回正确值
   */
  it('仅全局配置文件存在时 loadConfig 返回正确配置', async () => {
    // 本地无配置
    const localOnlyDir = path.join(testDir, 'nolocal');
    await fs.mkdir(localOnlyDir, { recursive: true });

    // 全局目录放配置
    const yamlContent = `
llm:
  provider: anthropic
  apiKey: sk-ant-global-key
  model: claude-3-opus
`;
    await fs.writeFile(path.join(globalDir, 'config.yaml'), yamlContent, 'utf-8');

    const originalCwd = process.cwd();
    process.chdir(localOnlyDir);

    try {
      const config = await loadConfig({ globalDir });
      expect(config.hasValidConfig).toBe(true);
      expect(config.llm?.provider).toBe('anthropic');
      expect(config.llm?.apiKey).toBe('sk-ant-global-key');
      expect(config.llm?.model).toBe('claude-3-opus');
    } finally {
      process.chdir(originalCwd);
    }
  });

  /**
   * 场景 4: 本地配置优先于全局配置
   */
  it('本地配置优先于全局配置', async () => {
    // 本地配置
    const localYaml = `
llm:
  provider: openai
  apiKey: sk-local-priority
  model: gpt-4
`;
    await fs.writeFile(path.join(testDir, 'colts.yaml'), localYaml, 'utf-8');

    // 全局配置（不同值）
    const globalYaml = `
llm:
  provider: anthropic
  apiKey: sk-global-backup
  model: claude-3
`;
    await fs.writeFile(path.join(globalDir, 'config.yaml'), globalYaml, 'utf-8');

    const originalCwd = process.cwd();
    process.chdir(testDir);

    try {
      const config = await loadConfig({ globalDir });
      expect(config.hasValidConfig).toBe(true);
      // 本地配置应该优先
      expect(config.llm?.apiKey).toBe('sk-local-priority');
      expect(config.llm?.provider).toBe('openai');
      expect(config.llm?.model).toBe('gpt-4');
    } finally {
      process.chdir(originalCwd);
    }
  });

  /**
   * 场景 5: 配置缺少 apiKey → hasValidConfig: false
   */
  it('配置缺少 apiKey 时 hasValidConfig 为 false', async () => {
    const yamlContent = `
llm:
  provider: openai
  model: gpt-4
`;
    const localConfig = path.join(testDir, 'colts.yaml');
    await fs.writeFile(localConfig, yamlContent, 'utf-8');

    const originalCwd = process.cwd();
    process.chdir(testDir);

    try {
      const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
      expect(config.hasValidConfig).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });

  /**
   * 场景 6: saveConfig 创建新配置文件并包含默认值和用户值
   */
  it('saveConfig 创建新配置文件并包含默认值和用户值', async () => {
    // 使用不存在配置文件的全新目录
    const freshGlobalDir = path.join(testDir, 'fresh-global');

    await saveConfig('llm.apiKey', 'sk-new-test-key', { globalDir: freshGlobalDir });

    // 验证文件被创建
    const configPath = path.join(freshGlobalDir, 'config.yaml');
    const content = await fs.readFile(configPath, 'utf-8');

    // 用户设置的值
    expect(content).toContain('sk-new-test-key');
    // 默认值也应该存在（saveConfig 会先用默认值初始化）
    expect(content).toContain('openai');
    expect(content).toContain('gpt-4');
  });

  /**
   * 场景 7: saveConfig 更新已有值
   */
  it('saveConfig 更新已有配置值', async () => {
    // 先设置一个值
    await saveConfig('llm.apiKey', 'sk-old-key', { globalDir });
    await saveConfig('llm.provider', 'openai', { globalDir });

    // 更新 apiKey
    await saveConfig('llm.apiKey', 'sk-updated-key', { globalDir });

    // 读取文件验证更新
    const content = await fs.readFile(path.join(globalDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('sk-updated-key');
    // provider 保持不变
    expect(content).toContain('openai');
  });

  /**
   * 场景 8: 多次 saveConfig 调用持久化所有值
   */
  it('多次 saveConfig 调用后所有值都被持久化', async () => {
    const multiGlobalDir = path.join(testDir, 'multi-global');

    // 连续保存多个配置项
    await saveConfig('llm.provider', 'openai', { globalDir: multiGlobalDir });
    await saveConfig('llm.apiKey', 'sk-multi-key', { globalDir: multiGlobalDir });
    await saveConfig('llm.model', 'gpt-4o', { globalDir: multiGlobalDir });
    await saveConfig('llm.baseUrl', 'https://api.custom.com/v1', { globalDir: multiGlobalDir });

    // 验证所有值都被持久化
    const content = await fs.readFile(path.join(multiGlobalDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('openai');
    expect(content).toContain('sk-multi-key');
    expect(content).toContain('gpt-4o');
    expect(content).toContain('https://api.custom.com/v1');
  });

  /**
   * 场景 9: saveConfig 创建父目录
   */
  it('saveConfig 能创建不存在的父目录', async () => {
    // 使用嵌套的不存在的目录
    const nestedDir = path.join(testDir, 'nested', 'deep', 'config');

    // 确认目录不存在
    await expect(fs.access(nestedDir)).rejects.toThrow();

    await saveConfig('llm.apiKey', 'sk-nested-key', { globalDir: nestedDir });

    // 验证目录被创建
    await fs.access(nestedDir);
    const content = await fs.readFile(path.join(nestedDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('sk-nested-key');
  });

  /**
   * 场景 10: saveConfig 后 loadConfig 能读回保存的值
   */
  it('saveConfig 后 loadConfig 能正确读回保存的值', async () => {
    const roundtripGlobalDir = path.join(testDir, 'roundtrip-global');

    // 保存配置
    await saveConfig('llm.provider', 'openai', { globalDir: roundtripGlobalDir });
    await saveConfig('llm.apiKey', 'sk-roundtrip-key', { globalDir: roundtripGlobalDir });
    await saveConfig('llm.model', 'gpt-4o-mini', { globalDir: roundtripGlobalDir });

    // 确保无本地配置干扰
    const noLocalDir = path.join(testDir, 'roundtrip-nolocal');
    await fs.mkdir(noLocalDir, { recursive: true });

    const originalCwd = process.cwd();
    process.chdir(noLocalDir);

    try {
      // 加载配置
      const config = await loadConfig({ globalDir: roundtripGlobalDir });
      expect(config.hasValidConfig).toBe(true);
      expect(config.llm?.provider).toBe('openai');
      expect(config.llm?.apiKey).toBe('sk-roundtrip-key');
      expect(config.llm?.model).toBe('gpt-4o-mini');
    } finally {
      process.chdir(originalCwd);
    }
  });
});
