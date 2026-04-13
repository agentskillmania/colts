/**
 * config.ts unit tests
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
      // Ignore cleanup errors
    }
  });

  describe('setNestedValue', () => {
    it('should set top-level key', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'name', 'test');
      expect(obj.name).toBe('test');
    });

    it('should set nested path', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'llm.provider', 'openai');
      expect((obj.llm as Record<string, unknown>).provider).toBe('openai');
    });

    it('should set deeply nested path', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'a.b.c', 'value');
      const a = obj.a as Record<string, unknown>;
      const b = a.b as Record<string, unknown>;
      expect(b.c).toBe('value');
    });

    it('should overwrite existing value', () => {
      const obj: Record<string, unknown> = { name: 'old' };
      setNestedValue(obj, 'name', 'new');
      expect(obj.name).toBe('new');
    });

    it('should set nested value on existing object', () => {
      const obj: Record<string, unknown> = {
        llm: { provider: 'openai' },
      };
      setNestedValue(obj, 'llm.model', 'gpt-4');
      const llm = obj.llm as Record<string, unknown>;
      expect(llm.provider).toBe('openai');
      expect(llm.model).toBe('gpt-4');
    });

    it('should overwrite non-object value with object', () => {
      const obj: Record<string, unknown> = { llm: 'string' };
      setNestedValue(obj, 'llm.provider', 'openai');
      expect(typeof obj.llm).toBe('object');
    });
  });

  describe('loadConfig', () => {
    it('should return hasValidConfig=false when no config file exists', async () => {
      // Use an isolated empty directory with no local or global config
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

    it('should return correct config when valid local config exists', async () => {
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

    it('should return correct config when valid global config exists', async () => {
      // Ensure no local config exists
      const localOnlyDir = path.join(testDir, 'nolocal');
      await fs.mkdir(localOnlyDir, { recursive: true });

      // Place config in global directory
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

    it('should return hasValidConfig=false when apiKey is missing', async () => {
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

    it('should return hasValidConfig=false when YAML is empty', async () => {
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

    it('should prefer local config over global config', async () => {
      // Local config
      const localYaml = `
llm:
  provider: openai
  apiKey: sk-local
  model: gpt-4
`;
      await fs.writeFile(path.join(testDir, 'colts.yaml'), localYaml, 'utf-8');

      // Global config (different values)
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
        // Local config should take priority
        expect(config.llm?.apiKey).toBe('sk-local');
        expect(config.llm?.provider).toBe('openai');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return default maxSteps and requestTimeout when not specified', async () => {
      const yamlContent = `
llm:
  provider: openai
  apiKey: sk-test-key
  model: gpt-4
`;
      const localConfig = path.join(testDir, 'colts.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(true);
        expect(config.maxSteps).toBe(20);
        expect(config.requestTimeout).toBe(1_800_000);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return custom maxSteps and requestTimeout when specified', async () => {
      const yamlContent = `
llm:
  provider: openai
  apiKey: sk-test-key
  model: gpt-4
maxSteps: 50
requestTimeout: 60000
`;
      const localConfig = path.join(testDir, 'colts.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(true);
        expect(config.maxSteps).toBe(50);
        expect(config.requestTimeout).toBe(60000);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('saveConfig', () => {
    it('should save config to specified global path', async () => {
      await saveConfig('llm.provider', 'openai', { globalDir });

      const content = await fs.readFile(path.join(globalDir, 'config.yaml'), 'utf-8');
      expect(content).toContain('openai');
    });

    it('should set nested path value', async () => {
      await saveConfig('llm.apiKey', 'sk-test-new', { globalDir });
      await saveConfig('llm.model', 'gpt-4o', { globalDir });

      const content = await fs.readFile(path.join(globalDir, 'config.yaml'), 'utf-8');
      expect(content).toContain('sk-test-new');
      expect(content).toContain('gpt-4o');
    });

    it('should set new top-level key', async () => {
      await saveConfig('agent.name', 'my-test-agent', { globalDir });

      const content = await fs.readFile(path.join(globalDir, 'config.yaml'), 'utf-8');
      expect(content).toContain('my-test-agent');
    });

    it('should load config after saving', async () => {
      await saveConfig('llm.provider', 'openai', { globalDir });
      await saveConfig('llm.apiKey', 'sk-test-key', { globalDir });
      await saveConfig('llm.model', 'gpt-4', { globalDir });

      // Use isolated directory to avoid local config interference
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

  describe('loadConfig error handling', () => {
    it('should return hasValidConfig=false for malformed YAML', async () => {
      // Write invalid YAML (unclosed quote)
      const localConfig = path.join(testDir, 'colts.yaml');
      await fs.writeFile(localConfig, 'llm:\n  provider: openai\n  apiKey: "unclosed', 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(false);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return hasValidConfig=false when config file path is unreadable', async () => {
      // Use a non-existent path, but Settings constructor may throw
      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: '/dev/null/impossible' });
        // Whether it throws or not, returning false is fine
        expect(config.hasValidConfig).toBe(false);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
