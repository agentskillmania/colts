/**
 * Settings class unit tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Settings } from '../../src/index';

describe('Settings', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-yaml-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should create Settings instance', () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);
      expect(settings).toBeDefined();
      expect(settings).toBeInstanceOf(Settings);
    });

    it('should expand path starting with ~ to user home directory', async () => {
      const settings = new Settings('~/.test-settings-yaml/config.yaml');
      const expectedPath = path.join(os.homedir(), '.test-settings-yaml/config.yaml');

      await settings.initialize({
        defaultYaml: `name: test`,
      });

      // Verify file was created at correct location
      const content = await fs.readFile(expectedPath, 'utf-8');
      expect(content).toBe('name: test');

      // Cleanup
      await fs.rm(path.join(os.homedir(), '.test-settings-yaml'), {
        recursive: true,
        force: true,
      });
    });

    it('should handle path ending with ~ correctly', async () => {
      const settings = new Settings('~/.test-settings-yaml-dir/config.yaml');
      const expectedPath = path.join(os.homedir(), '.test-settings-yaml-dir/config.yaml');

      await settings.initialize({
        defaultYaml: `name: test`,
      });

      const content = await fs.readFile(expectedPath, 'utf-8');
      expect(content).toBe('name: test');

      // Cleanup
      await fs.rm(path.join(os.homedir(), '.test-settings-yaml-dir'), {
        recursive: true,
        force: true,
      });
    });
  });

  describe('getValues', () => {
    it('should throw error when called before initialize', () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);

      expect(() => settings.getValues()).toThrow('Settings not initialized');
    });
  });

  describe('initialize', () => {
    it('should create file and write defaults when config does not exist', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const defaultYaml = `
server:
  port: 3000
  host: localhost
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // Verify file was created
      const content = await fs.readFile(configPath, 'utf-8');
      expect(content).toContain('server');
      expect(content).toContain('port: 3000');
    });

    it('should return default values when config does not exist', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const defaultYaml = `
server:
  port: 3000
  host: localhost
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      const values = settings.getValues();
      expect(values).toEqual({
        server: {
          port: 3000,
          host: 'localhost',
        },
      });
    });

    it('should throw error when config does not exist and no defaultYaml provided', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);

      await expect(settings.initialize()).rejects.toThrow('Config file not found');
    });

    it('should recursively create intermediate directories', async () => {
      const configPath = path.join(tempDir, 'a', 'b', 'c', 'config.yaml');
      const defaultYaml = `name: test`;

      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // Verify file was created
      const content = await fs.readFile(configPath, 'utf-8');
      expect(content).toBe('name: test');
    });

    it('should read and merge with defaults when config exists', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const userYaml = `
server:
  port: 8080
`;
      await fs.writeFile(configPath, userYaml, 'utf-8');

      const defaultYaml = `
server:
  port: 3000
  host: localhost
  timeout: 5000
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      const values = settings.getValues();
      expect(values).toEqual({
        server: {
          port: 8080, // user value overrides default
          host: 'localhost', // default fills in
          timeout: 5000, // default fills in
        },
      });
    });

    it('should only read config file when no defaultYaml provided', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const userYaml = `
server:
  port: 8080
`;
      await fs.writeFile(configPath, userYaml, 'utf-8');

      const settings = new Settings(configPath);
      await settings.initialize();

      const values = settings.getValues();
      expect(values).toEqual({
        server: {
          port: 8080,
        },
      });
    });

    it('should support deep merge for multi-level nested objects', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const userYaml = `
database:
  connection:
    host: db.example.com
`;
      await fs.writeFile(configPath, userYaml, 'utf-8');

      const defaultYaml = `
database:
  connection:
    host: localhost
    port: 5432
    username: admin
    password: secret
  pool:
    min: 2
    max: 10
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      const values = settings.getValues();
      expect(values).toEqual({
        database: {
          connection: {
            host: 'db.example.com', // user value
            port: 5432, // default value
            username: 'admin', // default value
            password: 'secret', // default value
          },
          pool: {
            min: 2,
            max: 10,
          },
        },
      });
    });

    it('should merge arrays element by element, keeping extra defaults', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const userYaml = `
items:
  - a
  - b
`;
      await fs.writeFile(configPath, userYaml, 'utf-8');

      const defaultYaml = `
items:
  - x
  - y
  - z
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      const values = settings.getValues();
      expect(values).toEqual({
        items: ['a', 'b', 'z'], // target overrides by index, extra defaults kept
      });
    });

    it('should use all defaults when user config is empty object', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      await fs.writeFile(configPath, '{}', 'utf-8');

      const defaultYaml = `
name: test
value: 123
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      const values = settings.getValues();
      expect(values).toEqual({
        name: 'test',
        value: 123,
      });
    });

    it('should use all defaults when config file is empty', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      await fs.writeFile(configPath, '', 'utf-8');

      const defaultYaml = `
name: test
value: 123
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      const values = settings.getValues();
      expect(values).toEqual({
        name: 'test',
        value: 123,
      });
    });

    it('should preserve extra fields in user config', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const userYaml = `
name: test
extraField: extraValue
`;
      await fs.writeFile(configPath, userYaml, 'utf-8');

      const defaultYaml = `name: default`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      const values = settings.getValues();
      expect(values).toEqual({
        name: 'test',
        extraField: 'extraValue',
      });
    });

    it('should return frozen object', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const defaultYaml = `name: test`;

      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      const values = settings.getValues();
      expect(Object.isFrozen(values)).toBe(true);
    });

    it('should handle null values correctly', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const userYaml = `
value: null
`;
      await fs.writeFile(configPath, userYaml, 'utf-8');

      const defaultYaml = `
value: default
nested:
  key: value
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      const values = settings.getValues();
      expect(values).toEqual({
        value: null, // null overrides default
        nested: {
          key: 'value',
        },
      });
    });
  });

  describe('initialize with override', () => {
    it('override should override defaults when config does not exist', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const defaultYaml = `
server:
  port: 3000
  host: localhost
`;
      const settings = new Settings(configPath);
      await settings.initialize({
        defaultYaml,
        override: {
          server: {
            port: 9000,
            host: 'localhost',
          },
        },
      });

      const values = settings.getValues();
      expect(values).toEqual({
        server: {
          port: 9000, // override overrides default
          host: 'localhost',
        },
      });
    });

    it('override should override config values when config exists', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const userYaml = `
server:
  port: 8080
  host: config.example.com
`;
      await fs.writeFile(configPath, userYaml, 'utf-8');

      const defaultYaml = `
server:
  port: 3000
  host: localhost
  timeout: 5000
`;
      const settings = new Settings(configPath);
      await settings.initialize({
        defaultYaml,
        override: {
          server: {
            port: 9999,
            host: 'config.example.com',
            timeout: 5000,
          },
        },
      });

      const values = settings.getValues();
      expect(values).toEqual({
        server: {
          port: 9999, // override overrides config
          host: 'config.example.com', // config value
          timeout: 5000, // default value
        },
      });
    });

    it('override should support deep nested override', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const userYaml = `
database:
  connection:
    host: db.example.com
    port: 5432
`;
      await fs.writeFile(configPath, userYaml, 'utf-8');

      const defaultYaml = `
database:
  connection:
    host: localhost
    port: 5432
    username: admin
    password: secret
`;
      const settings = new Settings(configPath);
      await settings.initialize({
        defaultYaml,
        override: {
          database: {
            connection: {
              host: 'db.example.com',
              port: 5432,
              username: 'override-user',
              password: 'secret',
            },
          },
        },
      });

      const values = settings.getValues();
      expect(values).toEqual({
        database: {
          connection: {
            host: 'db.example.com', // config value
            port: 5432,
            username: 'override-user', // override overrides default
            password: 'secret',
          },
        },
      });
    });

    it('empty override object should not affect config', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const defaultYaml = `
server:
  port: 3000
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml, override: {} });

      const values = settings.getValues();
      expect(values).toEqual({
        server: {
          port: 3000,
        },
      });
    });

    it('only override without defaultYaml when config exists', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const userYaml = `
server:
  port: 8080
`;
      await fs.writeFile(configPath, userYaml, 'utf-8');

      const settings = new Settings(configPath);
      await settings.initialize({
        override: {
          server: {
            port: 9999,
          },
        },
      });

      const values = settings.getValues();
      expect(values).toEqual({
        server: {
          port: 9999, // override overrides config
        },
      });
    });

    it('override priority should be higher than config and defaults', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const userYaml = `
name: from-config
level: 2
`;
      await fs.writeFile(configPath, userYaml, 'utf-8');

      const defaultYaml = `
name: from-default
level: 1
mode: normal
`;
      const settings = new Settings(configPath);
      await settings.initialize({
        defaultYaml,
        override: {
          name: 'from-override',
          level: 2,
          mode: 'normal',
        },
      });

      const values = settings.getValues();
      expect(values).toEqual({
        name: 'from-override', // override has highest priority
        level: 2, // config value (not specified in override)
        mode: 'normal', // default value
      });
    });
  });

  describe('has', () => {
    it('should return true for existing top-level key', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml: 'name: test' });

      expect(settings.has('name')).toBe(true);
    });

    it('should return true for existing nested key', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);
      await settings.initialize({
        defaultYaml: `
server:
  port: 3000
`,
      });

      expect(settings.has('server.port')).toBe(true);
    });

    it('should return false for missing key', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml: 'name: test' });

      expect(settings.has('missing')).toBe(false);
    });

    it('should return false for missing nested key', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);
      await settings.initialize({
        defaultYaml: `
server:
  port: 3000
`,
      });

      expect(settings.has('server.host')).toBe(false);
    });

    it('should throw if not initialized', () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);

      expect(() => settings.has('key')).toThrow('Settings not initialized');
    });
  });

  describe('set', () => {
    it('should set a top-level value', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml: 'name: old' });

      settings.set('name', 'new');
      expect(settings.getValues().name).toBe('new');
    });

    it('should set a nested value', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);
      await settings.initialize({
        defaultYaml: `
server:
  port: 3000
`,
      });

      settings.set('server.port', 8080);
      expect(settings.getValues().server.port).toBe(8080);
    });

    it('should create intermediate objects for new nested keys', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml: 'name: test' });

      settings.set('deep.nested.key', 'value');
      expect(settings.getValues().deep.nested.key).toBe('value');
    });

    it('should keep values frozen after set', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml: 'name: test' });

      settings.set('name', 'new');
      expect(Object.isFrozen(settings.getValues())).toBe(true);
    });

    it('should throw if not initialized', () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);

      expect(() => settings.set('key', 'value')).toThrow('Settings not initialized');
    });

    // T5: 回归测试 — set() 不覆盖 falsy primitive 值 (CR SY-1)
    it('should not overwrite falsy primitive values when creating intermediate objects', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);
      await settings.initialize({
        defaultYaml: `
flags:
  enabled: false
  count: 0
  name: ""
`,
      });

      // 在 flags 下设置一个新 key，不应覆盖已有的 falsy 值
      settings.set('flags.newKey', 'value');
      const values = settings.getValues();
      expect((values as { flags: { enabled: boolean } }).flags.enabled).toBe(false);
      expect((values as { flags: { count: number } }).flags.count).toBe(0);
      expect((values as { flags: { name: string } }).flags.name).toBe('');
      expect((values as { flags: { newKey: string } }).flags.newKey).toBe('value');
    });
  });

  describe('toObject', () => {
    it('should return a mutable copy', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml: 'name: test' });

      const obj = settings.toObject();
      expect(obj).toEqual({ name: 'test' });
      expect(Object.isFrozen(obj)).toBe(false);
    });

    it('should not affect original when mutated', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml: 'name: test' });

      const obj = settings.toObject();
      obj.name = 'changed';

      expect(settings.getValues().name).toBe('test');
    });

    it('should throw if not initialized', () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);

      expect(() => settings.toObject()).toThrow('Settings not initialized');
    });
  });

  describe('save', () => {
    it('should persist changes to disk', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml: 'name: old' });

      settings.set('name', 'new');
      await settings.save();

      // Read file directly and verify
      const content = await fs.readFile(configPath, 'utf-8');
      expect(content).toContain('new');
    });

    it('should persist nested changes to disk', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);
      await settings.initialize({
        defaultYaml: `
server:
  port: 3000
`,
      });

      settings.set('server.port', 8080);
      await settings.save();

      // Reload from disk
      const settings2 = new Settings(configPath);
      await settings2.initialize();
      expect(settings2.getValues().server.port).toBe(8080);
    });

    it('should create parent directories if needed', async () => {
      const configPath = path.join(tempDir, 'a', 'b', 'config.yaml');
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml: 'name: test' });

      settings.set('name', 'updated');
      await settings.save();

      const content = await fs.readFile(configPath, 'utf-8');
      expect(content).toContain('updated');
    });

    it('should throw if not initialized', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);

      await expect(settings.save()).rejects.toThrow('Settings not initialized');
    });

    it('should keep values frozen after save', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml: 'name: test' });

      settings.set('name', 'updated');
      await settings.save();

      expect(Object.isFrozen(settings.getValues())).toBe(true);
      expect(settings.getValues().name).toBe('updated');
    });
  });
});
