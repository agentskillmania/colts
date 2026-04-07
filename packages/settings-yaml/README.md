# @agentskillmania/settings-yaml

YAML 配置文件读取模块，支持默认值和深度合并。

## 使用

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

创建 Settings 实例。支持以下路径格式：
- 绝对路径：`/path/to/config.yaml`
- 相对路径：`./config.yaml` 或 `config.yaml`
- 用户目录：`~/.config/app/config.yaml`

### `async initialize(options?: InitializeOptions<T>): Promise<void>`

初始化配置：

- 配置文件不存在 + 有 defaultYaml：创建文件并写入默认值
- 配置文件不存在 + 无 defaultYaml：抛出错误
- 配置文件存在：读取并与默认值深度合并
- 中间目录不存在：递归创建
- `override` 参数用于临时覆盖配置（如命令行参数）

**合并优先级：** override > 配置文件 > defaultYaml

### `getValues(): T`

获取配置值，返回冻结的对象。

## 使用示例

```typescript
// 只有默认值
await settings.initialize({
  defaultYaml: `server: { port: 3000 }`,
});

// 只有 override（配置文件存在时）
await settings.initialize({
  override: { server: { port: 9000 } },
});

// 两者都有
await settings.initialize({
  defaultYaml: `server: { port: 3000 }`,
  override: { server: { port: 9000 } },
});

// 都没有（只读取配置文件）
await settings.initialize();
```

## 开发

```bash
# 构建
pnpm build

# 测试
pnpm test

# 测试覆盖率
pnpm test:coverage
```

## License

MIT
