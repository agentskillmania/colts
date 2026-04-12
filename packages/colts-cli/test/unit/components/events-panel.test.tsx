/**
 * @fileoverview EventsPanel unit tests
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { EventsPanel } from '../../../src/components/events/events-panel.js';
import type { DisplayEvent } from '../../../src/hooks/use-events.js';

/** Create a test display event */
function createEvent(overrides: Partial<DisplayEvent> = {}): DisplayEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    type: 'phase-change',
    text: 'Phase: idle → calling-llm',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('EventsPanel', () => {
  it('shows placeholder when no events', () => {
    const { lastFrame } = render(<EventsPanel events={[]} />);
    expect(lastFrame()).toContain('No events yet.');
  });

  it('renders events as text', () => {
    const events = [
      createEvent({ id: '1', type: 'phase-change', text: 'Phase: idle → calling-llm' }),
      createEvent({ id: '2', type: 'token', text: 'Hello' }),
      createEvent({ id: '3', type: 'tool:start', text: 'Tool: read_file' }),
    ];
    const { lastFrame } = render(<EventsPanel events={events} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Phase: idle → calling-llm');
    expect(frame).toContain('Hello');
    expect(frame).toContain('Tool: read_file');
  });

  it('shows overflow message when events exceed max', () => {
    // MAX_VISIBLE_EVENTS = 200, create 203
    const events: DisplayEvent[] = Array.from({ length: 203 }, (_, i) =>
      createEvent({ id: `e${i}`, text: `Event ${i}` })
    );
    const { lastFrame } = render(<EventsPanel events={events} />);
    const frame = lastFrame()!;
    // 3 overflow
    expect(frame).toContain('3 earlier events');
    // Most recent visible
    expect(frame).toContain('Event 202');
    // Overflow events not shown
    expect(frame).not.toContain('Event 0');
  });

  it('does not show overflow when within limit', () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      createEvent({ id: `e${i}`, text: `Event ${i}` })
    );
    const { lastFrame } = render(<EventsPanel events={events} />);
    expect(lastFrame()).not.toContain('earlier event');
  });
});
