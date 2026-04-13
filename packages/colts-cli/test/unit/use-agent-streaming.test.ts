/**
 * @fileoverview useAgent streaming logic unit tests
 *
 * Tests parseCommand + simulated streaming logic, verifying TimelineEntry state updates.
 */

import { describe, it, expect, vi } from 'vitest';
import type { AgentState, StreamEvent } from '@agentskillmania/colts';
import { parseCommand } from '../../src/hooks/use-agent.js';
import type { TimelineEntry } from '../../src/types/timeline.js';
import { filterByDetailLevel } from '../../src/types/timeline.js';

describe('useAgent streaming logic', () => {
  describe('parseCommand', () => {
    it('should parse all command types', () => {
      expect(parseCommand('/run').type).toBe('mode-run');
      expect(parseCommand('/step').type).toBe('mode-step');
      expect(parseCommand('/advance').type).toBe('mode-advance');
      expect(parseCommand('/clear').type).toBe('clear');
      expect(parseCommand('/help').type).toBe('help');
      expect(parseCommand('/skill test').type).toBe('skill');
      expect(parseCommand('hello').type).toBe('message');
      expect(parseCommand('/show:compact').type).toBe('show-compact');
      expect(parseCommand('/show:detail').type).toBe('show-detail');
      expect(parseCommand('/show:verbose').type).toBe('show-verbose');
    });

    it('should extract /skill argument', () => {
      const cmd = parseCommand('/skill my-skill');
      expect(cmd.skillName).toBe('my-skill');
    });

    it('/skill without argument matches skill type', () => {
      const cmd = parseCommand('/skill');
      expect(cmd.type).toBe('skill');
      expect(cmd.skillName).toBeUndefined();
    });

    it('/skill trailing space equals no argument', () => {
      const cmd = parseCommand('/skill ');
      expect(cmd.type).toBe('skill');
      expect(cmd.skillName).toBeUndefined();
    });
  });

  describe('TimelineEntry state update simulation', () => {
    it('simulates token accumulation to assistant entry', () => {
      const assistantId = 'asst-1';
      let entries: TimelineEntry[] = [
        {
          type: 'assistant',
          id: assistantId,
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
        },
      ];

      // Simulate token events
      const tokens = ['Hello', ' world'];
      let accumulated = '';
      for (const token of tokens) {
        accumulated += token;
        entries = entries.map((e) =>
          e.type === 'assistant' && e.id === assistantId ? { ...e, content: accumulated } : e
        );
      }

      expect(entries[0].type).toBe('assistant');
      const asstEntry = entries[0] as Extract<TimelineEntry, { type: 'assistant' }>;
      expect(asstEntry.content).toBe('Hello world');
      expect(asstEntry.isStreaming).toBe(true);
    });

    it('simulates tool:start + tool:end entries', () => {
      let entries: TimelineEntry[] = [];

      // tool:start
      const toolId = 'tool-1';
      entries = [
        ...entries,
        { type: 'tool', id: toolId, tool: 'read_file', isRunning: true, timestamp: Date.now() },
      ];

      // tool:end — update most recent running tool
      const idx = entries.findLastIndex
        ? entries.findLastIndex((e) => e.type === 'tool' && e.isRunning)
        : (() => {
            for (let i = entries.length - 1; i >= 0; i--) {
              const e = entries[i];
              if (e.type === 'tool' && e.isRunning) return i;
            }
            return -1;
          })();
      if (idx >= 0) {
        entries = entries.map((e, i) =>
          i === idx ? { ...e, result: 'file content', isRunning: false } : e
        );
      }

      expect(entries).toHaveLength(1);
      const toolEntry = entries[0] as Extract<TimelineEntry, { type: 'tool' }>;
      expect(toolEntry.tool).toBe('read_file');
      expect(toolEntry.result).toBe('file content');
      expect(toolEntry.isRunning).toBe(false);
    });

    it('simulates stepStream token accumulation', () => {
      const events: StreamEvent[] = [
        { type: 'token', token: 'Step ' },
        { type: 'token', token: 'result' },
        {
          type: 'tool:start',
          action: { id: 'a1', tool: 'read_file', arguments: { path: '/test' } },
        },
      ];

      let accumulated = '';
      const tools: string[] = [];

      for (const event of events) {
        if (event.type === 'token' && event.token) accumulated += event.token;
        if (event.type === 'tool:start') tools.push(event.action.tool);
      }

      expect(accumulated).toBe('Step result');
      expect(tools).toEqual(['read_file']);
    });

    it('simulates advanceStream phase changes', () => {
      const events: StreamEvent[] = [
        { type: 'phase-change', from: { type: 'idle' }, to: { type: 'calling-llm' } },
        { type: 'token', token: 'thinking...' },
        { type: 'phase-change', from: { type: 'calling-llm' }, to: { type: 'executing-tool' } },
      ];

      const phases: string[] = [];
      let tokens = '';

      for (const event of events) {
        if (event.type === 'phase-change') phases.push(`${event.from.type}->${event.to.type}`);
        if (event.type === 'token' && event.token) tokens += event.token;
      }

      expect(phases).toEqual(['idle->calling-llm', 'calling-llm->executing-tool']);
      expect(tokens).toBe('thinking...');
    });
  });

  describe('Full conversation flow simulation', () => {
    it('user message + assistant streaming + completion', () => {
      const assistantId = 'asst-1';
      let entries: TimelineEntry[] = [
        { type: 'user', id: 'user-1', content: 'What is 2+2?', timestamp: Date.now() },
        {
          type: 'assistant',
          id: assistantId,
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
        },
      ];

      // Simulate streaming tokens
      const tokens = ['2+2', ' equals 4'];
      let accumulated = '';
      for (const token of tokens) {
        accumulated += token;
        entries = entries.map((e) =>
          e.type === 'assistant' && e.id === assistantId ? { ...e, content: accumulated } : e
        );
      }

      // Simulate completion
      entries = entries.map((e) =>
        e.type === 'assistant' && e.id === assistantId ? { ...e, isStreaming: false } : e
      );

      expect(entries).toHaveLength(2);
      const user = entries[0] as Extract<TimelineEntry, { type: 'user' }>;
      const asst = entries[1] as Extract<TimelineEntry, { type: 'assistant' }>;
      expect(user.content).toBe('What is 2+2?');
      expect(asst.content).toBe('2+2 equals 4');
      expect(asst.isStreaming).toBe(false);
    });

    it('DetailLevel filtering correctness', () => {
      const entries: TimelineEntry[] = [
        { type: 'user', id: '1', content: 'hi', timestamp: Date.now() },
        { type: 'phase', id: '2', from: 'idle', to: 'calling-llm', timestamp: Date.now() },
        { type: 'assistant', id: '3', content: 'hello', timestamp: Date.now() },
        { type: 'thought', id: '4', content: 'thinking', timestamp: Date.now() },
      ];

      const compact = filterByDetailLevel(entries, 'compact');
      expect(compact.map((e) => e.type)).toEqual(['user', 'assistant']);

      const verbose = filterByDetailLevel(entries, 'verbose');
      expect(verbose.map((e) => e.type)).toEqual(['user', 'phase', 'assistant', 'thought']);
    });
  });
});
