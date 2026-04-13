# @agentskillmania/settings-yaml

[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

A robust configuration management library for loading, merging, and persisting YAML-based settings with deep merge support, default value fallback, and runtime override capabilities.

## Features

- **Deep Merge**: Recursively merges nested objects and arrays element-by-element
- **Default Value Fallback**: Auto-creates config files from a default YAML template
- **Runtime Overrides**: Apply temporary overrides (e.g., CLI arguments) with highest priority
- **Immutable Values**: Returned configuration objects are frozen
- **Path Support**: Accepts absolute paths, relative paths, and `~`-prefixed home directory paths
- **Dot-Notation Access**: Read and update nested values via dot-separated key paths

## Installation

```bash
pnpm add @agentskillmania/settings-yaml
```

## Quick Start

```typescript
import { Settings } from '@agentskillmania/settings-yaml';

const settings = new Settings('/path/to/config.yaml');

await settings.initialize({
  defaultYaml: `
server:
  port: 3000
  host: localhost
`,
});

const config = settings.getValues();
console.log(config.server.port); // 3000
```

## Merge Priority

When initializing, values are merged in the following priority (highest to lowest):

1. `override` object passed to `initialize()`
2. Existing config file on disk
3. `defaultYaml` template

## API Reference

### `constructor(configPath: string)`

Creates a `Settings` instance. Supported path formats:

- **Absolute path**: `/path/to/config.yaml`
- **Relative path**: `./config.yaml` or `config.yaml`
- **Home directory**: `~/.config/app/config.yaml`

### `async initialize(options?: InitializeOptions<T>): Promise<void>`

Initializes the configuration:

- If the config file does **not exist** and `defaultYaml` is provided: creates the file with defaults
- If the config file does **not exist** and no `defaultYaml` is provided: throws an error
- If the config file **exists**: reads and deep-merges it with `defaultYaml`
- Intermediate directories are created automatically
- `override` values take the highest priority

### `getValues(): T`

Returns the merged configuration as a deeply frozen object.

### `has(keyPath: string): boolean`

Checks whether a nested key exists using dot notation.

```typescript
settings.has('server.port'); // true or false
settings.has('database.host'); // true or false
```

### `set(keyPath: string, value: unknown): void`

Updates a nested value using dot notation. Modifies the in-memory config only — call `save()` to persist.

```typescript
settings.set('server.port', 8080);
settings.set('database.ssl.enabled', true);
```

### `toObject(): Record<string, unknown>`

Returns a mutable deep copy of the current configuration.

### `async save(): Promise<void>`

Persists the current in-memory configuration back to the YAML file on disk. Parent directories are created if needed.

```typescript
settings.set('llm.model', 'gpt-4o');
await settings.save();
```

## Examples

### Defaults only

```typescript
await settings.initialize({
  defaultYaml: `server: { port: 3000 }`,
});
```

### Override existing config

```typescript
await settings.initialize({
  override: { server: { port: 9000 } },
});
```

### Defaults + override

```typescript
await settings.initialize({
  defaultYaml: `server: { port: 3000 }`,
  override: { server: { port: 9000 } },
});
// Result: { server: { port: 9000 } }
```

### Read and modify

```typescript
await settings.initialize();

if (settings.has('debug')) {
  settings.set('debug', false);
  await settings.save();
}
```

## Development

```bash
# Build
pnpm build

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage
```

## License

MIT
