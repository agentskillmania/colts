/**
 * @fileoverview User Story: Settings YAML Lifecycle Management
 *
 * As a developer
 * I want to manage application configuration through YAML files
 * So that I can handle first-time setup, upgrades, environment overrides,
 * and team collaboration scenarios
 *
 * Acceptance Criteria:
 * 1. First-time users get default configuration auto-created
 * 2. App upgrades merge new defaults with user existing config
 * 3. CLI arguments can temporarily override any config value
 * 4. Different environments (dev/test/prod) use different configs
 * 5. Team can share defaults while allowing personal customization
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Settings } from '../../src/index.js';

describe('User Story: Settings YAML Lifecycle Management', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-yaml-integration-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Scenario 1: First-time installation
  describe('Scenario 1: First-time User Installation', () => {
    it('should create default config when app runs for the first time', async () => {
      // Given: User installs app for the first time, no config exists
      const configPath = path.join(tempDir, '.myapp', 'config.yaml');
      const defaultYaml = `
app:
  name: MyApp
  version: 1.0.0
server:
  port: 3000
  host: localhost
database:
  connection:
    host: localhost
    port: 5432
    database: myapp
`;

      // When: App initializes settings
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // Then: Config file is created with defaults
      const fileContent = await fs.readFile(configPath, 'utf-8');
      expect(fileContent).toContain('port: 3000');
      expect(fileContent).toContain('database: myapp');

      // And: App can read the config
      const config = settings.getValues();
      expect(config.app.name).toBe('MyApp');
      expect(config.server.port).toBe(3000);
      expect(config.database.connection.host).toBe('localhost');
    });

    it('should throw error when no default provided and config missing', async () => {
      // Given: User deleted config, app has no defaults
      const configPath = path.join(tempDir, 'deleted-config.yaml');
      const settings = new Settings(configPath);

      // When/Then: Should throw meaningful error
      await expect(settings.initialize()).rejects.toThrow('Config file not found');
    });

    it('should create nested directories for config file', async () => {
      // Given: Deep nested path that doesn't exist
      const configPath = path.join(tempDir, 'very', 'deep', 'nested', 'path', 'config.yaml');
      const defaultYaml = `name: test`;

      // When: Initialize with defaults
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml });

      // Then: All directories created and file exists
      const content = await fs.readFile(configPath, 'utf-8');
      expect(content).toBe('name: test');
    });
  });

  // Scenario 2: Application upgrade
  describe('Scenario 2: Application Upgrade with New Config Options', () => {
    it('should merge new defaults with existing user config', async () => {
      // Given: User has existing config from v1.0
      const configPath = path.join(tempDir, 'config.yaml');
      const userExistingConfig = `
server:
  port: 8080
  host: 0.0.0.0
database:
  connection:
    host: prod.db.example.com
`;
      await fs.writeFile(configPath, userExistingConfig, 'utf-8');

      // When: App upgrades to v2.0 with new default options
      const newDefaultYaml = `
app:
  name: MyApp
  version: 2.0.0
server:
  port: 3000
  host: localhost
  timeout: 30000
  keepAlive: true
database:
  connection:
    host: localhost
    port: 5432
    database: myapp
    ssl: true
  pool:
    min: 2
    max: 10
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml: newDefaultYaml });

      // Then: User custom values preserved, new defaults merged in
      const config = settings.getValues();

      // User values preserved
      expect(config.server.port).toBe(8080);
      expect(config.server.host).toBe('0.0.0.0');
      expect(config.database.connection.host).toBe('prod.db.example.com');

      // New defaults added
      expect(config.app.version).toBe('2.0.0');
      expect(config.server.timeout).toBe(30000);
      expect(config.server.keepAlive).toBe(true);
      expect(config.database.connection.ssl).toBe(true);
      expect(config.database.pool).toEqual({ min: 2, max: 10 });
    });

    it('should handle array fields during upgrade (arrays are replaced, not merged)', async () => {
      // Given: User customized allowed hosts list
      const configPath = path.join(tempDir, 'config.yaml');
      const userConfig = `
allowedHosts:
  - api.example.com
  - app.example.com
`;
      await fs.writeFile(configPath, userConfig, 'utf-8');

      // When: New version has extended default list
      const newDefaults = `
allowedHosts:
  - localhost
  - 127.0.0.1
logLevel: info
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml: newDefaults });

      // Then: User array completely replaces default array
      const config = settings.getValues();
      expect(config.allowedHosts).toEqual(['api.example.com', 'app.example.com']);
      expect(config.logLevel).toBe('info');
    });
  });

  // Scenario 3: Command line override
  describe('Scenario 3: CLI Arguments Override Config', () => {
    it('should allow --port to override config file value', async () => {
      // Given: Config file specifies port 3000
      const configPath = path.join(tempDir, 'config.yaml');
      await fs.writeFile(configPath, 'server:\n  port: 3000\n  host: localhost', 'utf-8');

      // When: User runs app with --port 8080
      const settings = new Settings(configPath);
      await settings.initialize({
        override: {
          server: {
            port: 8080,
            host: 'localhost',
          },
        },
      });

      // Then: Override takes precedence
      const config = settings.getValues();
      expect(config.server.port).toBe(8080);
      expect(config.server.host).toBe('localhost');

      // And: Original config file unchanged
      const fileContent = await fs.readFile(configPath, 'utf-8');
      expect(fileContent).toContain('port: 3000');
    });

    it('should support multiple CLI overrides at different levels', async () => {
      // Given: Existing config with database settings
      const configPath = path.join(tempDir, 'config.yaml');
      await fs.writeFile(
        configPath,
        `
database:
  connection:
    host: db.example.com
    port: 5432
    database: myapp
    username: appuser
`,
        'utf-8'
      );

      // When: User runs with multiple overrides
      const settings = new Settings(configPath);
      await settings.initialize({
        override: {
          database: {
            connection: {
              host: 'localhost',
              port: 5433,
              database: 'myapp',
              username: 'appuser',
            },
          },
        },
      });

      // Then: All overrides applied, non-overridden values preserved
      const config = settings.getValues();
      expect(config.database.connection.host).toBe('localhost');
      expect(config.database.connection.port).toBe(5433);
      expect(config.database.connection.database).toBe('myapp');
    });

    it('should support --debug flag to enable debug mode temporarily', async () => {
      // Given: Production config without debug
      const configPath = path.join(tempDir, 'config.yaml');
      await fs.writeFile(configPath, 'logLevel: info\ndebug: false', 'utf-8');

      // When: Run with --debug
      const settings = new Settings(configPath);
      await settings.initialize({
        override: {
          logLevel: 'debug',
          debug: true,
        },
      });

      // Then: Debug mode enabled for this session only
      const config = settings.getValues();
      expect(config.logLevel).toBe('debug');
      expect(config.debug).toBe(true);
    });
  });

  // Scenario 4: Multi-environment configuration
  describe('Scenario 4: Multi-Environment Configuration', () => {
    it('should load different configs for dev and prod environments', async () => {
      // Given: Base config shared across environments
      const baseConfigPath = path.join(tempDir, 'config.yaml');
      const baseConfig = `
app:
  name: MyApp
  version: 1.0.0
server:
  port: 3000
`;
      await fs.writeFile(baseConfigPath, baseConfig, 'utf-8');

      // When: Development environment (more verbose logging, local DB)
      const devSettings = new Settings(baseConfigPath);
      await devSettings.initialize({
        defaultYaml: baseConfig,
        override: {
          server: { port: 3000 },
          logLevel: 'debug',
          database: { connection: { host: 'localhost' } },
        },
      });

      // When: Production environment (strict logging, prod DB)
      const prodSettings = new Settings(baseConfigPath);
      await prodSettings.initialize({
        defaultYaml: baseConfig,
        override: {
          server: { port: 3000 },
          logLevel: 'error',
          database: { connection: { host: 'prod.db.example.com' } },
        },
      });

      // Then: Each environment has appropriate config
      const devConfig = devSettings.getValues();
      const prodConfig = prodSettings.getValues();

      expect(devConfig.logLevel).toBe('debug');
      expect(devConfig.database.connection.host).toBe('localhost');

      expect(prodConfig.logLevel).toBe('error');
      expect(prodConfig.database.connection.host).toBe('prod.db.example.com');
    });

    it('should support environment-specific config files with defaults fallback', async () => {
      // Given: Production-specific config file
      const prodConfigPath = path.join(tempDir, 'config.prod.yaml');
      const prodConfig = `
server:
  port: 80
logLevel: warn
`;
      await fs.writeFile(prodConfigPath, prodConfig, 'utf-8');

      // When: Load with defaults for missing values
      const defaultYaml = `
app:
  name: MyApp
server:
  port: 3000
  host: 0.0.0.0
logLevel: info
database:
  connection:
    host: localhost
`;
      const settings = new Settings(prodConfigPath);
      await settings.initialize({ defaultYaml });

      // Then: Merged config with prod overrides + defaults
      const config = settings.getValues();
      expect(config.server.port).toBe(80); // from prod config
      expect(config.server.host).toBe('0.0.0.0'); // from defaults
      expect(config.logLevel).toBe('warn'); // from prod config
      expect(config.database.connection.host).toBe('localhost'); // from defaults
    });
  });

  // Scenario 5: Team collaboration
  describe('Scenario 5: Team Collaboration with Shared Defaults', () => {
    it('should allow team defaults with individual customizations', async () => {
      // Given: Team lead creates shared defaults file
      const teamDefaults = `
# Team shared defaults - DO NOT MODIFY
app:
  name: TeamProject
  team: Platform
server:
  port: 3000
  timeout: 30000
database:
  pool:
    min: 2
    max: 20
`;

      // Alice: Uses team defaults, customizes port
      const aliceConfigPath = path.join(tempDir, 'alice-config.yaml');
      await fs.writeFile(aliceConfigPath, 'server:\n  port: 3001\n', 'utf-8');
      const aliceSettings = new Settings(aliceConfigPath);
      await aliceSettings.initialize({ defaultYaml: teamDefaults });

      // Bob: Uses team defaults, customizes database
      const bobConfigPath = path.join(tempDir, 'bob-config.yaml');
      await fs.writeFile(
        bobConfigPath,
        'database:\n  connection:\n    host: bob-localhost\n',
        'utf-8'
      );
      const bobSettings = new Settings(bobConfigPath);
      await bobSettings.initialize({ defaultYaml: teamDefaults });

      // Then: Each team member has personalized config
      const aliceConfig = aliceSettings.getValues();
      expect(aliceConfig.app.team).toBe('Platform'); // shared
      expect(aliceConfig.server.port).toBe(3001); // personal
      expect(aliceConfig.database.pool.max).toBe(20); // shared

      const bobConfig = bobSettings.getValues();
      expect(bobConfig.app.team).toBe('Platform'); // shared
      expect(bobConfig.server.port).toBe(3000); // shared default
      expect(bobConfig.database.connection.host).toBe('bob-localhost'); // personal
    });

    it('should freeze config to prevent accidental runtime modifications', async () => {
      // Given: Loaded configuration
      const configPath = path.join(tempDir, 'config.yaml');
      await fs.writeFile(configPath, 'port: 3000', 'utf-8');

      const settings = new Settings(configPath);
      await settings.initialize();

      const config = settings.getValues();

      // Then: Config is frozen
      expect(Object.isFrozen(config)).toBe(true);

      // And: Any modification attempt fails
      expect(() => {
        (config as Record<string, unknown>).port = 8080;
      }).toThrow();
    });
  });

  // Scenario 6: Complex real-world scenario
  describe('Scenario 6: Complex Real-World Application Setup', () => {
    it('should handle complete application configuration lifecycle', async () => {
      // Step 1: First install - create default config
      const configPath = path.join(tempDir, '.myapp', 'config.yaml');
      const v1Defaults = `
app:
  name: MyApp
  version: 1.0.0
server:
  port: 3000
  host: localhost
features:
  darkMode: false
  betaFeatures: false
`;
      const settings = new Settings(configPath);
      await settings.initialize({ defaultYaml: v1Defaults });

      let config = settings.getValues();
      expect(config.app.version).toBe('1.0.0');
      expect(config.server.port).toBe(3000);

      // Step 2: User customizes some settings
      const userCustomizations = `
server:
  port: 8080
features:
  darkMode: true
`;
      await fs.writeFile(configPath, userCustomizations, 'utf-8');

      // Step 3: App upgrades to v2.0 with new features
      const v2Defaults = `
app:
  name: MyApp
  version: 2.0.0
server:
  port: 3000
  host: localhost
  timeout: 30000
features:
  darkMode: false
  betaFeatures: false
  newV2Feature: true
plugins:
  - name: core
    enabled: true
`;
      const upgradedSettings = new Settings(configPath);
      await upgradedSettings.initialize({ defaultYaml: v2Defaults });

      config = upgradedSettings.getValues();
      expect(config.app.version).toBe('2.0.0'); // new default
      expect(config.server.port).toBe(8080); // user preserved
      expect(config.server.timeout).toBe(30000); // new default
      expect(config.features.darkMode).toBe(true); // user preserved
      expect(config.features.newV2Feature).toBe(true); // new default

      // Step 4: User runs with debug flag
      const debugSettings = new Settings(configPath);
      await debugSettings.initialize({
        defaultYaml: v2Defaults,
        override: {
          features: { betaFeatures: true },
          logLevel: 'debug',
        },
      });

      config = debugSettings.getValues();
      expect(config.features.betaFeatures).toBe(true); // override
      expect(config.logLevel).toBe('debug'); // override
      expect(config.server.port).toBe(8080); // still preserved

      // Step 5: Verify file still has user customizations only
      const fileContent = await fs.readFile(configPath, 'utf-8');
      expect(fileContent).toContain('port: 8080');
      expect(fileContent).toContain('darkMode: true');
      expect(fileContent).not.toContain('timeout: 30000'); // not written back
    });
  });
});
