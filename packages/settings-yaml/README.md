# @agentskillmania/settings-yaml

[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

YAML configuration management with deep merge, default value fallback, and runtime overrides. Initialize in one line, read with dot notation, persist on demand.

## Highlights

- **Deep Merge** — Recursively merges nested objects and arrays element-by-element
- **Default Value Fallback** — Auto-creates config files from a default YAML template
- **Runtime Overrides** — Apply temporary overrides (e.g., CLI arguments) with highest priority
- **Immutable Values** — Returned configuration objects are frozen
- **Dot-Notation Access** — Read and update nested values via `server.port` style paths

## Installation

```bash
pnpm add @agentskillmania/settings-yaml
```

## Quick Start

```typescript
import { Settings } from '@agentskillmania/settings-yaml';

const settings = new Settings('~/.config/myapp/config.yaml');

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

Values are merged in the following priority (highest to lowest):

1. `override` object passed to `initialize()`
2. Existing config file on disk
3. `defaultYaml` template

## API Reference

### `constructor(configPath: string)`

Creates a `Settings` instance. Supports absolute paths, relative paths, and `~/` home directory paths.

### `async initialize(options?): Promise<void>`

- Config file does **not exist** + `defaultYaml` provided: creates the file with defaults
- Config file does **not exist** + no `defaultYaml`: throws an error
- Config file **exists**: reads and deep-merges with `defaultYaml`
- `override` values take highest priority
- Intermediate directories are created automatically

### `getValues(): T`

Returns the merged configuration as a deeply frozen object.

### `has(keyPath: string): boolean`

Checks whether a nested key exists using dot notation.

```typescript
settings.has('server.port'); // true
```

### `set(keyPath: string, value: unknown): void`

Updates a nested value in memory. Call `save()` to persist.

```typescript
settings.set('server.port', 8080);
```

### `toObject(): Record<string, unknown>`

Returns a mutable deep copy of the current configuration.

### `async save(): Promise<void>`

Persists the current in-memory configuration to disk.

```typescript
settings.set('llm.model', 'gpt-4o');
await settings.save();
```

## Examples

```typescript
// Defaults + runtime override
await settings.initialize({
  defaultYaml: `server: { port: 3000 }`,
  override: { server: { port: 9000 } },
});
// Result: { server: { port: 9000 } }

// Read and modify
await settings.initialize();
if (settings.has('debug')) {
  settings.set('debug', false);
  await settings.save();
}
```

## License

MIT
