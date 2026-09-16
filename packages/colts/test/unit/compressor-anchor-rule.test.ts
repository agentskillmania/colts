/**
 * @fileoverview 压缩 anchor 安全规则（R2P-102/103，对齐 Rust 6817c6c/b4b0fe3）
 *
 * Rust 6817c6c 的动机:旧守卫逐 case 回退(只查一步 assistant+toolCalls)脆弱
 * ——连续 tool 结果、reasoning_content 等配对都要单独防。用户消息是天然安全
 * 边界(一轮的起点):anchor 只能落在 role==='user' 的消息上,从它开始组装
 * 永远不会产出孤儿消息。回退到 existingAnchor 仍无 user 消息则本轮放弃压缩。
 *
 * 另含 b4b0fe3:窗口触发阈值 80%→90%(WINDOW_TRIGGER_RATIO)。
 * 测试蓝本译自 Rust crates/colts/src/compressor.rs 的 anchor_tests 单测与
 * tests/suite/compressor.rs 的旧行为测试更新。
 */

import { describe, it, expect } from 'vitest';
import { DefaultContextCompressor } from '../../src/compressor/index.js';
import { createAgentState } from '../../src/state/index.js';
import type { AgentState, Message } from '../../src/types.js';

function makeState(messages: Message[], anchor = 0, summary = ''): AgentState {
  const state = createAgentState({ name: 't', instructions: '', tools: [] });
  state.context.messages = messages;
  if (anchor > 0 || summary) {
    state.context.compression = { summary, anchor };
  }
  return state;
}

function user(id: string): Message {
  return { id, role: 'user', content: 'test', type: 'text', timestamp: 0, tokenCount: 1 };
}

function thought(id: string): Message {
  return {
    id,
    role: 'assistant',
    content: 'thinking',
    type: 'thought',
    timestamp: 0,
    tokenCount: 1,
  };
}

function action(id: string, toolId: string, name = 'search'): Message {
  return {
    id,
    role: 'assistant',
    content: '',
    type: 'action',
    timestamp: 0,
    tokenCount: 1,
    toolCalls: [{ id: toolId, name, arguments: {} }],
  };
}

function toolResult(id: string, toolId: string, name = 'search'): Message {
  return {
    id,
    role: 'tool',
    content: 'result',
    type: 'tool-result',
    timestamp: 0,
    tokenCount: 1,
    toolCallId: toolId,
    toolName: name,
  };
}

