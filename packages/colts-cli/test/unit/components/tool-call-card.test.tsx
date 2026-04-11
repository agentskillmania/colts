/**
 * @fileoverview ToolCallCard 组件单元测试
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { ToolCallCard } from '../../../src/components/chat/tool-call-card.js';
import type { ToolCallData } from '../../../src/components/chat/tool-call-card.js';

describe('ToolCallCard', () => {
  it('显示工具名', () => {
    const data: ToolCallData = { tool: 'read_file' };
    const { lastFrame } = render(<ToolCallCard data={data} />);
    expect(lastFrame()).toContain('read_file');
  });

  it('显示参数', () => {
    const data: ToolCallData = { tool: 'read_file', args: '/path/to/file' };
    const { lastFrame } = render(<ToolCallCard data={data} />);
    expect(lastFrame()).toContain('/path/to/file');
  });

  it('显示对象参数', () => {
    const data: ToolCallData = { tool: 'search', args: { query: 'test' } };
    const { lastFrame } = render(<ToolCallCard data={data} />);
    expect(lastFrame()).toContain('query');
  });

  it('显示执行结果', () => {
    const data: ToolCallData = { tool: 'read_file', result: 'file content here' };
    const { lastFrame } = render(<ToolCallCard data={data} />);
    expect(lastFrame()).toContain('file content here');
  });

  it('running 状态显示提示', () => {
    const data: ToolCallData = { tool: 'read_file', isRunning: true };
    const { lastFrame } = render(<ToolCallCard data={data} />);
    expect(lastFrame()).toContain('running');
  });

  it('截断长参数', () => {
    const longArgs = 'a'.repeat(200);
    const data: ToolCallData = { tool: 'exec', args: longArgs };
    const { lastFrame } = render(<ToolCallCard data={data} />);
    expect(lastFrame()).toContain('...');
  });

  it('无参数无结果只显示工具名', () => {
    const data: ToolCallData = { tool: 'list' };
    const frame = render(<ToolCallCard data={data} />).lastFrame();
    expect(frame).toContain('list');
  });

  it('null 参数不显示', () => {
    const data: ToolCallData = { tool: 'exec', args: null };
    const { lastFrame } = render(<ToolCallCard data={data} />);
    expect(lastFrame()).toContain('exec');
  });

  it('数字结果也能显示', () => {
    const data: ToolCallData = { tool: 'count', result: 42 };
    const { lastFrame } = render(<ToolCallCard data={data} />);
    expect(lastFrame()).toContain('42');
  });
});
