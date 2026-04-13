/**
 * @fileoverview TimelinePanel 组件单元测试
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { TimelinePanel } from '../../../src/components/timeline/timeline-panel.js';
import type { TimelineEntry } from '../../../src/types/timeline.js';

describe('TimelinePanel', () => {
  it('空 entries 渲染为 null', () => {
    const { lastFrame } = render(<TimelinePanel entries={[]} detailLevel="compact" />);
    expect(lastFrame()).toBe('');
  });

  it('所有条目都被 compact 过滤掉时渲染为 null', () => {
    const entries: TimelineEntry[] = [
      { type: 'phase', id: 'p1', from: 'idle', to: 'calling-llm', timestamp: 1000 },
      { type: 'thought', id: 't1', content: 'hmm', timestamp: 1000 },
    ];
    const { lastFrame } = render(<TimelinePanel entries={entries} detailLevel="compact" />);
    expect(lastFrame()).toBe('');
  });

  it('compact 模式渲染可见条目，隐藏不可见条目', () => {
    const entries: TimelineEntry[] = [
      { type: 'user', id: 'u1', content: 'Hello', timestamp: 1000 },
      { type: 'phase', id: 'p1', from: 'idle', to: 'calling-llm', timestamp: 1000 },
      { type: 'assistant', id: 'a1', content: 'Hi', timestamp: 1000 },
      { type: 'thought', id: 't1', content: 'thinking', timestamp: 1000 },
    ];
    const { lastFrame } = render(<TimelinePanel entries={entries} detailLevel="compact" />);
    const frame = lastFrame();
    // user 和 assistant 可见
    expect(frame).toContain('Hello');
    expect(frame).toContain('Hi');
    // phase 和 thought 在 compact 下隐藏
    expect(frame).not.toContain('idle');
    expect(frame).not.toContain('thinking');
  });

  it('detail 模式额外显示 step-start、step-end、compress', () => {
    const entries: TimelineEntry[] = [
      { type: 'step-start', id: 'ss1', step: 0, timestamp: 1000 },
      { type: 'step-end', id: 'se1', step: 0, result: { type: 'done', answer: 'ok' }, timestamp: 1000 },
      { type: 'compress', id: 'c1', status: 'compressing', timestamp: 1000 },
      { type: 'phase', id: 'p1', from: 'idle', to: 'preparing', timestamp: 1000 },
    ];
    const { lastFrame } = render(<TimelinePanel entries={entries} detailLevel="detail" />);
    const frame = lastFrame();
    // detail 可见
    expect(frame).toContain('Step 0');
    expect(frame).toContain('Compressing');
    // detail 不可见
    expect(frame).not.toContain('idle');
  });

  it('verbose 模式显示所有条目', () => {
    const entries: TimelineEntry[] = [
      { type: 'user', id: 'u1', content: 'Hi', timestamp: 1000 },
      { type: 'phase', id: 'p1', from: 'idle', to: 'calling-llm', timestamp: 1000 },
      { type: 'thought', id: 't1', content: 'deep thought', timestamp: 1000 },
    ];
    const { lastFrame } = render(<TimelinePanel entries={entries} detailLevel="verbose" />);
    const frame = lastFrame();
    expect(frame).toContain('Hi');
    expect(frame).toContain('idle');
    expect(frame).toContain('deep thought');
  });

  it('混合条目类型按顺序渲染', () => {
    const entries: TimelineEntry[] = [
      { type: 'user', id: 'u1', content: 'First', timestamp: 1000 },
      { type: 'tool', id: 't1', tool: 'read', isRunning: true, timestamp: 2000 },
      { type: 'assistant', id: 'a1', content: 'Second', timestamp: 3000 },
    ];
    const { lastFrame } = render(<TimelinePanel entries={entries} detailLevel="compact" />);
    const frame = lastFrame();
    const firstIdx = frame!.indexOf('First');
    const readIdx = frame!.indexOf('read');
    const secondIdx = frame!.indexOf('Second');
    // 保持顺序
    expect(firstIdx).toBeLessThan(readIdx);
    expect(readIdx).toBeLessThan(secondIdx);
  });

  it('单条 entry 正常渲染', () => {
    const entries: TimelineEntry[] = [
      { type: 'system', id: 's1', content: 'Ready', timestamp: 1000 },
    ];
    const { lastFrame } = render(<TimelinePanel entries={entries} detailLevel="compact" />);
    expect(lastFrame()).toContain('Ready');
  });
});