describe('compressor anchor 规则——anchor 只落用户消息（R2P-102）', () => {
  it('desired 位置是 tool result → 回退到最近 user（Rust anchor_lands_on_user_message_not_tool）', async () => {
    // [0]=user, [1]=thought, [2]=action(toolCalls), [3]=tool, [4]=tool,
    // [5]=user(安全边界), [6]=thought, [7]=action(toolCalls), [8]=tool ← 朴素锚点, [9]=user
    const state = makeState([
      user('1'),
      thought('2'),
      action('3', 'c1'),
      toolResult('4', 'c1'),
      toolResult('5', 'c2'), // 连续 tool 结果:父 action 在 3 步之外,一步回退覆盖不了
      user('6'),
      thought('7'),
      action('8', 'c3'),
      toolResult('9', 'c3'),
      user('10'),
    ]);
    // keepRecent=2 → 朴素 anchor = 10-2 = 8(tool)→ 7(action)→ 6(thought)→ 5(user ✓)
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 2, threshold: 1 });
    const result = await c.compress(state);
    expect(result.anchor).toBe(5);
    expect(state.context.messages[result.anchor].role).toBe('user');
  });

  it('朴素锚点落在 assistant 上 → 回退到最近 user（R2P-102 任务场景）', async () => {
    // [user, assistant(toolCalls), tool, user, assistant(toolCalls), tool, user, assistant]
    const state = makeState([
      user('1'),
      action('2', 'c1'),
      toolResult('3', 'c1'),
      user('4'),
      action('5', 'c2'),
      toolResult('6', 'c2'),
      user('7'),
      { id: '8', role: 'assistant', content: 'final', type: 'text', timestamp: 0, tokenCount: 1 },
    ]);
    // keepRecent=1 → 朴素 anchor = 8-1 = 7(assistant)→ 6(user ✓)
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 1, threshold: 1 });
    const result = await c.compress(state);
    expect(result.anchor).toBe(6);
    expect(state.context.messages[result.anchor].role).toBe('user');
  });

  it('全部回退到头没有 user 消息 → 放弃压缩、保留旧 summary（Rust no_user_message_no_compress）', async () => {
    // [thought, action(toolCalls), tool] —— 全程无 user
    const state = makeState(
      [thought('1'), action('2', 'c1'), toolResult('3', 'c1')],
      0,
      'kept summary'
    );
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 1, threshold: 1 });
    const result = await c.compress(state);
    // anchor 保持 existingAnchor(0),本轮不推进
    expect(result.anchor).toBe(0);
    expect(result.summary).toBe('kept summary');
    expect(result.removedTokenCount).toBeUndefined();
    expect(result.compressedAt).toBeUndefined();
  });

  it('existingAnchor 之后无 user 消息 → 放弃压缩、anchor 不变', async () => {
    // [0]=user, [1]=assistant(toolCalls), [2]=tool, [3]=assistant, [4]=assistant
    // existingAnchor=1:回退最远到 1,仍无 user → 放弃
    const state = makeState(
      [user('1'), action('2', 'c1'), toolResult('3', 'c1'), thought('4'), thought('5')],
      1,
      'old summary'
    );
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 1, threshold: 1 });
    const result = await c.compress(state);
    expect(result.anchor).toBe(1);
    expect(result.summary).toBe('old summary');
    expect(result.removedTokenCount).toBeUndefined();
    expect(result.compressedAt).toBeUndefined();
  });

  it('load_skill 钉扎后继续回退到最近 user——技能结果仍在窗口内（Rust 6817c6c 旧行为测试更新）', async () => {
    // [0]=user, [1]=assistant(load_skill), [2]=tool(load_skill result), [3]=assistant,
    // [4]=user, [5]=assistant, [6]=user, [7]=assistant
    const state = makeState([
      user('1'),
      action('2', 'c1', 'load_skill'),
      toolResult('3', 'c1', 'load_skill'),
      thought('4'),
      user('5'),
      thought('6'),
      user('7'),
      thought('8'),
    ]);
    // keepRecent=2 → 朴素 anchor=6(user),但 load_skill 在下标 2 → 钉在 2;
    // 新规则继续回退到最近的用户消息(下标 0)——skill 结果仍在窗口内,
    // 只是保留了更多上下文(安全边界规则:anchor 必须落在用户消息上)。
    const c = new DefaultContextCompressor({ strategy: 'truncate', keepRecent: 2, threshold: 1 });
    const result = await c.compress(state);
    expect(result.anchor).toBe(0);
    // load_skill 结果(下标 2)在锚点之后,仍进入发送窗口
    expect(result.anchor).toBeLessThanOrEqual(2);
  });
});

describe('压缩触发阈值（R2P-103，对齐 Rust b4b0fe3）', () => {
  it('窗口占用 ≥ 90% 才触发:91 触发、89 不触发、90 边界触发', () => {
    const make = () => new DefaultContextCompressor({ contextWindowSize: 100, threshold: 1000 });

    const withTokens = (tokens: number): AgentState => {
      const state = createAgentState({ name: 't', instructions: '', tools: [] });
      state.context.messages = [user('1')];
      state.context.messages[0].tokenCount = tokens;
      return state;
    };

    expect(make().shouldCompress(withTokens(91))).toBe(true);
    expect(make().shouldCompress(withTokens(90))).toBe(true);
    expect(make().shouldCompress(withTokens(89))).toBe(false);
  });

  it('threshold 默认值 120:119 条不触发、120 条触发（对齐 Rust 6817c6c）', () => {
    const c = new DefaultContextCompressor();
    const withCount = (n: number): AgentState => {
      const state = createAgentState({ name: 't', instructions: '', tools: [] });
      state.context.messages = Array.from({ length: n }, (_, i) => user(`${i}`));
      return state;
    };
    expect(c.shouldCompress(withCount(119))).toBe(false);
    expect(c.shouldCompress(withCount(120))).toBe(true);
  });
});
