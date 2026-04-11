/**
 * @fileoverview User Story: CLI Configuration Management — Write Methods
 *
 * As a CLI application developer
 * I want to programmatically update and persist configuration
 * So that users can change settings through commands like `/config llm.apiKey sk-...`
 *
 * Acceptance Criteria:
 * 1. set() updates in-memory config, save() persists to disk
 * 2. Nested dot-path values are created with intermediate objects
 * 3. has() checks key existence for top-level and nested paths
 * 4. toObject() returns a mutable deep copy without affecting internal state
 * 5. Multiple set() calls can be batched before a single save()
 * 6. save() creates parent directories when needed
 * 7. Values remain frozen across all operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Settings } from '../../src/index.js';

describe('User Story: CLI Configuration Management', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-yaml-write-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // 场景1：设置并持久化单个值
  describe('Scenario 1: Set and persist a single value', () => {
    it('should persist a single value via set + save and survive reload', async () => {
      // Given: 使用默认配置初始化 Settings
      const configPath = path.join(tempDir, 'config.yaml');
      const defaultYaml = `
llm:
  provider: openai
  apiKey: sk-old-key
  model: gpt-3.5
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // When: 使用 set() 修改值，然后用 save() 持久化
      settings.set('llm.apiKey', 'sk-new-key-123');
      await settings.save();

      // Then: 创建新实例从同一文件加载，验证新值已持久化
      const reloaded = new Settings(configPath);
      await reloaded.initialize({ defaultYaml });
      const config = reloaded.getValues();
      expect(config.llm.apiKey).toBe('sk-new-key-123');
      expect(config.llm.provider).toBe('openai');
      expect(config.llm.model).toBe('gpt-3.5');
    });
  });

  // 场景2：设置嵌套值
  describe('Scenario 2: Set nested values', () => {
    it('should update a nested value without affecting siblings', async () => {
      // Given: 初始化带有嵌套配置的 Settings
      const configPath = path.join(tempDir, 'config.yaml');
      const defaultYaml = `
llm:
  provider: openai
  apiKey: sk-old
  model: gpt-3.5
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // When: 更新嵌套路径的某个值
      settings.set('llm.apiKey', 'sk-updated');

      // Then: 其他同级值不变
      const config = settings.getValues();
      expect(config.llm.apiKey).toBe('sk-updated');
      expect(config.llm.provider).toBe('openai');
      expect(config.llm.model).toBe('gpt-3.5');

      // And: save 后重新加载，所有值都正确
      await settings.save();
      const reloaded = new Settings(configPath);
      await reloaded.initialize({ defaultYaml });
      const reloadedConfig = reloaded.getValues();
      expect(reloadedConfig.llm.apiKey).toBe('sk-updated');
      expect(reloadedConfig.llm.provider).toBe('openai');
      expect(reloadedConfig.llm.model).toBe('gpt-3.5');
    });
  });

  // 场景3：set() 创建中间对象
  describe('Scenario 3: Set creates intermediate objects', () => {
    it('should create intermediate objects when setting a deep path', async () => {
      // Given: 使用简单配置初始化
      const configPath = path.join(tempDir, 'config.yaml');
      const defaultYaml = `name: myapp`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // When: 设置一个深层嵌套路径（中间对象不存在）
      settings.set('deep.nested.key', 'value');

      // Then: 中间对象被自动创建
      const config = settings.getValues();
      expect((config as Record<string, unknown>).deep).toEqual({
        nested: { key: 'value' },
      });

      // And: save 后重新加载，值仍然正确
      await settings.save();
      const reloaded = new Settings(configPath);
      await reloaded.initialize({ defaultYaml });
      const reloadedConfig = reloaded.getValues();
      expect((reloadedConfig as Record<string, unknown>).deep).toEqual({
        nested: { key: 'value' },
      });
    });
  });

  // 场景4：has() 检查键是否存在
  describe('Scenario 4: has() checks existence', () => {
    it('should return true for existing keys and false for non-existent keys', async () => {
      // Given: 初始化带有配置的 Settings
      const configPath = path.join(tempDir, 'config.yaml');
      const defaultYaml = `
llm:
  provider: openai
  apiKey: sk-key
  model: gpt-4
debug: true
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // Then: 顶层键存在时返回 true
      expect(settings.has('debug')).toBe(true);
      expect(settings.has('llm')).toBe(true);

      // And: 嵌套键存在时返回 true
      expect(settings.has('llm.provider')).toBe(true);
      expect(settings.has('llm.apiKey')).toBe(true);
      expect(settings.has('llm.model')).toBe(true);

      // And: 不存在的键返回 false
      expect(settings.has('nonexistent')).toBe(false);
      expect(settings.has('llm.nonexistent')).toBe(false);
      expect(settings.has('llm.provider.deep')).toBe(false);

      // When: 通过 set() 添加新键
      settings.set('llm.temperature', 0.7);

      // Then: has() 对新键返回 true
      expect(settings.has('llm.temperature')).toBe(true);
    });

    it('should throw error when calling has() before initialize()', () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);

      // 未初始化时调用 has() 应该抛出错误
      expect(() => settings.has('any.key')).toThrow('Settings not initialized');
    });
  });

  // 场景5：toObject() 返回可变副本
  describe('Scenario 5: toObject() returns mutable copy', () => {
    it('should return a mutable deep copy that does not affect internal state', async () => {
      // Given: 初始化 Settings
      const configPath = path.join(tempDir, 'config.yaml');
      const defaultYaml = `
server:
  port: 3000
  host: localhost
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // When: 调用 toObject() 获取副本
      const copy = settings.toObject();

      // Then: 副本值与 getValues() 一致
      const values = settings.getValues();
      expect(copy.server.port).toBe(values.server.port);
      expect(copy.server.host).toBe(values.server.host);

      // When: 修改返回的对象
      (copy as Record<string, unknown>).modified = true;
      (copy.server as Record<string, unknown>).port = 9999;

      // Then: getValues() 不受影响
      const valuesAfter = settings.getValues();
      expect(valuesAfter.server.port).toBe(3000);
      expect((valuesAfter as Record<string, unknown>).modified).toBeUndefined();

      // And: toObject() 返回的对象不是冻结的
      const anotherCopy = settings.toObject();
      expect(Object.isFrozen(anotherCopy)).toBe(false);
    });
  });

  // 场景6：多次 set() 后单次 save()
  describe('Scenario 6: Multiple set() calls then single save()', () => {
    it('should batch multiple set() calls and persist all with one save()', async () => {
      // Given: 使用默认配置初始化
      const configPath = path.join(tempDir, 'config.yaml');
      const defaultYaml = `
llm:
  provider: openai
  apiKey: sk-old
  model: gpt-3.5
server:
  port: 3000
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // When: 多次 set() 修改不同值
      settings.set('llm.apiKey', 'sk-batch-1');
      settings.set('llm.model', 'gpt-4o');
      settings.set('server.port', 8080);

      // Then: 内存中的值都已更新
      const inMemory = settings.getValues();
      expect(inMemory.llm.apiKey).toBe('sk-batch-1');
      expect(inMemory.llm.model).toBe('gpt-4o');
      expect(inMemory.server.port).toBe(8080);

      // When: 单次 save() 持久化
      await settings.save();

      // Then: 从新实例重新加载，所有值都已持久化
      const reloaded = new Settings(configPath);
      await reloaded.initialize({ defaultYaml });
      const reloadedConfig = reloaded.getValues();
      expect(reloadedConfig.llm.apiKey).toBe('sk-batch-1');
      expect(reloadedConfig.llm.model).toBe('gpt-4o');
      expect(reloadedConfig.server.port).toBe(8080);
    });
  });

  // 场景7：save() 创建父目录
  describe('Scenario 7: Save creates parent directories', () => {
    it('should create non-existent parent directories when saving', async () => {
      // Given: 路径包含不存在的父目录
      const configPath = path.join(tempDir, 'deep', 'nested', 'dir', 'config.yaml');
      const defaultYaml = `name: test`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // When: set() 修改值，save() 保存
      settings.set('version', '2.0.0');
      await settings.save();

      // Then: 文件在正确路径被创建
      const content = await fs.readFile(configPath, 'utf-8');
      expect(content).toContain('version: 2.0.0');

      // And: 文件可以被新实例正确加载
      const reloaded = new Settings(configPath);
      await reloaded.initialize({ defaultYaml });
      expect(reloaded.getValues().version).toBe('2.0.0');
    });
  });

  // 场景8：操作之间值保持冻结
  describe('Scenario 8: Values remain frozen between operations', () => {
    it('should return frozen objects from getValues() after each operation', async () => {
      // Given: 初始化 Settings
      const configPath = path.join(tempDir, 'config.yaml');
      const defaultYaml = `
llm:
  provider: openai
  apiKey: sk-key
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // Then: set() 后 getValues() 返回冻结对象
      settings.set('llm.model', 'gpt-4');
      const afterSet = settings.getValues();
      expect(Object.isFrozen(afterSet)).toBe(true);

      // And: save() 后 getValues() 返回冻结对象
      await settings.save();
      const afterSave = settings.getValues();
      expect(Object.isFrozen(afterSave)).toBe(true);

      // And: toObject() 后 getValues() 仍然返回冻结对象
      settings.toObject();
      const afterToObject = settings.getValues();
      expect(Object.isFrozen(afterToObject)).toBe(true);
    });
  });
});
