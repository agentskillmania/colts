/**
 * R2P-105（对齐 Rust 0a3ec81）：压缩/换模型标记行进会话历史。
 *
 * 压缩发生与换模型在会话历史里必须可见——resume 后压缩状态/模型选择
 * 不再静默丢失、时间线可以展示。标记行是 role:system 的普通 Message，
 * 内容为紧凑 JSON（kind + 事件元数据），随 state.json 持久化，resume
 * 免费还原。换模型标记行的写入方在 wrangler/daemon 侧（Rust d9828dc 的
 * append_model_switch_marker 门面）——colts 只负责表达与保留，本套测试
 * 用手写的 model-switch 行钉住读侧契约。
 *
 * LLM 可见性（Rust 现状判定）：DefaultMessageAssembler 跳过 system 行，
 * 标记不经装配器进入对话请求（活区标记行会进 summarize 的 LLM 输入，
 * 与 Rust 一致）——它纯属持久化历史，不是对话参与者。
 */

import { describe, it, expect, vi } from 'vitest';

import { compressState } from '../../src/runner/compression.js';
import { DefaultMessageAssembler } from '../../src/message-assembler/default-assembler.js';
import {
  createAgentState,
  addUserMessage,
  addAssistantMessage,
  addSystemMessage,
  updateState,
  serializeState,
  deserializeState,
} from '../../src/state/index.js';
import type { AgentState, IContextCompressor, CompressResult } from '../../src/types.js';

const config = { name: 'test', instructions: 'test', tools: [] };
// 组装器测试用空人设（对齐 Rust 测试的 config("")）：非空 instructions 会
// 以 [System Instructions] user 消息前置，干扰 user 计数。
const bareConfig = { name: 'test', instructions: '', tools: [] };

/** 返回固定 CompressResult 的 mock 压缩器（对齐 Rust 测试的 compact_result helper）。 */
function fixedCompressor(result: Partial<CompressResult>): IContextCompressor {
  return {
    shouldCompress: vi.fn().mockReturnValue(true),
    compress: vi.fn().mockResolvedValue({ summary: 'covered history', ...result }),
  };
}

/** 解析最后一条消息的标记行 JSON（调用方先断言 role === 'system'）。 */
function parseMarker(state: AgentState): Record<string, unknown> {
  const marker = state.context.messages[state.context.messages.length - 1];
  return JSON.parse(marker.content) as Record<string, unknown>;
}

// ── addSystemMessage：标记行的落库形状 ────────────────────────────────────

describe('R2P-105: addSystemMessage (marker row primitive)', () => {
  it('appends a role:system row with token estimate and no MessageType', () => {
    let state = createAgentState(config);
    state = addSystemMessage(state, '{"kind":"compact","coveredMessages":3}');

    expect(state.context.messages).toHaveLength(1);
    const marker = state.context.messages[0];
    expect(marker.role).toBe('system');
    expect(marker.content).toBe('{"kind":"compact","coveredMessages":3}');
    // Rust Message::new 不设 msg_type —— 标记行无 type 字段。
    expect(marker.type).toBeUndefined();
    expect(typeof marker.tokenCount).toBe('number');
    expect(marker.tokenCount!).toBeGreaterThan(0);
  });

  it('is immutable — original state untouched', () => {
    const state = createAgentState(config);
    const before = state.context.messages.length;
    const returned = addSystemMessage(state, '{"kind":"model-switch","from":"a","to":"b"}');
    expect(state.context.messages.length).toBe(before);
    expect(returned.context.messages.length).toBe(before + 1);
  });
});

// ── compressState：压缩发生时插入标记行 ──────────────────────────────────

