# @agentskillmania/settings-yaml

[![npm version](https://img.shields.io/npm/v/@agentskillmania/settings-yaml.svg)](https://www.npmjs.com/package/@agentskillmania/settings-yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

YAML 配置管理库。深度合并、默认值回退、运行时覆盖。一行初始化，点号路径读写，按需持久化。

## 特色

- **深度合并** — 递归合并嵌套对象，数组按元素逐项合并
- **默认值回退** — 根据默认 YAML 模板自动创建配置文件
- **运行时覆盖** — 支持临时覆盖（如命令行参数），优先级最高
- **不可变值** — 返回的配置对象已被冻结
- **点号路径访问** — 通过 `server.port` 风格的路径读写嵌套值

## 安装

```bash
pnpm add @agentskillmania/settings-yaml
```

## 快速开始

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

## 合并优先级

配置按以下优先级合并（从高到低）：

1. 传给 `initialize()` 的 `override` 对象
2. 磁盘上已有的配置文件
3. `defaultYaml` 默认模板

## API 参考

### `constructor(configPath: string)`

创建 `Settings` 实例。支持绝对路径、相对路径和 `~/` 主目录路径。

### `async initialize(options?): Promise<void>`

- 配置文件**不存在**且提供了 `defaultYaml`：使用默认值创建文件
- 配置文件**不存在**且未提供 `defaultYaml`：抛出错误
- 配置文件**已存在**：读取并与 `defaultYaml` 深度合并
- `override` 值具有最高优先级
- 自动创建中间目录

### `getValues(): T`

返回深度合并后的配置对象，已被冻结。

### `has(keyPath: string): boolean`

使用点号路径检查嵌套 key 是否存在。

```typescript
settings.has('server.port'); // true
```

### `set(keyPath: string, value: unknown): void`

更新内存中的嵌套值。需调用 `save()` 持久化。

```typescript
settings.set('server.port', 8080);
```

### `toObject(): Record<string, unknown>`

返回当前配置的可变深拷贝。

### `async save(): Promise<void>`

将内存中的配置写回磁盘。

```typescript
settings.set('llm.model', 'gpt-4o');
await settings.save();
```

## 示例

```typescript
// 默认值 + 运行时覆盖
await settings.initialize({
  defaultYaml: `server: { port: 3000 }`,
  override: { server: { port: 9000 } },
});
// 结果: { server: { port: 9000 } }

// 读取并修改
await settings.initialize();
if (settings.has('debug')) {
  settings.set('debug', false);
  await settings.save();
}
```

## License

MIT
