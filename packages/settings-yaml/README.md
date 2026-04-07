# @agentskillmania/settings-yaml

[![中文文档](https://img.shields.io/badge/文档-中文-blue.svg)](./README.zh_CN.md)

YAML configuration file reader with default values and deep merge support.

## Installation

```bash
pnpm add @agentskillmania/settings-yaml
```

## Usage

```typescript
import { Settings } from "@agentskillmania/settings-yaml";

const settings = new Settings("/path/to/config.yaml");

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

## API

### `constructor(configPath: string)`

Creates a Settings instance. Supports the following path formats:
- Absolute path: `/path/to/config.yaml`
- Relative path: `./config.yaml` or `config.yaml`
- Home directory: `~/.config/app/config.yaml`

### `async initialize(options?: InitializeOptions<T>): Promise<void>`

Initializes the configuration:

- Config file does not exist + has defaultYaml: Creates file with default values
- Config file does not exist + no defaultYaml: Throws error
- Config file exists: Reads and deep merges with defaults
- Intermediate directories don't exist: Creates them recursively
- `override` parameter for temporary config overrides (e.g., CLI arguments)

**Merge priority:** override > config file > defaultYaml

### `getValues(): T`

Returns the configuration values as a frozen object.

## Examples

```typescript
// Only defaults
await settings.initialize({
  defaultYaml: `server: { port: 3000 }`,
});

// Only override (when config file exists)
await settings.initialize({
  override: { server: { port: 9000 } },
});

// Both defaults and override
await settings.initialize({
  defaultYaml: `server: { port: 3000 }`,
  override: { server: { port: 9000 } },
});

// Neither (read config file only)
await settings.initialize();
```

## Development

```bash
# Build
pnpm build

# Test
pnpm test

# Test coverage
pnpm test:coverage
```

## License

MIT
