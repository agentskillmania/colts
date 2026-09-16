#!/usr/bin/env node
/**
 * @fileoverview 契约快照导出（spec D5 细则②）——跨仓共享 fixtures 的单一生成源。
 *
 * 用法（在 colts 仓根执行）：
 *
 *   node scripts/export-contracts.mjs                 # 写到 ../契约快照/（默认）
 *   node scripts/export-contracts.mjs --out <dir>     # 自定义输出目录
 *   node scripts/export-contracts.mjs --wrangler <dir> # 自定义 wrangler 仓根（外仓扫描源）
 *   node scripts/export-contracts.mjs --check         # 只生成到内存并与磁盘比对，不写文件（CI/门禁用）
 *
 * 产出三类 JSON（同一份被 colts 与 wrangler 两仓测试引用；改契约先改 fixtures 再改实现）：
 *
 *   events.json        RunnerEventMap 事件名 + 每事件字段集/字段类型（TS AST 提取），
 *                      并旁挂 StreamEvent/RunStreamEvent 的 yield 事件名与
 *                      emitter↔yield 字段差异（防两端线协议漂移）。
 *   state-schema.json  state.json 存档形状：由真实 createAgentState + add* 调用
 *                      （+ 压缩器/落账/中断等真实生产者）产出的序列化样例，
 *                      并按行类型导出字段集；id/timestamp 归一化为稳定占位值。
 *   tool-names.json    工具名集合：colts 内置工具（运行时读工具对象的 name）+
 *                      wrangler `createCoreTools` 与各可选工具的注册名（外仓 AST 扫描，
 *                      目录缺失时该节 available:false）。
 *
 * 设计约束（勿破坏）：
 * - **不手抄**：所有内容都由源码/运行时派生（AST 或真实调用），脚本可复跑；
 *   凡有外部输入的地方（如 summarize 的 LLM 响应）在 notes 里显式标注为桩。
 * - events/state 用 `scripts/lib/ts-source-loader.mjs` 直接 import **当前源码**
 *   （不读 dist —— dist 可能过期，fixtures 必须锚在评审的那份代码上）。
 * - 缺目录/解析不到的东西写成显式缺失（available:false / unresolved），不猜、不造。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url)); // colts/scripts
const REPO = resolve(HERE, '..'); // colts
const COLTS_SRC = join(REPO, 'packages/colts/src');

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    out: resolve(REPO, '..', '契约快照'),
    wrangler: resolve(REPO, '..', 'wrangler', 'packages', 'wrangler'),
    check: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = resolve(argv[++i]);
    else if (a === '--wrangler') opts.wrangler = resolve(argv[++i]);
    else if (a === '--check') opts.check = true;
    else if (a === '-h' || a === '--help') {
      console.log(
        '用法: node scripts/export-contracts.mjs [--out <dir>] [--wrangler <dir>] [--check]'
      );
      process.exit(0);
    } else {
      console.error(`未知参数: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

const OPTS = parseArgs(process.argv.slice(2));
const VIOLET_VERSION = readJson(join(REPO, 'packages/colts/package.json')).version;
const GENERATED_AT = new Date().toISOString();

/** 所有 fixtures 共用的溯源头（键顺序固定，便于 diff）。 */
function header(source) {
  return {
    version: VIOLET_VERSION,
    package: '@agentskillmania/colts',
    generatedBy: 'colts/scripts/export-contracts.mjs',
    generatedAt: GENERATED_AT,
    source,
  };
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeFixture(name, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const target = join(OPTS.out, name);
  if (OPTS.check) {
    const existing = existsSync(target) ? readFileSync(target, 'utf8') : null;
    // --check 忽略 generatedAt（时间戳必然不同），只比内容
    const strip = (s) => (s === null ? null : s.replace(/"generatedAt": "[^"]*",\n/, ''));
    const [a, b] = [strip(text), strip(existing)];
    const same = a === b;
    console.log(`${same ? 'OK  ' : 'DIFF'} ${name}${same ? '' : '（与磁盘不一致）'}`);
    return same;
  }
  mkdirSync(OPTS.out, { recursive: true });
  writeFileSync(target, text);
  console.log(`wrote ${relative(REPO, target)} (${text.length} bytes)`);
  return true;
}

/** 排序：按 UTF-16 code unit（与 colts 的 compareByCodeUnit 契约一致，勿用 localeCompare）。 */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ── events.json ────────────────────────────────────────────────────────────

/** 从 source text 建 AST（脚本内多处复用）。 */
function parseSource(file) {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS
  );
}

/** 取成员的 JSDoc 首段注释（压平空白、截断），无注释返回 undefined。 */
function docOf(node, sf) {
  const docs = ts.getJSDocCommentsAndTags(node).filter((d) => ts.isJSDoc(d));
  const raw = docs
    .map((d) => (typeof d.comment === 'string' ? d.comment : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return raw ? raw.slice(0, 240) : undefined;
}

/**
 * 展开一个类型节点的属性签名 → { fields, fieldTypes, optionalFields, payloadTypeRef }。
 *
 * 跳过的键：timestamp（全事件通用，见 note）；yield 侧的 type（判别式=事件名本身）。
 */
function describePayload(typeNode, sf, skip = []) {
  const empty = { fields: [], fieldTypes: {}, payloadTypeRef: null };
  if (!typeNode) return empty;
  if (!ts.isTypeLiteralNode(typeNode)) {
    // 命名类型（如某个 payload 别名）：不展开，只记类型名——见事件 note。
    return { ...empty, payloadTypeRef: typeNode.getText(sf) };
  }
  const fields = [];
  const fieldTypes = {};
  const optionalFields = [];
  for (const m of typeNode.members) {
    if (!ts.isPropertySignature(m) || !m.name) continue;
    const name = m.name.getText(sf).replace(/^['"]|['"]$/g, '');
    if (name === 'timestamp' || skip.includes(name)) continue;
    fields.push(name);
    fieldTypes[name] = m.type ? m.type.getText(sf) : 'unknown';
    if (m.questionToken) optionalFields.push(name);
  }
  return {
    fields,
    fieldTypes,
    ...(optionalFields.length ? { optionalFields } : {}),
    payloadTypeRef: null,
  };
}

/** 从 RunnerEventMap interface 提取事件 → Map<name, entry>。 */
function extractEmitterEvents() {
  const file = join(COLTS_SRC, 'runner/index.ts');
  const sf = parseSource(file);
  let iface = null;
  sf.forEachChild((n) => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === 'RunnerEventMap') iface = n;
  });
  if (!iface) throw new Error('runner/index.ts 未找到 interface RunnerEventMap');
  const events = new Map();
  for (const m of iface.members) {
    if (!ts.isPropertySignature(m) || !m.name) continue;
    const name = m.name.getText(sf).replace(/^['"]|['"]$/g, '');
    const payload = describePayload(m.type, sf);
    const entry = { emitter: true, yield: false, ...payload };
    const doc = docOf(m, sf);
    if (doc) entry.doc = doc;
    events.set(name, entry);
  }
  return events;
}

/** 从 StreamEvent / RunStreamEvent 联合提取 yield 事件（成员里 type 字面量即事件名）。 */
function extractYieldEvents() {
  const file = join(COLTS_SRC, 'execution/index.ts');
  const sf = parseSource(file);
  const aliases = { StreamEvent: [], RunStreamEvent: [] };
  sf.forEachChild((n) => {
    if (!ts.isTypeAliasDeclaration(n) || !aliases[n.name.text]) return;
    for (const m of n.type.types ?? []) {
      if (!ts.isTypeLiteralNode(m)) continue;
      const typeProp = m.members.find(
        (p) => ts.isPropertySignature(p) && p.name?.getText(sf) === 'type'
      );
      if (!typeProp?.type || !ts.isLiteralTypeNode(typeProp.type)) continue;
      const lit = typeProp.type.literal;
      if (!ts.isStringLiteral(lit)) continue;
      aliases[n.name.text].push({ name: lit.text, node: m });
    }
  });
  const events = new Map();
  for (const [alias, members] of Object.entries(aliases)) {
    for (const { name, node } of members) {
      const payload = describePayload(node, sf, ['type']);
      const existing = events.get(name);
      if (existing) {
        // RunStreamEvent 同时含 StreamEvent 整体与自身成员——合并，冲突即报错
        if (JSON.stringify(existing.fields) !== JSON.stringify(payload.fields)) {
          throw new Error(`yield 事件 ${name} 在两处声明字段不一致（StreamEvent vs ${alias}）`);
        }
        existing.aliases.push(alias);
      } else {
        events.set(name, { aliases: [alias], ...payload });
      }
    }
  }
  return events;
}

function buildEventsFixture() {
  const emitter = extractEmitterEvents();
  const yieldEvents = extractYieldEvents();

  const names = [...new Set([...emitter.keys(), ...yieldEvents.keys()])].sort(byCodeUnit);
  const events = {};
  for (const name of names) {
    const e = emitter.get(name);
    const y = yieldEvents.get(name);
    // fields/fieldTypes 以 emitter 的 RunnerEventMap 声明为准（事件契约主表）；
    // 只在 yield 侧存在的事件（waiting-human）以 yield 为准。fieldsSource 明示来源。
    const base = e ?? y;
    const entry = {
      channels: [e ? 'emitter' : null, y ? 'yield' : null].filter(Boolean),
      emitterOnly: Boolean(e && !y),
      yieldOnly: Boolean(y && !e),
      fieldsSource: e ? 'emitter' : 'yield',
      fields: base.fields,
      fieldTypes: base.fieldTypes,
    };
    if (base.optionalFields) entry.optionalFields = base.optionalFields;
    if (base.doc) entry.doc = base.doc;
    if (base.payloadTypeRef) entry.payloadTypeRef = base.payloadTypeRef;
    if (y) {
      entry.yieldFields = y.fields;
      entry.yieldAliases = y.aliases;
      if (y.payloadTypeRef) entry.yieldPayloadTypeRef = y.payloadTypeRef;
    }
    events[name] = entry;
  }

  // emitter↔yield 字段差异：同名事件两侧字段集/字段类型不一致即线协议漂移信号
  // （本次已知：llm:request 多 model/contextWindow；skill:start 的 state 可选性不同）。
  const divergences = [];
  for (const name of names) {
    const e = emitter.get(name);
    const y = yieldEvents.get(name);
    if (!e || !y) continue;
    const only = (a, b) => a.filter((f) => !b.includes(f));
    const emitterOnly = only(e.fields, y.fields);
    const yieldOnly = only(y.fields, e.fields);
    const describe = (side, f) =>
      `${side.fieldTypes[f] ?? 'unknown'}${side.optionalFields?.includes(f) ? ' | undefined（可选）' : ''}`;
    const typeMismatches = e.fields
      .filter((f) => y.fields.includes(f))
      .filter((f) => describe(e, f) !== describe(y, f))
      .map((f) => ({ field: f, emitter: describe(e, f), yield: describe(y, f) }));
    if (emitterOnly.length || yieldOnly.length || typeMismatches.length) {
      divergences.push({ event: name, emitterOnly, yieldOnly, typeMismatches });
    }
  }

  return {
    ...header({
      emitterEvents: 'packages/colts/src/runner/index.ts#RunnerEventMap',
      yieldEvents: 'packages/colts/src/execution/index.ts#StreamEvent|RunStreamEvent',
    }),
    notes: [
      '所有事件载荷均带 timestamp:number（yield 侧 step:start/… 同）——fields/fieldTypes 只列事件特有字段，timestamp 与 yield 侧的判别式 type 一律略去。',
      'fields 是事件载荷的属性名集合（取 fieldsSource 那一侧的声明：emitter=RunnerEventMap 主表；仅 yield 侧存在的事件取 yield）；fieldTypes 是各字段的 TS 类型文本（AST 原文，未展开）；命名类型（AgentState/RunResult/Phase/Action/HumanRequest…）只出现类型名，不内联展开——展开请查 state-schema.json 或源码。',
      'emitterOnly:true 表示该事件只在 EventEmitter 侧声明（无 yield/SSE 对应物：生命周期事件与部分过程事件，如 abort/todo:list）；yieldOnly:true 反之。名单直接读各事件的 channels/emitterOnly/yieldOnly，本 note 不逐一列举（免随实现漂移）。',
      'divergences 列出两侧都有的事件在 emitter 与 yield 上的差异：emitterOnly/yieldOnly 是字段集差、typeMismatches 是同名字段的类型或可选性差——任一项非空即线协议需显式对齐（消费方按 yield/SSE 为准；llm:request 的 model/contextWindow 是已知差异）。',
      'eventNames 是全部事件名的稳定排序（UTF-16 code unit），供两仓快照测试直接比对。',
    ],
    eventNames: names,
    events,
    divergences,
  };
}

// ── state-schema.json ──────────────────────────────────────────────────────

/** 归一化：UUID → 稳定占位 UUID；非 UUID 的 id → 保形占位；时间戳 → 固定基准 + 序号（fixtures 必须可 diff）。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_KEYS = new Set(['timestamp', 'createdAt', 'updatedAt', 'compressedAt']);
const TIME_BASE = 1_700_000_000_000;

/**
 * 状态 id 由 generateId() 产出（`${Date.now()}-${Math.random().toString(36).substr(2, 9)}`）。
 *
 * 随机尾串无法复现，保形替换也会逐次漂移（随机字符落位不同）——固定成
 * generateId 的形状占位（13 位毫秒 + '-' + 9 位 36 进制随机）。documented
 * shape 的来源是 utils/id.ts；形状若变，本常量与 note 一并更新。
 */
const STATE_ID_PLACEHOLDER = '0000000000000-xxxxxxxxx';

function normalizeSample(value) {
  const ids = new Map();
  let clock = 0;
  const walk = (node, key) => {
    if (Array.isArray(node)) return node.map((v) => walk(v, key));
    if (node && typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v, k);
      return out;
    }
    if (typeof node === 'string' && UUID_RE.test(node)) {
      if (!ids.has(node)) {
        const n = String(ids.size + 1).padStart(12, '0');
        ids.set(node, `00000000-0000-4000-8000-${n}`);
      }
      return ids.get(node);
    }
    if (typeof node === 'string' && key === 'id') return STATE_ID_PLACEHOLDER;
    if (typeof node === 'number' && TIME_KEYS.has(key)) {
      clock += 1000;
      return TIME_BASE + clock;
    }
    return node;
  };
  return walk(value, null);
}

/** 从归一化样例里按行类型收集字段集（顺序 = 首次出现顺序，读取方按集合看待）。 */
function collectRowShapes(sample) {
  const shapes = new Map();
  for (const m of sample.context.messages) {
    const key = `${m.role}/${m.type ?? '(none)'}`;
    const fields = shapes.get(key) ?? [];
    for (const f of Object.keys(m)) if (!fields.includes(f)) fields.push(f);
    shapes.set(key, fields);
  }
  return Object.fromEntries([...shapes.entries()].sort((a, b) => byCodeUnit(a[0], b[0])));
}

/** 对象字面量的键集（含 undefined 值的可选字段——样例里显式写出才有意义）。 */
const keysOf = (o) => Object.keys(o ?? {});

async function buildStateFixture() {
  // 直接 import 源码（loader 把 ./x.js 指到 x.ts）
  const state = await import(pathToFileURL(join(COLTS_SRC, 'state/index.ts')).href);
  const hitl = await import(pathToFileURL(join(COLTS_SRC, 'hitl/interrupts.ts')).href);
  const compression = await import(pathToFileURL(join(COLTS_SRC, 'runner/compression.ts')).href);
  const compressorMod = await import(pathToFileURL(join(COLTS_SRC, 'compressor/index.ts')).href);
  const runner = await import(pathToFileURL(join(COLTS_SRC, 'runner/index.ts')).href);

  const {
    createAgentState,
    addUserMessage,
    addAssistantMessage,
    addToolMessage,
    addSystemMessage,
    addSystemReminder,
    updateState,
    updateTotalTokens,
    incrementStepCount,
    setLastToolResult,
    loadSkill,
  } = state;

  const tcid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  let s = createAgentState({
    name: 'contract-sample',
    instructions: 'You are the contract-snapshot sample agent.',
    tools: [{ name: 'calculate', description: 'Evaluate an arithmetic expression.' }],
  });

  // ① 普通对话 + thought/action/text 三类 assistant 行 + tool-result 行
  s = addUserMessage(s, 'Add a retry to the fetch helper.');
  s = addAssistantMessage(s, 'The helper is in src/fetch.ts; retry belongs at the call site.', {
    type: 'thought',
  });
  s = addAssistantMessage(s, 'Reading the file first.', {
    type: 'action',
    toolCalls: [{ id: tcid(1), name: 'file_read', arguments: { path: 'src/fetch.ts' } }],
  });
  s = addToolMessage(s, 'export function fetchOnce() {}', {
    toolCallId: tcid(1),
    toolName: 'file_read',
  });
  s = addAssistantMessage(s, 'Retry added around fetchOnce().');
  s = addToolMessage(s, 'command not found: curl', {
    toolCallId: tcid(2),
    toolName: 'shell',
    isError: true,
  });

  // ② 第二轮：用户消息（作为压缩 anchor）+ 技能族行
  s = addUserMessage(s, 'Now make the timeout configurable.');
  s = addAssistantMessage(s, 'Loading the demo skill for its workflow.', {
    type: 'action',
    toolCalls: [{ id: tcid(3), name: 'load_skill', arguments: { name: 'demo' } }],
  });
  s = addToolMessage(s, '{"resources":["scripts/run.sh"]}', {
    toolCallId: tcid(3),
    toolName: 'load_skill',
  });
  // skill-directive 行是 role=user 的驱动指令（executing-tool-handler.ts 在 load_skill
  // 成功后注入并打标）——引擎里没有 add 系 API，故用 addUserMessage + 打标复刻同一步。
  s = addUserMessage(s, 'Follow the demo skill workflow.');
  s = updateState(s, (draft) => {
    draft.context.messages[draft.context.messages.length - 1].type = 'skill-directive';
  });
  s = addAssistantMessage(s, 'Timeout is now a parameter with a 30s default.');
  s = addUserMessage(s, 'Anything else?');
  s = addAssistantMessage(s, 'No — retry and timeout are both configurable now.');
  s = incrementStepCount(s);
  s = setLastToolResult(s, { ok: true, tool: 'load_skill' });
  s = loadSkill(s, 'demo', 'Follow the demo skill workflow.');

  // ③ 压缩：真实 DefaultContextCompressor(summarize) + 桩 provider（LLM 响应是外部输入，
  //    见 notes）→ 真实 compression meta + 真实 compact 标记行
  const stubProvider = {
    call: async () => ({
      content:
        '## Key Findings\n- src/fetch.ts holds fetchOnce()\n\n## Decisions & Rationale\n- retry wrapped at the call site\n\n## User Preferences\n- 30s default timeout',
    }),
  };
  const compressor = new compressorMod.DefaultContextCompressor(
    { strategy: 'summarize', threshold: 4, keepRecent: 4 },
    stubProvider,
    'stub-model'
  );
  s = await compression.compressState(compressor, s);

  // ④ HITL：真实 upsertPendingInterrupt（未答请求）+ hitlApprovals（已批准 tool call）
  const request = {
    type: 'question',
    questions: [
      {
        id: 'q1',
        question: 'Which default timeout should I use?',
        type: 'single-select',
        options: ['15s', '30s'],
      },
    ],
    context: 'User asked for a configurable timeout.',
    toolCallId: tcid(4),
  };
  s = hitl.upsertPendingInterrupt(s, request);
  s = updateState(s, (draft) => {
    draft.context.hitlApprovals = [tcid(2)];
  });

  // ⑤ 用量落账：真实 stampTurnUsage（runner 在 run 结束时走的同一条路径）
  s = runner.stampTurnUsage(s, {
    type: 'success',
    answer: 'done',
    totalSteps: 2,
    tokens: { input: 1234, output: 567, cacheRead: 1024, cacheWrite: 0 },
    duration: 4210,
  });
  s = updateTotalTokens(s, { input: 1234, output: 567, cacheRead: 1024, cacheWrite: 0 });

  // ⑥ 模型切换标记行（host 约定：紧凑 JSON，kind + 事件元数据）
  s = addSystemMessage(s, '{"kind":"model-switch","from":"gpt-4o","to":"claude-sonnet-4"}');
  // ⑦ 兼容性采样：legacy system-reminder 行（旧档形态，当前 daemon 不再写）
  s = addSystemReminder(s, 'Current time: 2026-09-16T00:00:00Z');

  const raw = JSON.parse(state.serializeState(s));
  const sample = normalizeSample(raw);

  return {
    ...header({
      sampleBuilder:
        'packages/colts/src/state/index.ts + hitl/interrupts.ts + runner/compression.ts + compressor/index.ts',
      producers: {
        rows: 'createAgentState / addUserMessage / addAssistantMessage / addToolMessage / addSystemMessage / addSystemReminder / loadSkill',
        compression: 'compressState(DefaultContextCompressor, summarize)',
        pendingInterrupts: 'upsertPendingInterrupt',
        turnUsage: 'stampTurnUsage',
      },
    }),
    notes: [
      '样例由真实 API 调用产出，不是手抄：见 header.producers。唯一外部输入是 summarize 策略的 LLM 响应（provider 为桩，summary 文本即桩响应），其余字段全部经真实代码路径。',
      'id/toolCallId 归一化为稳定 UUID 占位（00000000-0000-4000-8000-*）；AgentState.id 由 generateId() 产出（13 位毫秒 + "-" + 9 位 36 进制随机，见 utils/id.ts）——随机尾串不可复现，归一化为固定形状占位 0000000000000-xxxxxxxxx。时间戳统一为 1700000000000+1000n——fixtures 必须可 diff，字段类型与引用配对关系不变（toolCallId 仍指向同一条 toolCalls.id）。',
      'messages 永不删除：压缩只改 context.compression.anchor 与 LLM 视图，历史行原样保留（含锚点前的行）。',
      'system 行分两类，靠 type 区分：(none)=标记行（紧凑 JSON 字符串，仅存档/时间线，装配器跳过）；system-reminder=旧档逐轮提醒行（当前 daemon 不再写，保留读写兼容）。skill-directive 是 role=user 的驱动指令行（装配器按 role 当普通用户消息发出）。',
      'isError / usage 是可选字段：样例里各有一条行携带（错误 tool-result、末条 assistant 的回合用量）；缺失即「无」/「false」。',
      'messageRowTypes 是逐行类型的字段集（按 role/type 键，字段顺序为首次出现顺序）；messageFieldsUnion 是全部行字段的并集（Message 接口的存档面）；contextFields.optional 里的键可能整体缺失（旧档天然兼容）。',
    ],
    topLevel: keysOf(sample),
    config: keysOf(sample.config),
    contextFields: {
      always: ['messages', 'stepCount', 'createdAt', 'updatedAt'],
      optional: [
        'lastToolResult',
        'compression',
        'skillState',
        'totalTokens',
        'estimatedContextSize',
        'hitlApprovals',
        'pendingInterrupts',
      ],
    },
    messageRowTypes: collectRowShapes(sample),
    messageFieldsUnion: [...new Set(sample.context.messages.flatMap((m) => Object.keys(m)))],
    contextShapes: {
      compression: Object.fromEntries(
        Object.entries(sample.context.compression ?? {}).map(([k, v]) => [
          k,
          v === null ? 'null' : typeof v,
        ])
      ),
      compressionKeys: keysOf(sample.context.compression),
      pendingInterruptsItem: keysOf(sample.context.pendingInterrupts?.[0]),
      pendingInterruptRequest: keysOf(sample.context.pendingInterrupts?.[0]?.request),
      hitlApprovals: 'string[]（已批准的 toolCallId；只增不减）',
      totalTokens: keysOf(sample.context.totalTokens),
      skillState: keysOf(sample.context.skillState),
      messageUsage: keysOf(sample.context.messages.find((m) => m.usage)?.usage),
    },
    sample,
  };
}

// ── tool-names.json ────────────────────────────────────────────────────────

/** 判断一个对象字面量是否是工具定义：有字符串 name + execute/parameters/description 之一。 */
function toolNameFromObjectLiteral(node, sf) {
  const nameProp = node.properties.find(
    (p) => ts.isPropertyAssignment(p) && p.name?.getText(sf) === 'name'
  );
  if (!nameProp || !ts.isStringLiteral(nameProp.initializer)) return null;
  const keys = node.properties.map((p) => (p.name ? p.name.getText(sf) : ''));
  if (!keys.includes('execute') && !keys.includes('parameters') && !keys.includes('description')) {
    return null;
  }
  return nameProp.initializer.text;
}

/** 扫描一个 .ts 文件：每个 create*Tools? / *Tool 工厂（或工具常量）→ 其产出的工具名。 */
function scanToolFactories(file) {
  const sf = parseSource(file);
  const found = [];
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && /Tools?$/.test(node.name.text)) {
      const names = [];
      const walk = (n) => {
        if (ts.isObjectLiteralExpression(n)) {
          const name = toolNameFromObjectLiteral(n, sf);
          if (name) names.push(name);
        }
        n.forEachChild(walk);
      };
      node.forEachChild(walk);
      if (names.length) found.push({ factory: node.name.text, names: [...new Set(names)] });
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.name?.getText(sf).endsWith('Tool') &&
      node.initializer
    ) {
      if (ts.isObjectLiteralExpression(node.initializer)) {
        const name = toolNameFromObjectLiteral(node.initializer, sf);
        if (name) found.push({ factory: node.name.getText(sf), names: [name] });
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return found;
}

/**
 * 收集工厂体里出现的工具工厂标识符（顺序即注册顺序）。
 *
 * 只在**表达式位置**找 `/Tools?$/` 标识符（跳过类型节点，否则 `Tool<ZodTypeAny>`
 * 这类类型引用会被当成工厂名）；聚合工厂的成员（`createA2UITools` 返回的对象
 * 数组、`widen(calculatorTool)` 的参数）都据此覆盖。
 */
function scanFactoryRefs(file, factoryName) {
  const sf = parseSource(file);
  let fn = null;
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === factoryName) fn = n;
  });
  if (!fn) return null;
  const ids = [];
  const walkExpressions = (n) => {
    n.forEachChild((c) => {
      if (ts.isTypeNode(c) || ts.isTypeParameterDeclaration(c)) return; // 类型位置不算引用
      if (ts.isIdentifier(c) && /Tools?$/.test(c.text)) ids.push(c.text);
      walkExpressions(c);
    });
  };
  walkExpressions(fn.body ?? fn); // 从函数体起走：函数名自身不算引用
  return [...new Set(ids)];
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort(byCodeUnit)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

async function buildToolNamesFixture() {
  // colts 内置工具：运行时读工具对象的 name（不手抄字面量）
  const calc = await import(pathToFileURL(join(COLTS_SRC, 'tools/calculator.ts')).href);
  const ask = await import(pathToFileURL(join(COLTS_SRC, 'tools/ask-human.ts')).href);
  const skill = await import(pathToFileURL(join(COLTS_SRC, 'skills/load-skill-tool.ts')).href);

  const coltsBuiltin = [
    {
      name: calc.calculatorTool.name,
      factory: 'calculatorTool',
      module: 'tools/calculator.ts',
      always: true,
    },
    {
      name: ask.createAskHumanTool({ handler: async () => ({}) }).name,
      factory: 'createAskHumanTool',
      module: 'tools/ask-human.ts',
      always: false,
      condition: '仅当宿主提供 AskHumanHandler（HITL 打开）时注册',
    },
    {
      name: skill.createLoadSkillTool({
        getManifest: async () => null,
        loadInstructions: async () => '',
        listSkills: async () => [],
      }).name,
      factory: 'createLoadSkillTool',
      module: 'skills/load-skill-tool.ts',
      always: false,
      condition: '仅当 runner 有 skillProvider（skillDirs 或注入）时自动注册',
    },
  ].sort((a, b) => byCodeUnit(a.name, b.name));

  const srcDir = join(OPTS.wrangler, 'src');
  const fixture = {
    ...header({
      coltsBuiltin: 'packages/colts/src（运行时读 Tool.name）',
      wrangler: `${srcDir} 全树（AST：工具对象的 name 字面量 + 聚合工厂体内引用的工厂）`,
    }),
    notes: [
      'colts.builtin 是 colts 包**自带**的工具（运行时从工具对象读 name）；宿主注入的工具集不在 colts 内。',
      'wrangler 节是外仓扫描结果（createCoreTools 与各可选工具族的注册名），仅当目录存在时可用——路径经 --wrangler 配置，缺失时 available:false，不猜。',
      'createCoreTools 的名字集合按 builtin/index.ts 体内实际引用的工厂解析（含 widen(calculatorTool) 这类参数位置）；colts 提供的工厂（calculatorTool / createAskHumanTool）用运行时 name 解析，其余用工厂定义文件的 name 字面量。解析不到的引用列入 unresolvedFactories。',
      '扫描范围是 wrangler src 全树（不止 src/tools）：byFamily 按目录分组，聚合工厂（createA2UITools / createWebTools / createSpecPlanTools）返回的工具按工厂定义文件归属其族。动态命名的工具（MCP: createMCPTool，name 由服务器提供）扫不到——这类不在此快照的保证范围内。',
      'allNames 是全部发现的工具名稳定排序（UTF-16 code unit），供两仓快照测试直接比对；线协议减法（如 R2P-240 移除 list_dir / a2ui_wait）落地时同步重跑本脚本。',
    ],
    colts: { builtin: coltsBuiltin, builtinNames: coltsBuiltin.map((t) => t.name) },
    wrangler: null,
  };

  if (!existsSync(srcDir)) {
    fixture.wrangler = {
      available: false,
      reason: `目录不存在: ${srcDir}（用 --wrangler <dir> 指定）`,
    };
    return fixture;
  }

  const factories = [];
  const byFamily = {};
  for (const file of walkFiles(srcDir)) {
    const family = relative(srcDir, dirname(file)) || 'root';
    for (const def of scanToolFactories(file)) {
      factories.push({ ...def, file: relative(OPTS.wrangler, file) });
      byFamily[family] = [...(byFamily[family] ?? []), ...def.names];
    }
  }
  for (const k of Object.keys(byFamily)) byFamily[k] = [...new Set(byFamily[k])].sort(byCodeUnit);

  const factoryToNames = new Map(factories.map((f) => [f.factory, f.names]));
  // colts 提供的工厂经运行时 name 解析（外仓文件里没有它们的定义）
  for (const t of coltsBuiltin) factoryToNames.set(t.factory, [t.name]);

  const coreFile = join(srcDir, 'tools', 'builtin', 'index.ts');
  let coreNames = null;
  let unresolvedFactories = [];
  if (existsSync(coreFile)) {
    const refs = scanFactoryRefs(coreFile, 'createCoreTools');
    if (refs) {
      const names = [];
      for (const r of refs) {
        const resolved = factoryToNames.get(r);
        if (resolved) names.push(...resolved);
        else unresolvedFactories.push(r);
      }
      coreNames = [...new Set(names)];
    }
  }

  const allNames = [...new Set(Object.values(byFamily).flat())].sort(byCodeUnit);
  fixture.wrangler = {
    available: true,
    root: relative(REPO, OPTS.wrangler),
    createCoreTools: coreNames,
    createCoreToolsSource: 'src/tools/builtin/index.ts#createCoreTools（按引用顺序）',
    byFamily,
    factories: factories.sort((a, b) => byCodeUnit(a.factory, b.factory)),
    allNames,
    ...(unresolvedFactories.length
      ? { unresolvedFactories: [...new Set(unresolvedFactories)].sort(byCodeUnit) }
      : {}),
  };
  return fixture;
}

// ── main ───────────────────────────────────────────────────────────────────

register(pathToFileURL(join(HERE, 'lib/ts-source-loader.mjs')).href);

const results = [
  writeFixture('events.json', buildEventsFixture()),
  writeFixture('state-schema.json', await buildStateFixture()),
  writeFixture('tool-names.json', await buildToolNamesFixture()),
];

if (OPTS.check && results.some((ok) => !ok)) process.exit(1);
