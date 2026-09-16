# Changelog

本仓三包（`@agentskillmania/colts`、`@agentskillmania/llm-client`、
`@agentskillmania/settings-yaml`）同版本号发布，变更按版本一节记录。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。0.x 期不承诺
minor 无破坏——预发布走 alpha 通道（`npm publish --tag alpha`，`latest` 不动），
下游开发期精确锁版本（无 `^`）。

> 本文件自 `0.5.0-alpha.1` 起维护；0.4.0 及更早未建 CHANGELOG，变更见 git 历史。

## [0.5.0-alpha.1] — 2026-09-16

内核回填第一批：把 Rust `crates/colts` 8/11 之后的内核演进回填到 TS 仓
（R2P-101~108、114、131、134），并建立跨仓契约快照。条目对应 `daa0563..HEAD`。

**契约快照**：`agentskillmania/契约快照/`（跨仓共享，两仓测试引用同一份）——
`events.json`（事件名/字段集 + emitter↔yield 差异）、`state-schema.json`
（存档形状与真实产出的序列化样例）、`tool-names.json`（工具名集合）。
生成脚本 `scripts/export-contracts.mjs`（可复跑，`--check` 只比对不写；
改了契约先改 fixtures 再动实现）。

### ⚠️ 破坏性变更

1. **`HitlMiddlewareOptions.askHumanToolName` 移除**（R2P-108）。
   HITL 不再按工具名隐式拦截 `ask_human`——挂起改由工具自身发出类型化信号
   （`AskSuspendSignal`，经 `ToolSuspensionError` 跨 registry 边界），中间件
   只保留 `confirmTools` 的 tool-confirm 拦截。传该选项的调用点删除该字段即可。
2. **`AskHumanHandler` 返回类型扩宽**（R2P-108，**向后兼容的超集**，此处列出是
   因为它是公共签名变化）。`Promise<HumanResponse>` → `Promise<AskOutcome>`
   （`= HumanResponse | AskSuspendSignal`）。旧的阻塞式 handler（返回纯 answers
   映射）无需改动；只有要挂起的宿主才返回 `{ type: 'suspend', questions }`。
3. **waiting-human 变体新增必填 `requests` 字段**（R2P-108，构造方注意）。
   `Phase` / `StepResult` / `RunResult` 的 `waiting-human` 变体都带上了
   `requests: HumanRequest[]`（本轮全部挂起请求，并行双问用），
   `request === requests[0]` 保持单问消费方兼容。**读取方兼容**（多一个字段）；
   **自己构造这三个类型的地方（宿主中间件/测试桩）必须补 `requests`**，否则类型不过。
4. **`respond()` 对已知类型的请求/应答不匹配从静默 no-op 改为抛错**（R2P-108）。
   用 `HumanResponse` 回答不同类型的 `HumanRequest`（如拿 tool-confirm 批准去答
   question）以前静默返回原 state，现在抛 `Error`——那种配对会把应答挂到错误的
   `toolCallId` 上，续跑时 provider 返回 400，静默失败比抛错更难查。
   传参正确的调用方不受影响；未知 `response.type` 仍是容忍的 no-op。
5. **净零项（非对外变化，列出以免考古）**：`CompressResult.coveredMessages` 曾在
   `e65555d` 加入、`f7c279a` 移除——**净零，不是破坏性变更**；`compressed`
   **事件**载荷的 `coveredMessages` 保留（见下）。

### 新增

- **包入口导出引擎默认值**（Task 9 评审 P3）：`DEFAULT_REQUEST_TIMEOUT_MS`、
  `DEFAULT_RUNNER_MAX_STEPS`、`RUN_HARD_LIMIT` 从 `@agentskillmania/colts` 主入口
  导出（此前只在 `runner` 子模块可取），宿主可直接引用"真源"而非自写字面量
  （Rust `lib.rs:70-73` 同位）。
- **`compressed` 事件载荷新增 `coveredMessages`**（R2P-104）：本轮新覆盖的消息条数
  （anchor 增量，饱和到 0），把 `removedCount` 的单位歧义（自动压缩=token 数、
  `/compact`=消息数，历史遗留）与时间线标记解耦。
- **压缩/换模型标记行进历史**（R2P-105）：新增 `addSystemMessage`
  （`role: 'system'`、无 `type`、内容为紧凑 JSON 的标记行）——压缩落
  `{"kind":"compact","coveredMessages",...}`、换模型落
  `{"kind":"model-switch","from","to"}`；多次压缩各留一行（不再受单槽 meta 覆盖
  限制），resume 后可还原时间线。标记行不经装配器进入对话请求（活区标记仍可能
  进 summarize 输入，与 Rust 一致）。
- **`Message.usage`（`TurnUsage`）每轮用量落账**（R2P-106）：run 结束时把本轮的
  input/output/cacheRead/cacheWrite 与整轮耗时写到该轮末条 assistant 消息，前端
  `fromHistory` 据此还原每轮时长与 token；waiting-human 结束与全零用量不落账
  （缺省即"无"）。
- **`context.pendingInterrupts`（`PendingInterrupt[]`）未答请求终态落盘**（R2P-108）：
  等待人类输入的请求成为跨 run 存活的一等数据，轮切换/重启不丢；配套
  `upsertPendingInterrupt` / `removePendingInterrupt` 两个纯函数（旧档无字段天然兼容）。
- **`MessageType` 增 `'system-reminder'` + `addSystemReminder`**（R2P-101b，legacy
  兼容）：旧 daemon 逐轮落的时间上下文行类型与写者保留，纯为旧档反序列化与
  逐字节回放（当前 daemon 不再写；时间由 wrangler 侧组装器现算）。