describe('R2P-105: compressState appends a compact marker row', () => {
  it('appends exactly one system marker with kind/coveredMessages/removedTokens/summaryTokens', async () => {
    let state = createAgentState(config);
    state = addUserMessage(state, 'q1');
    state = addAssistantMessage(state, 'a1');
    const countBefore = state.context.messages.length;

    state = await compressState(
      fixedCompressor({
        anchor: 1,
        removedTokenCount: 900,
        summaryTokenCount: 42,
        compressedAt: 1_700_000_000_000,
      }),
      state
    );

    // 消息从不被删除；压缩额外追加恰好一行 system 标记。
    expect(state.context.messages).toHaveLength(countBefore + 1);
    const marker = state.context.messages[state.context.messages.length - 1];
    expect(marker.role).toBe('system');
    expect(parseMarker(state)).toEqual({
      kind: 'compact',
      coveredMessages: 1,
      removedTokens: 900,
      summaryTokens: 42,
    });
    // meta 照旧写入。
    expect(state.context.compression?.anchor).toBe(1);
  });

  it('counts incremental coverage across multiple compressions (anchor delta, one row each)', async () => {
    // 第二次压缩：coveredMessages 是 anchor 增量，不是总量。
    let state = createAgentState(config);
    for (let i = 0; i < 6; i++) {
      state = addUserMessage(state, `q${i}`);
      state = addAssistantMessage(state, 'a');
    }

    state = await compressState(
      fixedCompressor({ anchor: 2, removedTokenCount: 500, summaryTokenCount: 30 }),
      state
    );
    state = await compressState(
      fixedCompressor({ anchor: 5, removedTokenCount: 400, summaryTokenCount: 25 }),
      state
    );

    expect(parseMarker(state)).toEqual({
      kind: 'compact',
      coveredMessages: 3,
      removedTokens: 400,
      summaryTokens: 25,
    });
    // 两次压缩各留一行标记（单槽 meta 只剩最新，标记行不丢）。
    const markers = state.context.messages.filter((m) => m.role === 'system');
    expect(markers).toHaveLength(2);
  });

  it('saturates coveredMessages to 0 on no-progress / regressed anchors (aligns the compressed event)', async () => {
    // 放弃/no-op：压缩管线照跑（meta 重写、剪枝照旧），但 anchor 不推进
    // → 标记行照插、增量饱和为 0。与 maybeCompress 的 coveredMessages:0
    // 发射同点同语义（对齐 Rust apply_compression 的 saturating_sub——
    // shouldCompress 真即调，无「锚点不推进就跳过插标记」分支）。
    // round-2/3 mock 镜像生产 no-op 早退形状（compressor/index.ts 放弃分支
    // 透传旧 summaryTokenCount 保护压缩 meta，removedTokenCount 缺席）——
    // 标记行若不按锚点增量守卫，旧摘要数会漏进 no-op 轮标记，写成
    // 「覆盖 0 条却有 42 token 摘要」的自相矛盾行。
    let state = createAgentState(config);
    state = addUserMessage(state, 'q1');
    state = await compressState(
      fixedCompressor({ anchor: 1, removedTokenCount: 900, summaryTokenCount: 42 }),
      state
    );

    // 生产 no-op 形状：anchor 不动，旧 summaryTokenCount（42）原样透传。
    state = await compressState(fixedCompressor({ anchor: 1, summaryTokenCount: 42 }), state);

    expect(parseMarker(state)).toEqual({
      kind: 'compact',
      coveredMessages: 0,
      removedTokens: 0,
      summaryTokens: 0,
    });
    expect(state.context.messages.filter((m) => m.role === 'system')).toHaveLength(2);

    // 回退（anchor < prevAnchor）同样饱和为 0，不出负数，旧摘要数也不透传。
    state = await compressState(fixedCompressor({ anchor: 0, summaryTokenCount: 42 }), state);
    expect(parseMarker(state).coveredMessages).toBe(0);
    expect(parseMarker(state).summaryTokens).toBe(0);
  });

  it('does not append a marker when compression is skipped entirely (maybeCompress early return)', async () => {
    const { maybeCompress } = await import('../../src/runner/compression.js');
    let state = createAgentState(config);
    state = addUserMessage(state, 'q1');

    // 无压缩器 / 未过阈值：maybeCompress 早退，compressState 根本不跑，
    // 标记行一条也不多。
    const skipped1 = await maybeCompress(undefined, state);
    expect(skipped1.context.messages).toHaveLength(1);

    const neverCompress: IContextCompressor = {
      shouldCompress: vi.fn().mockReturnValue(false),
      compress: vi.fn(),
    };
    const skipped2 = await maybeCompress(neverCompress, state);
    expect(skipped2.context.messages).toHaveLength(1);
    expect(neverCompress.compress).not.toHaveBeenCalled();
  });
});

// ── serde round-trip / resume：旧档兼容与还原 ────────────────────────────

