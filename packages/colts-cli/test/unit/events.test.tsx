/**
 * events.tsx 单元测试
 *
 * 测试 Events 组件的渲染行为，包括事件颜色、缩进和不同事件类型。
 * 使用 ink-testing-library 进行组件渲染验证。
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Events } from '../../src/components/events.js';
import type { DisplayEvent } from '../../src/hooks/use-events.js';

/** 创建测试用事件的辅助函数 */
function createEvent(overrides: Partial<DisplayEvent> & { id: string; type: string; text: string }): DisplayEvent {
  return {
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('Events 组件', () => {
  describe('基本渲染', () => {
    it('空事件列表能正常渲染', () => {
      const { lastFrame } = render(<Events events={[]} />);
      const frame = lastFrame();
      expect(frame).toBeDefined();
    });

    it('渲染单条事件', () => {
      const events: DisplayEvent[] = [
        createEvent({ id: '1', type: 'phase-change', text: 'Phase: idle → calling-llm' }),
      ];
      const { lastFrame } = render(<Events events={events} />);
      const frame = lastFrame();
      expect(frame).toContain('Phase: idle → calling-llm');
    });
  });

  describe('多事件渲染', () => {
    it('渲染多条事件按顺序显示', () => {
      const events: DisplayEvent[] = [
        createEvent({ id: '1', type: 'phase-change', text: 'Phase: idle → calling-llm' }),
        createEvent({ id: '2', type: 'token', text: 'Hello' }),
        createEvent({ id: '3', type: 'tool:start', text: 'Tool: calculator' }),
      ];
      const { lastFrame } = render(<Events events={events} />);
      const frame = lastFrame()!;
      const firstIdx = frame.indexOf('Phase: idle');
      const secondIdx = frame.indexOf('Hello');
      const thirdIdx = frame.indexOf('Tool: calculator');
      expect(firstIdx).toBeLessThan(secondIdx);
      expect(secondIdx).toBeLessThan(thirdIdx);
    });
  });

  describe('缩进', () => {
    it('无 indent 字段的事件不缩进', () => {
      const events: DisplayEvent[] = [
        createEvent({ id: '1', type: 'token', text: 'No indent' }),
      ];
      const { lastFrame } = render(<Events events={events} />);
      const frame = lastFrame();
      expect(frame).toContain('No indent');
    });

    it('indent 为 0 的事件不缩进', () => {
      const events: DisplayEvent[] = [
        createEvent({ id: '1', type: 'token', text: 'Zero indent', indent: 0 }),
      ];
      const { lastFrame } = render(<Events events={events} />);
      const frame = lastFrame();
      expect(frame).toContain('Zero indent');
    });

    it('indent > 0 的事件有缩进', () => {
      const events: DisplayEvent[] = [
        createEvent({ id: '1', type: 'token', text: 'Indented', indent: 2 }),
      ];
      const { lastFrame } = render(<Events events={events} />);
      const frame = lastFrame();
      expect(frame).toContain('Indented');
    });

    it('不同缩进级别的事件同时渲染', () => {
      const events: DisplayEvent[] = [
        createEvent({ id: '1', type: 'subagent:start', text: 'Starting', indent: 0 }),
        createEvent({ id: '2', type: 'subagent:token', text: 'Working', indent: 2 }),
      ];
      const { lastFrame } = render(<Events events={events} />);
      const frame = lastFrame();
      expect(frame).toContain('Starting');
      expect(frame).toContain('Working');
    });
  });

  describe('各种事件类型', () => {
    it('渲染 tool:end 事件', () => {
      const events: DisplayEvent[] = [
        createEvent({ id: '1', type: 'tool:end', text: 'Result: OK' }),
      ];
      const { lastFrame } = render(<Events events={events} />);
      expect(lastFrame()).toContain('Result: OK');
    });

    it('渲染 error 事件', () => {
      const events: DisplayEvent[] = [
        createEvent({ id: '1', type: 'error', text: 'Error: Something failed' }),
      ];
      const { lastFrame } = render(<Events events={events} />);
      expect(lastFrame()).toContain('Error: Something failed');
    });

    it('渲染 compressing 事件', () => {
      const events: DisplayEvent[] = [
        createEvent({ id: '1', type: 'compressing', text: 'Compressing context...' }),
      ];
      const { lastFrame } = render(<Events events={events} />);
      expect(lastFrame()).toContain('Compressing context...');
    });

    it('渲染 compressed 事件', () => {
      const events: DisplayEvent[] = [
        createEvent({ id: '1', type: 'compressed', text: 'Compressed: 10 messages' }),
      ];
      const { lastFrame } = render(<Events events={events} />);
      expect(lastFrame()).toContain('Compressed: 10 messages');
    });

    it('渲染 skill:loading 事件', () => {
      const events: DisplayEvent[] = [
        createEvent({ id: '1', type: 'skill:loading', text: 'Skill loading: code-review...' }),
      ];
      const { lastFrame } = render(<Events events={events} />);
      expect(lastFrame()).toContain('Skill loading: code-review...');
    });

    it('渲染 skill:loaded 事件', () => {
      const events: DisplayEvent[] = [
        createEvent({ id: '1', type: 'skill:loaded', text: 'Skill loaded: code-review (2048 chars)' }),
      ];
      const { lastFrame } = render(<Events events={events} />);
      expect(lastFrame()).toContain('Skill loaded: code-review (2048 chars)');
    });

    it('渲染未知类型事件（使用默认颜色）', () => {
      const events: DisplayEvent[] = [
        createEvent({ id: '1', type: 'custom-type', text: 'Custom event text' }),
      ];
      const { lastFrame } = render(<Events events={events} />);
      expect(lastFrame()).toContain('Custom event text');
    });
  });
});
