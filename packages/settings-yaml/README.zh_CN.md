# @agentskillmania/settings-yaml

[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

一款健壮的 YAML 配置管理库，支持深度合并、默认值回退、运行时覆盖，以及配置的持久化读写。

## 特性

- **深度合并**：递归合并嵌套对象，数组按元素逐项合并
- **默认值回退**：根据默认 YAML 模板自动创建配置文件
- **运行时覆盖**：支持临时覆盖（如命令行参数），优先级最高
- **不可变值**：返回的配置对象已被冻结（frozen）
- **路径支持**：支持绝对路径、相对路径以及 `~` 开头的主目录路径
- **点号路径访问**：通过点分隔的 key 路径读取和修改嵌套值

## 安装

```bash
pnpm add @agentskillmania/settings-yaml
```

## 快速开始

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

## 合并优先级

初始化时，配置按以下优先级合并（从高到低）：

1. 传给 `initialize()` 的 `override` 对象
2. 磁盘上已有的配置文件
3. `defaultYaml` 默认模板

## API 参考

### `constructor(configPath: string)`

创建 `Settings` 实例。支持的路径格式：

- **绝对路径**：`/path/to/config.yaml`
- **相对路径**：`./config.yaml` 或 `config.yaml`
- **主目录**：`~/.config/app/config.yaml`

### `async initialize(options?: InitializeOptions<T>): Promise<void>`

初始化配置：

- 配置文件**不存在**且提供了 `defaultYaml`：使用默认值创建文件
- 配置文件**不存在**且未提供 `defaultYaml`：抛出错误
- 配置文件**已存在**：读取并与 `defaultYaml` 深度合并
- 自动创建中间目录
- `override` 值具有最高优先级

### `getValues(): T`

返回深度合并后的配置对象，该对象已被冻结。

### `has(keyPath: string): boolean`

使用点号表示法检查嵌套 key 是否存在。

```typescript
settings.has('server.port'); // true 或 false
settings.has('database.host'); // true 或 false
```

### `set(keyPath: string, value: unknown): void`

使用点号表示法更新嵌套值。仅修改内存中的配置，需调用 `save()` 持久化。

```typescript
settings.set('server.port', 8080);
settings.set('database.ssl.enabled', true);
```

### `toObject(): Record<string, unknown>`

返回当前配置的可变深拷贝。

### `async save(): Promise<void>`

将内存中的当前配置写回磁盘 YAML 文件。如父目录不存在则自动创建。

```typescript
settings.set('llm.model', 'gpt-4o');
await settings.save();
```

## 示例

### 仅使用默认值

```typescript
await settings.initialize({
  defaultYaml: `server: { port: 3000 }`,
});
```

### 覆盖已有配置

```typescript
await settings.initialize({
  override: { server: { port: 9000 } },
});
```

### 默认值 + 覆盖

```typescript
await settings.initialize({
  defaultYaml: `server: { port: 3000 }`,
  override: { server: { port: 9000 } },
});
// 结果: { server: { port: 9000 } }
```

### 读取并修改

```typescript
await settings.initialize();

if (settings.has('debug')) {
  settings.set('debug', false);
  await settings.save();
}
```

## 开发

```bash
# 构建
pnpm build

# 运行测试
pnpm test

# 覆盖率测试
pnpm test:coverage
```

## License

MIT