describe('R2P-105: marker rows survive serialize/deserialize (resume restore)', () => {
  it('round-trips compact and model-switch marker rows byte-identically', () => {
    let state = createAgentState(config);
    state = addUserMessage(state, 'q1');
    state = addSystemMessage(
      state,
      '{"kind":"compact","coveredMessages":1,"removedTokens":900,"summaryTokens":42}'
    );
    state = addUserMessage(state, 'q2');
    // 换模型标记行由 wrangler 批写入——colts 只须能表达并保留。
    state = addSystemMessage(state, '{"kind":"model-switch","from":"m-old","to":"m-new"}');
    state = updateState(state, (draft) => {
      draft.context.compression = { summary: 's', anchor: 1 };
    });

    const restored = deserializeState(serializeState(state));
    expect(
      restored.context.messages.filter((m) => m.role === 'system').map((m) => m.content)
    ).toEqual([
      '{"kind":"compact","coveredMessages":1,"removedTokens":900,"summaryTokens":42}',
      '{"kind":"model-switch","from":"m-old","to":"m-new"}',
    ]);
    expect(restored.context.compression?.anchor).toBe(1);
  });

  it('parses legacy archives without markers and preserves unknown message fields', () => {
    // 旧档：无标记行；消息携带未来/未知字段（forward compat）——
    // 反序列化不炸、未知字段不丢。
    const legacy = {
      id: 'legacy',
      config,
      context: {
        messages: [
          {
            role: 'user',
            id: 'u1',
            content: 'old question',
            timestamp: 1,
            someFutureField: { nested: true },
          },
        ],
        stepCount: 3,
        createdAt: 1,
        updatedAt: 2,
      },
    };
    const restored = deserializeState(JSON.stringify(legacy));
    expect(restored.context.messages).toHaveLength(1);
    expect(
      (restored.context.messages[0] as unknown as Record<string, unknown>).someFutureField
    ).toEqual({
      nested: true,
    });
  });
});

// ── 组装器：标记行不经装配器进对话请求 ─────────────────────────────────

describe('R2P-105: assembler skips system marker rows', () => {
  it('assembler skips system rows, adjacent messages unaffected', async () => {
    let state = createAgentState(bareConfig);
    state = addUserMessage(state, 'hello');
    state = addSystemMessage(state, '{"kind":"compact","coveredMessages":3}');
    state = addSystemMessage(state, '{"kind":"model-switch","from":"a","to":"b"}');
    state = addUserMessage(state, 'again');

    const assembler = new DefaultMessageAssembler();
    const messages = await assembler.build(state, { model: 'm' });

    // pi-ai wire 形态只有 user/assistant/toolResult——system 行漏进请求
    // 会破坏调用约定；标记行必须被跳过。
    for (const m of messages) {
      expect(m.role).not.toBe('system');
    }
    // user 两条都在（标记行被跳过，不影响相邻消息）。
    expect(messages.filter((m) => m.role === 'user').length).toBe(2);
  });

  it('assembler still skips markers after resume (deserialize → build)', async () => {
    let state = createAgentState(bareConfig);
    state = addUserMessage(state, 'hello');
    state = await compressState(
      fixedCompressor({ anchor: 1, removedTokenCount: 10, summaryTokenCount: 5 }),
      state
    );
    state = addUserMessage(state, 'again');

    const restored = deserializeState(serializeState(state));
    expect(restored.context.messages.some((m) => m.role === 'system')).toBe(true);

    const messages = await new DefaultMessageAssembler().build(restored, { model: 'm' });
    expect(messages.every((m) => m.role !== 'system')).toBe(true);
    expect(messages.filter((m) => m.role === 'user').length).toBe(2);
  });
});

// ── 清除契约：标记行不享受特殊保留 ──────────────────────────────────────

describe('R2P-105: clearing the session drops markers with the messages', () => {
  it('markers vanish when messages array is cleared', async () => {
    let state = createAgentState(config);
    state = addUserMessage(state, 'q');
    state = await compressState(
      fixedCompressor({ anchor: 1, removedTokenCount: 100, summaryTokenCount: 10 }),
      state
    );
    expect(state.context.messages.some((m) => m.role === 'system')).toBe(true);

    state = updateState(state, (draft) => {
      draft.context.messages.length = 0;
      draft.context.compression = undefined;
    });
    expect(state.context.messages).toHaveLength(0);
    expect(state.context.compression).toBeUndefined();
  });
});
