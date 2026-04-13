/**
 * @fileoverview Events Hook — Event stream buffering and formatting
 *
 * Manages event streams from agent execution with 100ms batch rendering to prevent terminal flickering.
 * Converts StreamEvent to displayable DisplayEvent format.
 */

import { useState, useCallback, useRef } from 'react';
import type { StreamEvent } from '@agentskillmania/colts';

/**
 * Displayable event
 */
export interface DisplayEvent {
  /** Unique event identifier */
  id: string;
  /** Event type */
  type: string;
  /** Formatted display text */
  text: string;
  /** Timestamp in milliseconds */
  timestamp: number;
  /** Indentation level (for hierarchical display) */
  indent?: number;
}

/** Batch rendering delay in milliseconds */
const BATCH_DELAY_MS = 100;

/**
 * Format a StreamEvent as displayable text
 *
 * Generates human-readable descriptions based on event type.
 *
 * @param event - Raw StreamEvent
 * @returns Formatted text
 */
export function formatEvent(event: StreamEvent): string {
  switch (event.type) {
    case 'phase-change':
      return `Phase: ${event.from.type} → ${event.to.type}`;
    case 'token':
      return event.token;
    case 'tool:start':
      return `Tool: ${event.action.tool}`;
    case 'tool:end': {
      const resultText =
        typeof event.result === 'string'
          ? event.result.slice(0, 50)
          : JSON.stringify(event.result).slice(0, 50);
      return `Result: ${resultText}`;
    }
    case 'error':
      return `Error: ${event.error.message}`;
    case 'compressing':
      return 'Compressing context...';
    case 'compressed':
      return `Compressed: ${event.removedCount} messages`;
    // Skill events
    case 'skill:loading':
      return `Skill loading: ${event.name}...`;
    case 'skill:loaded':
      return `Skill loaded: ${event.name} (${event.tokenCount} chars)`;
    // Sub-agent events
    case 'subagent:start':
      return `[${event.name}] Starting: ${event.task}`;
    case 'subagent:end':
      return `[${event.name}] Done`;
    default:
      return JSON.stringify(event);
  }
}

/**
 * Return value of useEvents hook
 */
export interface UseEventsReturn {
  /** Current event list */
  events: DisplayEvent[];
  /** Add event (auto batch rendering) */
  addEvent: (event: StreamEvent) => void;
  /** Clear events */
  clearEvents: () => void;
}

/**
 * Event stream management hook
 *
 * Converts StreamEvents to DisplayEvents and uses a 100ms timer for batch rendering
 * to prevent terminal flickering from high-frequency events.
 *
 * @returns Event management interface
 *
 * @example
 * ```tsx
 * const { events, addEvent, clearEvents } = useEvents();
 *
 * // Add events during agent streaming execution
 * for await (const event of runner.runStream(state)) {
 *   addEvent(event);
 * }
 * ```
 */
export function useEvents(): UseEventsReturn {
  const [events, setEvents] = useState<DisplayEvent[]>([]);
  const bufferRef = useRef<DisplayEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Flush buffered events to state in batch */
  const flushEvents = useCallback(() => {
    if (bufferRef.current.length > 0) {
      setEvents((prev) => [...prev, ...bufferRef.current]);
      bufferRef.current = [];
    }
    timerRef.current = null;
  }, []);

  /**
   * Add event to buffer
   *
   * Events are first stored in a buffer and flushed to state after 100ms.
   * If a timer is already running, new events will be processed in the next flush.
   *
   * @param event - StreamEvent to add
   */
  const addEvent = useCallback(
    (event: StreamEvent) => {
      const displayEvent: DisplayEvent = {
        id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
        type: event.type,
        text: formatEvent(event),
        timestamp: Date.now(),
      };

      bufferRef.current.push(displayEvent);

      // Start batch rendering timer
      if (!timerRef.current) {
        timerRef.current = setTimeout(flushEvents, BATCH_DELAY_MS);
      }
    },
    [flushEvents]
  );

  /** Clear all events and cancel timer */
  const clearEvents = useCallback(() => {
    setEvents([]);
    bufferRef.current = [];
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return { events, addEvent, clearEvents };
}
