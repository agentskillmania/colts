/**
 * CLI configuration lifecycle integration tests
 *
 * User Story: CLI Configuration Lifecycle
 * As a CLI user, I want to configure the LLM provider via CLI commands,
 * so I can set and persist my API key, model, and provider.
 *
 * Tests the full lifecycle of config file creation, reading, priority, and persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig, saveConfig } from '../../src/config.js';

describe('CLI configuration lifecycle', () => {
  const testDir = path.join(os.tmpdir(), `colts-intg-config-${Date.now()}`);
  const globalDir = path.join(testDir, 'global');

  beforeEach(async () => {
    // Create fresh isolated directory before each test
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(globalDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Scenario 1: No config file → loadConfig returns hasValidConfig: false
   */
  it('loadConfig returns hasValidConfig false when no config file exists', async () => {
    // Create completely empty isolated directory with no local or global config
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
   * Scenario 2: Local colts.yaml exists and is valid → loadConfig returns correct values
   */
  it('loadConfig returns correct config when local colts.yaml exists and is valid', async () => {
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
   * Scenario 3: Only global config.yaml exists → loadConfig returns correct values
   */
  it('loadConfig returns correct config when only global config exists', async () => {
    // No local config
    const localOnlyDir = path.join(testDir, 'nolocal');
    await fs.mkdir(localOnlyDir, { recursive: true });

    // Place config in global directory
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
   * Scenario 4: Local config takes priority over global config
   */
  it('Local config takes priority over global config', async () => {
    // Local config
    const localYaml = `
llm:
  provider: openai
  apiKey: sk-local-priority
  model: gpt-4
`;
    await fs.writeFile(path.join(testDir, 'colts.yaml'), localYaml, 'utf-8');

    // Global config (different values)
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
      // Local config should take priority
      expect(config.llm?.apiKey).toBe('sk-local-priority');
      expect(config.llm?.provider).toBe('openai');
      expect(config.llm?.model).toBe('gpt-4');
    } finally {
      process.chdir(originalCwd);
    }
  });

  /**
   * Scenario 5: Config missing apiKey → hasValidConfig: false
   */
  it('hasValidConfig is false when config is missing apiKey', async () => {
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
   * Scenario 6: saveConfig creates new config file with defaults and user values
   */
  it('saveConfig creates new config file with defaults and user values', async () => {
    // Use a fresh directory with no existing config file
    const freshGlobalDir = path.join(testDir, 'fresh-global');

    await saveConfig('llm.apiKey', 'sk-new-test-key', { globalDir: freshGlobalDir });

    // Verify file was created
    const configPath = path.join(freshGlobalDir, 'config.yaml');
    const content = await fs.readFile(configPath, 'utf-8');

    // User-set value
    expect(content).toContain('sk-new-test-key');
    // Default values should also exist (saveConfig initializes with defaults first)
    expect(content).toContain('openai');
    expect(content).toContain('gpt-4');
  });

  /**
   * Scenario 7: saveConfig updates existing values
   */
  it('saveConfig updates existing config values', async () => {
    // Set a value first
    await saveConfig('llm.apiKey', 'sk-old-key', { globalDir });
    await saveConfig('llm.provider', 'openai', { globalDir });

    // Update apiKey
    await saveConfig('llm.apiKey', 'sk-updated-key', { globalDir });

    // Read file to verify update
    const content = await fs.readFile(path.join(globalDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('sk-updated-key');
    // provider remains unchanged
    expect(content).toContain('openai');
  });

  /**
   * Scenario 8: Multiple saveConfig calls persist all values
   */
  it('All values are persisted after multiple saveConfig calls', async () => {
    const multiGlobalDir = path.join(testDir, 'multi-global');

    // Save multiple config items consecutively
    await saveConfig('llm.provider', 'openai', { globalDir: multiGlobalDir });
    await saveConfig('llm.apiKey', 'sk-multi-key', { globalDir: multiGlobalDir });
    await saveConfig('llm.model', 'gpt-4o', { globalDir: multiGlobalDir });
    await saveConfig('llm.baseUrl', 'https://api.custom.com/v1', { globalDir: multiGlobalDir });

    // Verify all values are persisted
    const content = await fs.readFile(path.join(multiGlobalDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('openai');
    expect(content).toContain('sk-multi-key');
    expect(content).toContain('gpt-4o');
    expect(content).toContain('https://api.custom.com/v1');
  });

  /**
   * Scenario 9: saveConfig creates parent directories
   */
  it('saveConfig creates non-existent parent directories', async () => {
    // Use nested non-existent directories
    const nestedDir = path.join(testDir, 'nested', 'deep', 'config');

    // Confirm directory does not exist
    await expect(fs.access(nestedDir)).rejects.toThrow();

    await saveConfig('llm.apiKey', 'sk-nested-key', { globalDir: nestedDir });

    // Verify directory was created
    await fs.access(nestedDir);
    const content = await fs.readFile(path.join(nestedDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('sk-nested-key');
  });

  /**
   * Scenario 10: saveConfig followed by loadConfig reads back saved values
   */
  it('loadConfig reads back values saved by saveConfig', async () => {
    const roundtripGlobalDir = path.join(testDir, 'roundtrip-global');

    // Save config
    await saveConfig('llm.provider', 'openai', { globalDir: roundtripGlobalDir });
    await saveConfig('llm.apiKey', 'sk-roundtrip-key', { globalDir: roundtripGlobalDir });
    await saveConfig('llm.model', 'gpt-4o-mini', { globalDir: roundtripGlobalDir });

    // Ensure no local config interference
    const noLocalDir = path.join(testDir, 'roundtrip-nolocal');
    await fs.mkdir(noLocalDir, { recursive: true });

    const originalCwd = process.cwd();
    process.chdir(noLocalDir);

    try {
      // Load config
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
