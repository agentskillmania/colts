/**
 * @fileoverview TimelinePanel component unit tests
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { TimelinePanel } from '../../../src/components/timeline/timeline-panel.js';
import type { TimelineEntry } from '../../../src/types/timeline.js';

describe('TimelinePanel', () => {
  it('renders null for empty entries', () => {
    const { lastFrame } = render(<TimelinePanel entries={[]} detailLevel="compact" />);
    expect(lastFrame()).toBe('');
  });

  it('renders null when all entries are filtered out in compact', () => {
    const entries: TimelineEntry[] = [
      { type: 'phase', id: 'p1', from: 'idle', to: 'calling-llm', timestamp: 1000 },
      { type: 'thought', id: 't1', content: 'hmm', timestamp: 1000 },
    ];
    const { lastFrame } = render(<TimelinePanel entries={entries} detailLevel="compact" />);
    expect(lastFrame()).toBe('');
  });

  it('compact mode renders visible entries and hides invisible ones', () => {
    const entries: TimelineEntry[] = [
      { type: 'user', id: 'u1', content: 'Hello', timestamp: 1000 },
      { type: 'phase', id: 'p1', from: 'idle', to: 'calling-llm', timestamp: 1000 },
      { type: 'assistant', id: 'a1', content: 'Hi', timestamp: 1000 },
      { type: 'thought', id: 't1', content: 'thinking', timestamp: 1000 },
    ];
    const { lastFrame } = render(<TimelinePanel entries={entries} detailLevel="compact" />);
    const frame = lastFrame();
    // user and assistant are visible
    expect(frame).toContain('Hello');
    expect(frame).toContain('Hi');
    // phase and thought are hidden in compact
    expect(frame).not.toContain('idle');
    expect(frame).not.toContain('thinking');
  });

  it('detail mode additionally shows step-start, step-end, and compress', () => {
    const entries: TimelineEntry[] = [
      { type: 'step-start', id: 'ss1', step: 0, timestamp: 1000 },
      {
        type: 'step-end',
        id: 'se1',
        step: 0,
        result: { type: 'done', answer: 'ok' },
        timestamp: 1000,
      },
      { type: 'compress', id: 'c1', status: 'compressing', timestamp: 1000 },
      { type: 'phase', id: 'p1', from: 'idle', to: 'preparing', timestamp: 1000 },
    ];
    const { lastFrame } = render(<TimelinePanel entries={entries} detailLevel="detail" />);
    const frame = lastFrame();
    // visible in detail
    expect(frame).toContain('Step 0');
    expect(frame).toContain('Compressing');
    // invisible in detail
    expect(frame).not.toContain('idle');
  });

  it('verbose mode shows all entries', () => {
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

  it('renders mixed entry types in order', () => {
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
    // preserves order
    expect(firstIdx).toBeLessThan(readIdx);
    expect(readIdx).toBeLessThan(secondIdx);
  });

  it('renders a single entry normally', () => {
    const entries: TimelineEntry[] = [
      { type: 'system', id: 's1', content: 'Ready', timestamp: 1000 },
    ];
    const { lastFrame } = render(<TimelinePanel entries={entries} detailLevel="compact" />);
    expect(lastFrame()).toContain('Ready');
  });
});
