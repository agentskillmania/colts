/**
 * @fileoverview EventItem unit tests
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { EventItem } from '../../../src/components/events/event-item.js';
import type { DisplayEvent } from '../../../src/hooks/use-events.js';

/** Create a test display event */
function createEvent(overrides: Partial<DisplayEvent> = {}): DisplayEvent {
  return {
    id: 'test-id',
    type: 'token',
    text: 'test text',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('EventItem', () => {
  it('renders event text', () => {
    const { lastFrame } = render(<EventItem event={createEvent({ text: 'Phase: idle → calling-llm' })} />);
    expect(lastFrame()).toContain('Phase: idle → calling-llm');
  });

  it('renders icon for tool:start events', () => {
    const { lastFrame } = render(<EventItem event={createEvent({ type: 'tool:start', text: 'Tool: read_file' })} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Tool: read_file');
    // Should contain the gear icon
    expect(frame).toContain('\u2699'); // ⚙
  });

  it('renders icon for phase-change events', () => {
    const { lastFrame } = render(<EventItem event={createEvent({ type: 'phase-change', text: 'Phase: idle → calling-llm' })} />);
    expect(lastFrame()).toContain('\u25B6'); // ▶
  });

  it('renders icon for error events', () => {
    const { lastFrame } = render(<EventItem event={createEvent({ type: 'error', text: 'Error: timeout' })} />);
    expect(lastFrame()).toContain('\u2717'); // ✗
  });

  it('renders icon for tool:end events', () => {
    const { lastFrame } = render(<EventItem event={createEvent({ type: 'tool:end', text: 'Result: ok' })} />);
    expect(lastFrame()).toContain('\u2713'); // ✓
  });

  it('renders icon for skill events', () => {
    const { lastFrame } = render(<EventItem event={createEvent({ type: 'skill:loading', text: 'Skill loading: test' })} />);
    expect(lastFrame()).toContain('\u2605'); // ★
  });

  it('renders no icon for token events', () => {
    const frame = render(<EventItem event={createEvent({ type: 'token', text: 'hello' })} />).lastFrame()!;
    expect(frame).toContain('hello');
    // No special icon for token events
    expect(frame).not.toContain('\u2699');
    expect(frame).not.toContain('\u25B6');
  });

  it('renders indentation for nested events', () => {
    const { lastFrame } = render(
      <EventItem event={createEvent({ type: 'subagent:token', text: 'working...', indent: 2 })} />
    );
    const frame = lastFrame()!;
    // Indent = 2 means "    " (4 spaces)
    expect(frame).toContain('    working...');
  });
});
