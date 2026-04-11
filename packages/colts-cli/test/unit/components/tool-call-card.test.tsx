/**
 * @fileoverview ToolCallCard component unit tests
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { ToolCallCard } from '../../../src/components/chat/tool-call-card.js';
import type { ToolCallData } from '../../../src/components/chat/tool-call-card.js';

describe('ToolCallCard', () => {
  it('should display tool name', () => {
    const data: ToolCallData = { tool: 'read_file' };
    const { lastFrame } = render(<ToolCallCard data={data} />);
    expect(lastFrame()).toContain('read_file');
  });

  it('should display arguments', () => {
    const data: ToolCallData = { tool: 'read_file', args: '/path/to/file' };
    const { lastFrame } = render(<ToolCallCard data={data} />);
    expect(lastFrame()).toContain('/path/to/file');
  });

  it('should display object arguments', () => {
    const data: ToolCallData = { tool: 'search', args: { query: 'test' } };
    const { lastFrame } = render(<ToolCallCard data={data} />);
    expect(lastFrame()).toContain('query');
  });

  it('should display execution result', () => {
    const data: ToolCallData = { tool: 'read_file', result: 'file content here' };
    const { lastFrame } = render(<ToolCallCard data={data} />);
    expect(lastFrame()).toContain('file content here');
  });

  it('should show running status indicator', () => {
    const data: ToolCallData = { tool: 'read_file', isRunning: true };
    const { lastFrame } = render(<ToolCallCard data={data} />);
    expect(lastFrame()).toContain('running');
  });

  it('should truncate long arguments', () => {
    const longArgs = 'a'.repeat(200);
    const data: ToolCallData = { tool: 'exec', args: longArgs };
    const { lastFrame } = render(<ToolCallCard data={data} />);
    expect(lastFrame()).toContain('...');
  });

  it('should show only tool name when no args and no result', () => {
    const data: ToolCallData = { tool: 'list' };
    const frame = render(<ToolCallCard data={data} />).lastFrame();
    expect(frame).toContain('list');
  });

  it('should not display null arguments', () => {
    const data: ToolCallData = { tool: 'exec', args: null };
    const { lastFrame } = render(<ToolCallCard data={data} />);
    expect(lastFrame()).toContain('exec');
  });

  it('should display numeric result', () => {
    const data: ToolCallData = { tool: 'count', result: 42 };
    const { lastFrame } = render(<ToolCallCard data={data} />);
    expect(lastFrame()).toContain('42');
  });
});
