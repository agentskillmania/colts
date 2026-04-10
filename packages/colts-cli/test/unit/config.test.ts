/**
 * config.ts 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig, saveConfig, setNestedValue } from '../../src/config.js';

describe('config', () => {
  const testDir = path.join(os.tmpdir(), `colts-test-config-${Date.now()}`);
  const globalDir = path.join(testDir, 'global');

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(globalDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  describe('setNestedValue', () => {
    it('能设置顶级键', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'name', 'test');
      expect(obj.name).toBe('test');
    });

    it('能设置嵌套路径', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'llm.provider', 'openai');
      expect((obj.llm as Record<string, unknown>).provider).toBe('openai');
    });

    it('能设置深层嵌套路径', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'a.b.c', 'value');
      const a = obj.a as Record<string, unknown>;
      const b = a.b as Record<string, unknown>;
      expect(b.c).toBe('value');
    });

    it('能覆盖已存在的值', () => {
      const obj: Record<string, unknown> = { name: 'old' };
      setNestedValue(obj, 'name', 'new');
      expect(obj.name).toBe('new');
    });

    it('能在已有对象上设置嵌套值', () => {
      const obj: Record<string, unknown> = {
        llm: { provider: 'openai' },
      };
      setNestedValue(obj, 'llm.model', 'gpt-4');
      const llm = obj.llm as Record<string, unknown>;
      expect(llm.provider).toBe('openai');
      expect(llm.model).toBe('gpt-4');
    });

    it('能覆盖非对象值为对象', () => {
      const obj: Record<string, unknown> = { llm: 'string' };
      setNestedValue(obj, 'llm.provider', 'openai');
      expect(typeof obj.llm).toBe('object');
    });
  });

  describe('loadConfig', () => {
    it('无配置文件时返回 hasValidConfig=false', async () => {
      // 使用隔离的空目录，无本地也无全局配置
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

    it('有有效本地配置时返回正确配置', async () => {
      const yamlContent = `
llm:
  provider: openai
  apiKey: sk-test-key
  model: gpt-4
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
        expect(config.llm?.apiKey).toBe('sk-test-key');
        expect(config.llm?.model).toBe('gpt-4');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('有有效全局配置时返回正确配置', async () => {
      // 确保本地没有配置
      const localOnlyDir = path.join(testDir, 'nolocal');
      await fs.mkdir(localOnlyDir, { recursive: true });

      // 全局目录放配置
      const yamlContent = `
llm:
  provider: anthropic
  apiKey: sk-ant-test
  model: claude-3
`;
      await fs.writeFile(path.join(globalDir, 'config.yaml'), yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(localOnlyDir);

      try {
        const config = await loadConfig({ globalDir });
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.provider).toBe('anthropic');
        expect(config.llm?.apiKey).toBe('sk-ant-test');
        expect(config.llm?.model).toBe('claude-3');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('缺少 apiKey 时返回 hasValidConfig=false', async () => {
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

    it('有空 YAML 时返回 hasValidConfig=false', async () => {
      const localConfig = path.join(testDir, 'colts.yaml');
      await fs.writeFile(localConfig, '', 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(false);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('本地配置优先于全局配置', async () => {
      // 本地配置
      const localYaml = `
llm:
  provider: openai
  apiKey: sk-local
  model: gpt-4
`;
      await fs.writeFile(path.join(testDir, 'colts.yaml'), localYaml, 'utf-8');

      // 全局配置（不同值）
      const globalYaml = `
llm:
  provider: anthropic
  apiKey: sk-global
  model: claude-3
`;
      await fs.writeFile(path.join(globalDir, 'config.yaml'), globalYaml, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir });
        expect(config.hasValidConfig).toBe(true);
        // 本地配置应该优先
        expect(config.llm?.apiKey).toBe('sk-local');
        expect(config.llm?.provider).toBe('openai');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('saveConfig', () => {
    it('能保存配置到指定全局路径', async () => {
      await saveConfig('llm.provider', 'openai', { globalDir });

      const content = await fs.readFile(path.join(globalDir, 'config.yaml'), 'utf-8');
      expect(content).toContain('openai');
    });

    it('能设置嵌套路径的值', async () => {
      await saveConfig('llm.apiKey', 'sk-test-new', { globalDir });
      await saveConfig('llm.model', 'gpt-4o', { globalDir });

      const content = await fs.readFile(path.join(globalDir, 'config.yaml'), 'utf-8');
      expect(content).toContain('sk-test-new');
      expect(content).toContain('gpt-4o');
    });

    it('能设置新的顶级键', async () => {
      await saveConfig('agent.name', 'my-test-agent', { globalDir });

      const content = await fs.readFile(path.join(globalDir, 'config.yaml'), 'utf-8');
      expect(content).toContain('my-test-agent');
    });

    it('保存后能加载配置', async () => {
      await saveConfig('llm.provider', 'openai', { globalDir });
      await saveConfig('llm.apiKey', 'sk-test-key', { globalDir });
      await saveConfig('llm.model', 'gpt-4', { globalDir });

      // 使用隔离目录避免本地配置干扰
      const noLocalDir = path.join(testDir, 'nolocal2');
      await fs.mkdir(noLocalDir, { recursive: true });

      const originalCwd = process.cwd();
      process.chdir(noLocalDir);

      try {
        const config = await loadConfig({ globalDir });
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.provider).toBe('openai');
        expect(config.llm?.apiKey).toBe('sk-test-key');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
