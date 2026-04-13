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

  // Scenario 1: Set and persist a single value
  describe('Scenario 1: Set and persist a single value', () => {
    it('should persist a single value via set + save and survive reload', async () => {
      // Given: Initialize Settings with default config
      const configPath = path.join(tempDir, 'config.yaml');
      const defaultYaml = `
llm:
  provider: openai
  apiKey: sk-old-key
  model: gpt-3.5
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // When: Update value with set(), then persist with save()
      settings.set('llm.apiKey', 'sk-new-key-123');
      await settings.save();

      // Then: Create new instance from same file, verify value persisted
      const reloaded = new Settings(configPath);
      await reloaded.initialize({ defaultYaml });
      const config = reloaded.getValues();
      expect(config.llm.apiKey).toBe('sk-new-key-123');
      expect(config.llm.provider).toBe('openai');
      expect(config.llm.model).toBe('gpt-3.5');
    });
  });

  // Scenario 2: Set nested values
  describe('Scenario 2: Set nested values', () => {
    it('should update a nested value without affecting siblings', async () => {
      // Given: Initialize Settings with nested config
      const configPath = path.join(tempDir, 'config.yaml');
      const defaultYaml = `
llm:
  provider: openai
  apiKey: sk-old
  model: gpt-3.5
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // When: Update a nested path value
      settings.set('llm.apiKey', 'sk-updated');

      // Then: Sibling values remain unchanged
      const config = settings.getValues();
      expect(config.llm.apiKey).toBe('sk-updated');
      expect(config.llm.provider).toBe('openai');
      expect(config.llm.model).toBe('gpt-3.5');

      // And: After save and reload, all values are correct
      await settings.save();
      const reloaded = new Settings(configPath);
      await reloaded.initialize({ defaultYaml });
      const reloadedConfig = reloaded.getValues();
      expect(reloadedConfig.llm.apiKey).toBe('sk-updated');
      expect(reloadedConfig.llm.provider).toBe('openai');
      expect(reloadedConfig.llm.model).toBe('gpt-3.5');
    });
  });

  // Scenario 3: set() creates intermediate objects
  describe('Scenario 3: Set creates intermediate objects', () => {
    it('should create intermediate objects when setting a deep path', async () => {
      // Given: Initialize with simple config
      const configPath = path.join(tempDir, 'config.yaml');
      const defaultYaml = `name: myapp`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // When: Set a deep nested path (intermediate objects don't exist)
      settings.set('deep.nested.key', 'value');

      // Then: Intermediate objects are auto-created
      const config = settings.getValues();
      expect((config as Record<string, unknown>).deep).toEqual({
        nested: { key: 'value' },
      });

      // And: After save and reload, value is still correct
      await settings.save();
      const reloaded = new Settings(configPath);
      await reloaded.initialize({ defaultYaml });
      const reloadedConfig = reloaded.getValues();
      expect((reloadedConfig as Record<string, unknown>).deep).toEqual({
        nested: { key: 'value' },
      });
    });
  });

  // Scenario 4: has() checks key existence
  describe('Scenario 4: has() checks existence', () => {
    it('should return true for existing keys and false for non-existent keys', async () => {
      // Given: Initialize Settings with config
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

      // Then: Returns true for top-level existing keys
      expect(settings.has('debug')).toBe(true);
      expect(settings.has('llm')).toBe(true);

      // And: Returns true for nested existing keys
      expect(settings.has('llm.provider')).toBe(true);
      expect(settings.has('llm.apiKey')).toBe(true);
      expect(settings.has('llm.model')).toBe(true);

      // And: Returns false for non-existent keys
      expect(settings.has('nonexistent')).toBe(false);
      expect(settings.has('llm.nonexistent')).toBe(false);
      expect(settings.has('llm.provider.deep')).toBe(false);

      // When: Add new key via set()
      settings.set('llm.temperature', 0.7);

      // Then: has() returns true for the new key
      expect(settings.has('llm.temperature')).toBe(true);
    });

    it('should throw error when calling has() before initialize()', () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);

      // Calling has() before initialize() should throw error
      expect(() => settings.has('any.key')).toThrow('Settings not initialized');
    });
  });

  // Scenario 5: toObject() returns mutable copy
  describe('Scenario 5: toObject() returns mutable copy', () => {
    it('should return a mutable deep copy that does not affect internal state', async () => {
      // Given: Initialize Settings
      const configPath = path.join(tempDir, 'config.yaml');
      const defaultYaml = `
server:
  port: 3000
  host: localhost
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // When: Call toObject() to get a copy
      const copy = settings.toObject();

      // Then: Copy values match getValues()
      const values = settings.getValues();
      expect(copy.server.port).toBe(values.server.port);
      expect(copy.server.host).toBe(values.server.host);

      // When: Modify returned object
      (copy as Record<string, unknown>).modified = true;
      (copy.server as Record<string, unknown>).port = 9999;

      // Then: getValues() is unaffected
      const valuesAfter = settings.getValues();
      expect(valuesAfter.server.port).toBe(3000);
      expect((valuesAfter as Record<string, unknown>).modified).toBeUndefined();

      // And: Object returned by toObject() is not frozen
      const anotherCopy = settings.toObject();
      expect(Object.isFrozen(anotherCopy)).toBe(false);
    });
  });

  // Scenario 6: Multiple set() calls then single save()
  describe('Scenario 6: Multiple set() calls then single save()', () => {
    it('should batch multiple set() calls and persist all with one save()', async () => {
      // Given: Initialize with default config
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

      // When: Multiple set() calls modify different values
      settings.set('llm.apiKey', 'sk-batch-1');
      settings.set('llm.model', 'gpt-4o');
      settings.set('server.port', 8080);

      // Then: In-memory values are all updated
      const inMemory = settings.getValues();
      expect(inMemory.llm.apiKey).toBe('sk-batch-1');
      expect(inMemory.llm.model).toBe('gpt-4o');
      expect(inMemory.server.port).toBe(8080);

      // When: Single save() persists all changes
      await settings.save();

      // Then: Reload from new instance, all values persisted
      const reloaded = new Settings(configPath);
      await reloaded.initialize({ defaultYaml });
      const reloadedConfig = reloaded.getValues();
      expect(reloadedConfig.llm.apiKey).toBe('sk-batch-1');
      expect(reloadedConfig.llm.model).toBe('gpt-4o');
      expect(reloadedConfig.server.port).toBe(8080);
    });
  });

  // Scenario 7: save() creates parent directories
  describe('Scenario 7: Save creates parent directories', () => {
    it('should create non-existent parent directories when saving', async () => {
      // Given: Path contains non-existent parent directories
      const configPath = path.join(tempDir, 'deep', 'nested', 'dir', 'config.yaml');
      const defaultYaml = `name: test`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // When: set() modifies value, save() persists
      settings.set('version', '2.0.0');
      await settings.save();

      // Then: File is created at the correct path
      const content = await fs.readFile(configPath, 'utf-8');
      expect(content).toContain('version: 2.0.0');

      // And: File can be correctly loaded by new instance
      const reloaded = new Settings(configPath);
      await reloaded.initialize({ defaultYaml });
      expect(reloaded.getValues().version).toBe('2.0.0');
    });
  });

  // Scenario 8: Values remain frozen between operations
  describe('Scenario 8: Values remain frozen between operations', () => {
    it('should return frozen objects from getValues() after each operation', async () => {
      // Given: Initialize Settings
      const configPath = path.join(tempDir, 'config.yaml');
      const defaultYaml = `
llm:
  provider: openai
  apiKey: sk-key
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // Then: getValues() returns frozen object after set()
      settings.set('llm.model', 'gpt-4');
      const afterSet = settings.getValues();
      expect(Object.isFrozen(afterSet)).toBe(true);

      // And: getValues() returns frozen object after save()
      await settings.save();
      const afterSave = settings.getValues();
      expect(Object.isFrozen(afterSave)).toBe(true);

      // And: getValues() still returns frozen object after toObject()
      settings.toObject();
      const afterToObject = settings.getValues();
      expect(Object.isFrozen(afterToObject)).toBe(true);
    });
  });
});
