/**
 * Event stream end-to-end integration tests
 *
 * User Story: Event Stream End-to-End
 * As a TUI developer, I want StreamEvents produced by AgentRunner to be correctly formatted and buffered,
 * so they can be displayed in the events panel.
 *
 * Tests formatEvent for all event types, event buffer timed flush, unique IDs and the complete flow.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { formatEvent, useEvents } from '../../src/hooks/use-events.js';
import type { StreamEvent } from '@agentskillmania/colts';

describe('Event stream end-to-end', () => {
  describe('formatEvent event type coverage', () => {
    /**
     * Scenario 1: formatEvent correctly handles all event types
     */

    it('formats phase-change event', () => {
      const event: StreamEvent = {
        type: 'phase-change',
        from: { type: 'idle' },
        to: { type: 'calling-llm' },
      };
      expect(formatEvent(event)).toBe('Phase: idle → calling-llm');
    });

    it('formats token event', () => {
      const event: StreamEvent = {
        type: 'token',
        token: 'Hello world',
      };
      expect(formatEvent(event)).toBe('Hello world');
    });

    it('formats tool:start event', () => {
      const event: StreamEvent = {
        type: 'tool:start',
        action: {
          id: 'call_123',
          tool: 'file-reader',
          arguments: { path: '/tmp/test.txt' },
        },
      };
      expect(formatEvent(event)).toBe('Tool: file-reader');
    });

    it('formats tool:end event (string result)', () => {
      const event: StreamEvent = {
        type: 'tool:end',
        result: 'This is a very long tool execution result that needs to be truncated for display',
      };
      const text = formatEvent(event);
      expect(text).toContain('Result: ');
      // String result is truncated to 50 characters
      expect(text.length).toBeLessThanOrEqual('Result: '.length + 50);
    });

    it('formats tool:end event (object result)', () => {
      const event: StreamEvent = {
        type: 'tool:end',
        result: { files: ['a.ts', 'b.ts'], count: 2 },
      };
      const text = formatEvent(event);
      expect(text).toContain('Result: ');
      expect(text).toContain('files');
    });

    it('formats error event', () => {
      const event: StreamEvent = {
        type: 'error',
        error: new Error('Connection timeout'),
        context: { step: 3, toolName: 'http-client' },
      };
      expect(formatEvent(event)).toBe('Error: Connection timeout');
    });

    it('formats compressing event', () => {
      const event: StreamEvent = {
        type: 'compressing',
      };
      expect(formatEvent(event)).toBe('Compressing context...');
    });

    it('formats compressed event', () => {
      const event: StreamEvent = {
        type: 'compressed',
        summary: 'Summary content',
        removedCount: 42,
      };
      expect(formatEvent(event)).toBe('Compressed: 42 messages');
    });

    it('formats skill:loading event', () => {
      const event: StreamEvent = {
        type: 'skill:loading',
        name: 'code-review',
      };
      expect(formatEvent(event)).toBe('Skill loading: code-review...');
    });

    it('formats skill:loaded event', () => {
      const event: StreamEvent = {
        type: 'skill:loaded',
        name: 'code-review',
        tokenCount: 4096,
      };
      expect(formatEvent(event)).toBe('Skill loaded: code-review (4096 chars)');
    });

    it('formats subagent:start event', () => {
      const event: StreamEvent = {
        type: 'subagent:start',
        name: 'researcher',
        task: 'Search latest docs',
      };
      expect(formatEvent(event)).toBe('[researcher] Starting: Search latest docs');
    });

    it('formats subagent:token event', () => {
      const event: StreamEvent = {
        type: 'subagent:token',
        name: 'researcher',
        token: 'Analyzing...',
      };
      expect(formatEvent(event)).toBe('[researcher] Analyzing...');
    });

    it('formats subagent:step:end event', () => {
      const event: StreamEvent = {
        type: 'subagent:step:end',
        name: 'researcher',
        step: 7,
      };
      expect(formatEvent(event)).toBe('[researcher] Step 7 complete');
    });

    it('formats subagent:end event', () => {
      const event: StreamEvent = {
        type: 'subagent:end',
        name: 'researcher',
        result: { answer: 'Done', totalSteps: 7, finalState: null },
      };
      expect(formatEvent(event)).toBe('[researcher] Done');
    });
  });

  /**
   * Scenario 2: formatEvent handles unknown event types using JSON.stringify fallback
   */
  it('formatEvent returns JSON string for unknown event types', () => {
    const unknownEvent = {
      type: 'custom-unknown-type',
      data: { foo: 'bar', nested: { value: 42 } },
    } as unknown as StreamEvent;

    const text = formatEvent(unknownEvent);
    expect(text).toContain('custom-unknown-type');
    expect(text).toContain('foo');
    // Should be a valid JSON string
    expect(() => JSON.parse(text)).not.toThrow();
  });

  describe('useEvents hook event buffering', () => {
    /**
     * Create a test wrapper component that uses the useEvents hook.
     *
     * Uses a reactive container object to hold hook return values.
     * Each time React re-renders, hookResult in the container is updated.
     * Since useEvents manages events via useState, after flushEvents triggers
     * setState the component re-renders and hookResult points to the latest return value.
     */
    function createWrapper() {
      // Use mutable container to ensure latest hook return value on each render
      const container: { current: ReturnType<typeof useEvents> | null } = {
        current: null,
      };

      function Wrapper() {
        // Every render (including setState-triggered re-renders) updates container.current
        container.current = useEvents();
        return null;
      }

      return {
        Wrapper,
        /** Get the latest hook return value */
        getHook: () => container.current!,
      };
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * Scenario 3: Event buffer flushes after 100ms (using vi.useFakeTimers)
     */
    it('Event buffer flushes after 100ms', () => {
      const { Wrapper, getHook } = createWrapper();
      render(<Wrapper />);

      // Add event, now in the buffer
      getHook().addEvent({ type: 'token', token: 'buffer test' } as StreamEvent);

      // Timer not yet triggered, events still empty
      expect(getHook().events).toEqual([]);

      // Advance 100ms to trigger flush (React setState causes re-render, hook return value updates)
      vi.advanceTimersByTime(100);

      // Flushed events should appear in the list
      expect(getHook().events).toHaveLength(1);
      expect(getHook().events[0].text).toBe('buffer test');
    });

    /**
     * Scenario 4: Rapidly adding multiple events → single flush
     */
    it('Single flush after rapidly adding multiple events', () => {
      const { Wrapper, getHook } = createWrapper();
      render(<Wrapper />);

      // Rapidly add 5 events
      getHook().addEvent({ type: 'token', token: 'Event 1' } as StreamEvent);
      getHook().addEvent({ type: 'token', token: 'Event 2' } as StreamEvent);
      getHook().addEvent({ type: 'token', token: 'Event 3' } as StreamEvent);
      getHook().addEvent({ type: 'token', token: 'Event 4' } as StreamEvent);
      getHook().addEvent({ type: 'token', token: 'Event 5' } as StreamEvent);

      // Advance 100ms, should trigger only one flush, but all events should be flushed
      vi.advanceTimersByTime(100);

      // All 5 events should appear together in the list
      expect(getHook().events).toHaveLength(5);
      expect(getHook().events[0].text).toBe('Event 1');
      expect(getHook().events[4].text).toBe('Event 5');
    });

    /**
     * Scenario 5: clearEvents cancels pending timers
     */
    it('clearEvents cancels pending timers', () => {
      const { Wrapper, getHook } = createWrapper();
      render(<Wrapper />);

      // Add event, starts 100ms timer
      getHook().addEvent({ type: 'token', token: 'to be cleared' } as StreamEvent);

      // Clear events before timer triggers
      getHook().clearEvents();

      // Advance time past 100ms
      vi.advanceTimersByTime(200);

      // Event list should be empty (timer cancelled, buffer cleared)
      expect(getHook().events).toEqual([]);
    });

    /**
     * Scenario 6: Events have unique IDs
     */
    it('Each event has a unique ID', () => {
      const { Wrapper, getHook } = createWrapper();
      render(<Wrapper />);

      // Add multiple events of the same type
      getHook().addEvent({ type: 'token', token: 'A' } as StreamEvent);
      getHook().addEvent({ type: 'token', token: 'B' } as StreamEvent);
      getHook().addEvent({ type: 'token', token: 'C' } as StreamEvent);

      vi.advanceTimersByTime(100);

      const events = getHook().events;
      expect(events).toHaveLength(3);

      // All IDs should be unique
      const ids = events.map((e) => e.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);

      // IDs should not be empty
      for (const id of ids) {
        expect(id).toBeTruthy();
        expect(typeof id).toBe('string');
      }
    });
  });
});