- **`MessageType` 增 `'skill-directive'`**（R2P-114）：`load_skill` 成功后引擎注入的
  user 角色驱动指令带此标记（wire 名 kebab），装配仍按 role 当普通 user 消息发送
  （模型侧零变化），前端历史重建据此跳过气泡渲染、不切助手回合。
- **`load_skill` 清单随下发**（R2P-114）：结果里带上技能 `resources`/`scripts`
  相对路径清单（`--- bundled files (use these exact paths with …) ---` 后缀），
  模型加载那一刻即拿到确切路径；两条下发面（工具消息 + `tool:end` 事件）同形，
  空清单不附后缀（旧信号字节不变）。
- **llm-client：input 模态声明 + `LLMClientValidationError`**（R2P-131）：多模态
  请求在模型未声明图像输入能力时抛具名错误类（可区分"能力未声明（配置错）"与
  真 provider 400）；新增多模态集成测试（真 API，`_MULTIMODEL` 系列未配时跳过）。

### 变更

- **压缩规则对齐 Rust**（R2P-102/103）：anchor 只落在用户消息上（逐段回退到最近的
  `user`，天然闭合成对关系；无安全边界则本轮放弃压缩、保留旧 summary 与全部上下文）；
  `load_skill` 结果钉扎 anchor 上界；窗口触发阈值 80% → **90%**（具名常量
  `WINDOW_TRIGGER_RATIO`）；`CompressionConfig.threshold` 默认 50 → **120**，
  `keepRecent` 保持 10。
- **工具清单确定性排序**（R2P-101a）：`IToolRegistry` 的 `toToolSchemas` /
  `getToolNames` 一律按工具名 UTF-16 code unit 排序（新增 `utils/compare.ts` 的
  `compareByCodeUnit`，不用 `localeCompare`）——wire `tools` 数组是 provider 前缀
  缓存的最前端，顺序抖动会整段废掉缓存。
- **技能清单确定性排序**（R2P-101b）：`FilesystemSkillProvider.listSkills()` 按名排序
  （对齐 Rust `BTreeMap`），跨文件系统 readdir 顺序免疫。
- **`MessageRole` / 装配器边界表述收敛**（R2P-101b、R2P-105 返修）：
  `role: 'system'` 分标记行（无 `type`，LLM 不可见）与 `system-reminder` 行（legacy
  回放，wrangler 侧组装器合并进前置 user 消息的 `<system-reminder>` 尾巴）两类；
  colts 默认组装器对两类 system 行一律跳过。
- **llm-client 多模态拒绝路径类型化**（R2P-131）：错误消息与 retry 语义对齐 Rust
  `AdapterError::Validation`，并明确 pi-ai 注册表放行处的有意宽松（deliberate divergence）。

### 修复

- **summarize 输入双重切片**（`d67db71`，评审 P1）：再压缩时
  `[existingAnchor, 2*existingAnchor)` 段消息被外层多余 `.slice()` 切掉、永远进不了
  摘要 prompt（Rust 无第二次切片，系移植引入）。
- **压缩放弃/冻结路径零 LLM 成本**（R2P-102 返修）：锚点判定挪到 summarize 之前，
  放弃/no-op 轮不再先付费再丢结果；早退透传存量 `summaryTokenCount`/`compressedAt`
  （防止 `compressState` 覆写清掉导致窗口估算欠触发）。
- **no-op 轮标记行零值守卫**（R2P-105 返修）：`delta = max(0, anchor - prevAnchor)` 为 0
  时 `removedTokens`/`summaryTokens` 一并归零，消除"覆盖 0 条却带 42 token 摘要"的
  自相矛盾标记（前端幻影行）。
- **usage 落账下界守卫**（R2P-106 返修）：`stampTurnUsage` 只允许本轮（`minIndex` 起）
  的 assistant 行接收落账，避免首调失败/早停的终局覆写上一轮的用量记载。
- **HITL 混合批次安全 + 全部挂起浮出**（R2P-108 返修，2×P1）：suspend 与 ok/fail 兄弟
  同批时，ok 结果照常写 tool 消息（副作用已发生必须记录）+ 步数递增，挂起的写
  `pendingInterrupts`（问题尚无答案）——修掉悬挂 toolCall 导致的 resume 400；双问
  全部浮出（`requests`），并加 `run()` 起点的悬挂 toolCall 诊断守卫（可诊断错误而非
  上游 400）。
- **`respond()` 请求/应答类型守卫**（R2P-108，即破坏性变更 4 的正面描述）。
- **llm-client 多模态 fixture 与真跑**（R2P-131 返修）：fixture 经解码验证有效、真 API
  接受（此前"fixture 损坏"的报告已被逐字节证伪并更正）；`12-thinking-mechanism`
  三例加有界重试，隔离上游配额耗尽（glm-5 返回 1308 + content null）造成的假红。

### 门禁

- `scripts/gate.sh` 加固：skip 计数只锚定 vitest `Tests` 汇总行（兼容 pnpm 前缀与
  裸跑两种日志形态），修掉文件行与汇总行双重计数把已知 2 个 skip 数成 4 的假绿；
  `case` 分支内 `set -e` 对 AND-list 失效的陷阱改为逐行显式退出。
- 已知豁免 skip（上限 3）：llm-client `03-multi-key-switching` 的 2 例（未配
  `apiKey2`）+ `08-multimodal` 的 1 例（未配 `_MULTIMODEL` 系列）——可选能力，
  配置后自动启用，超出上限即门禁失败。
