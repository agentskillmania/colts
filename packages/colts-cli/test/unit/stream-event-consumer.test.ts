/**
 * @fileoverview StreamEventConsumer unit tests
 *
 * Tests StreamEvent → TimelineEntry conversion logic, including:
 * - token accumulation and throttling
 * - tool lifecycle (start/end)
 * - phase-change events
 * - skill / subagent / step events
 * - onToolEnd / onPhaseChange hook callbacks
 * - resetAssistant / finalizeAssistant / flush / disposed states
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RunStreamEvent } from '@agentskillmania/colts';
import { StreamEventConsumer } from '../../src/hooks/stream-event-consumer.js';
import type { TimelineEntry } from '../../src/types/timeline.js';

// ── Helpers ──

/**
 * Create a tracker that simulates React setState
 *
 * React's setState(updater) passes the previous state to the updater function.
 * This helper maintains an internal entries array; each time setter is called:
 * - If function, pass previous state and collect return value as new state
 * - If value, use directly as new state
 *
 * @returns { setter, allEntries, lastEntries, clear }
 */
function trackEntries() {
  let current: TimelineEntry[] = [];
  const setter = vi.fn((action: React.SetStateAction<TimelineEntry[]>) => {
    if (typeof action === 'function') {
      current = (action as (prev: TimelineEntry[]) => TimelineEntry[])(current);
    } else {
      current = action;
    }
  });
  return {
    setter,
    /** Get entries snapshot after last setter call */
    get lastEntries(): TimelineEntry[] {
      return current;
    },
    /** Reset internal state */
    clear() {
      current = [];
    },
  };
}

/** Create mock setState */
function trackState() {
  let current: unknown = null;
  const setter = vi.fn((action: any) => {
    if (typeof action === 'function') {
      current = action(current);
    } else {
      current = action;
    }
  });
  return {
    setter,
    get lastState(): unknown {
      return current;
    },
  };
}

// ── Event constructors ──

function tokenEvent(token: string): RunStreamEvent {
  return { type: 'token', token };
}

function toolStartEvent(tool: string, args?: Record<string, unknown>): RunStreamEvent {
  return {
    type: 'tool:start',
    action: { id: `call-${tool}`, tool, arguments: args ?? {} },
  };
}

function toolEndEvent(result: unknown): RunStreamEvent {
  return { type: 'tool:end', result };
}

function phaseChangeEvent(from: string, to: string): RunStreamEvent {
  return {
    type: 'phase-change',
    from: { type: from } as any,
    to: { type: to } as any,
  };
}

function errorEvent(msg: string): RunStreamEvent {
  return {
    type: 'error',
    error: new Error(msg),
    context: { step: 1 },
  };
}

function compressingEvent(): RunStreamEvent {
  return { type: 'compressing' };
}

function compressedEvent(summary: string, removedCount: number): RunStreamEvent {
  return { type: 'compressed', summary, removedCount };
}

// ── Test cases ──

describe('StreamEventConsumer', () => {
  let entries: ReturnType<typeof trackEntries>;
  let state: ReturnType<typeof trackState>;

  beforeEach(() => {
    vi.useFakeTimers();
    entries = trackEntries();
    state = trackState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Basic lifecycle ──

  describe('Construction and initial state', () => {
    it('does not auto-create assistant entry on construction (caller resets assistant)', () => {
      new StreamEventConsumer(entries.setter, state.setter);
      // Constructor only initializes assistantId, does not create entry
      expect(entries.lastEntries).toHaveLength(0);
    });

    it('getAccumulatedContent initially empty string', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      expect(consumer.getAccumulatedContent()).toBe('');
    });

    it('getAssistantId returns valid ID', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      expect(consumer.getAssistantId()).toBeTruthy();
    });
  });

  // ── Token accumulation ──

  describe('Token events', () => {
    it('single token accumulates then flush writes to assistant entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.resetAssistant();

      consumer.consume(tokenEvent('Hello'));
      consumer.flush();

      expect(consumer.getAccumulatedContent()).toBe('Hello');
      const asst = entries.lastEntries.find((e) => e.type === 'assistant');
      expect(asst).toBeDefined();
      if (asst?.type === 'assistant') {
        expect(asst.content).toBe('Hello');
      }
    });

    it('multiple tokens accumulate continuously', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(tokenEvent('Hello'));
      consumer.consume(tokenEvent(' '));
      consumer.consume(tokenEvent('world'));
      consumer.flush();

      expect(consumer.getAccumulatedContent()).toBe('Hello world');
    });

    it('empty token does not trigger any update', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(tokenEvent(''));

      expect(consumer.getAccumulatedContent()).toBe('');
      // Empty token does not call throttledFlush; only construction has no setter call
    });

    it('pure whitespace token does not create assistant entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(tokenEvent('\n'));
      consumer.consume(tokenEvent(' '));
      consumer.consume(tokenEvent('\n'));

      // Pure whitespace content does not trigger ensureAssistantInserted
      const assistants = entries.lastEntries.filter((e) => e.type === 'assistant');
      expect(assistants).toHaveLength(0);
      expect(consumer.getAccumulatedContent()).toBe('\n \n');
    });

    it('creates entry only when whitespace token is followed by content token', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(tokenEvent('\n'));
      consumer.consume(tokenEvent('Hello'));

      // Second token has non-whitespace content, entry created at this point
      const asst = entries.lastEntries.find((e) => e.type === 'assistant');
      expect(asst).toBeDefined();
      if (asst?.type === 'assistant') {
        expect(asst.content).toBe('\nHello');
      }
    });

    it('throttling: consecutive tokens schedule only one delayed flush within 50ms', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      const beforeCount = entries.setter.mock.calls.length;

      consumer.consume(tokenEvent('a'));
      consumer.consume(tokenEvent('b'));
      consumer.consume(tokenEvent('c'));

      // During throttling, accumulated content is correct
      expect(consumer.getAccumulatedContent()).toBe('abc');

      // Advance time to let throttle trigger; should have one new setter call
      vi.advanceTimersByTime(60);
      expect(entries.setter.mock.calls.length).toBeGreaterThan(beforeCount);
    });

    it('flush forces immediate refresh after throttling', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(tokenEvent('a'));
      consumer.consume(tokenEvent('b'));

      // Do not advance time; flush directly to bypass throttling
      consumer.flush();

      const asst = entries.lastEntries.find((e) => e.type === 'assistant');
      if (asst?.type === 'assistant') {
        expect(asst.content).toBe('ab');
      }
    });
  });

  // ── Tool lifecycle ──

  describe('tool:start events', () => {
    it('creates tool entry and stops assistant streaming', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume(tokenEvent('thinking...'));

      consumer.consume(toolStartEvent('read_file', { path: '/test' }));

      const tool = entries.lastEntries.find((e) => e.type === 'tool');
      expect(tool).toBeDefined();
      if (tool?.type === 'tool') {
        expect(tool.tool).toBe('read_file');
        expect(tool.isRunning).toBe(true);
        expect(tool.args).toEqual({ path: '/test' });
      }
    });

    it('flushes residual tokens then stops assistant streaming', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume(tokenEvent('partial'));

      consumer.consume(toolStartEvent('search'));

      // assistant should be isStreaming=false, content='partial'
      const asst = entries.lastEntries.find((e) => e.type === 'assistant');
      if (asst?.type === 'assistant') {
        expect(asst.isStreaming).toBe(false);
        expect(asst.content).toBe('partial');
      }
    });

    it('does not create empty assistant entry on tool:start when no tokens', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      // LLM calls tool directly without speaking
      consumer.consume(toolStartEvent('search'));

      const assistants = entries.lastEntries.filter((e) => e.type === 'assistant');
      expect(assistants).toHaveLength(0);

      const tools = entries.lastEntries.filter((e) => e.type === 'tool');
      expect(tools).toHaveLength(1);
    });
  });

  describe('tool:end events', () => {
    it('updates tool entry result and marks isRunning=false', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume(toolStartEvent('read_file'));

      consumer.consume(toolEndEvent('file content here'));

      const tool = entries.lastEntries.find((e) => e.type === 'tool');
      if (tool?.type === 'tool') {
        expect(tool.result).toBe('file content here');
        expect(tool.isRunning).toBe(false);
      }
    });

    it('triggers onToolEnd hook', () => {
      const onToolEnd = vi.fn();
      const consumer = new StreamEventConsumer(entries.setter, state.setter, { onToolEnd });

      consumer.consume(toolStartEvent('read_file'));
      consumer.consume(toolEndEvent('result'));

      expect(onToolEnd).toHaveBeenCalledTimes(1);
    });

    it('multiple tools start/end in sequence, each updates correctly', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(toolStartEvent('tool_a'));
      consumer.consume(toolEndEvent('result_a'));
      consumer.consume(toolStartEvent('tool_b'));
      consumer.consume(toolEndEvent('result_b'));

      const tools = entries.lastEntries.filter((e) => e.type === 'tool');
      expect(tools).toHaveLength(2);

      // Second tool result
      if (tools[1]?.type === 'tool') {
        expect(tools[1].result).toBe('result_b');
        expect(tools[1].isRunning).toBe(false);
      }
    });

    it('does not crash when tool:end has no matching tool entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      expect(() => consumer.consume(toolEndEvent('orphan'))).not.toThrow();
    });
  });

  // ── onToolEnd hook (run mode scenario) ──

  describe('onToolEnd hook', () => {
    it('run mode: resetAssistant after tool:end, subsequent tokens write to new assistant', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter, {
        onToolEnd: () => consumer.resetAssistant(),
      });

      // First assistant entry (lazy: created by first token)
      consumer.consume(tokenEvent('thinking'));
      consumer.consume(toolStartEvent('read_file'));
      consumer.consume(toolEndEvent('result'));
      // onToolEnd → resetAssistant(), resets internal state but does not insert new entry immediately

      // New token triggers creation of second assistant entry
      consumer.consume(tokenEvent('second'));
      consumer.flush();

      const assistants = entries.lastEntries.filter((e) => e.type === 'assistant');
      expect(assistants.length).toBeGreaterThanOrEqual(2);
      expect(consumer.getAccumulatedContent()).toBe('second');
    });

    it('run mode: new token writes to new assistant after reset', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter, {
        onToolEnd: () => consumer.resetAssistant(),
      });

      consumer.consume(tokenEvent('first'));
      consumer.consume(toolStartEvent('tool'));
      consumer.consume(toolEndEvent('result'));

      // After resetAssistant
      consumer.consume(tokenEvent('second'));
      consumer.flush();

      expect(consumer.getAccumulatedContent()).toBe('second');
    });
  });

  // ── phase-change events ──

  describe('phase-change events', () => {
    it('creates phase entry and stops assistant streaming', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume(tokenEvent('text'));

      consumer.consume(phaseChangeEvent('idle', 'calling-llm'));

      const phase = entries.lastEntries.find((e) => e.type === 'phase');
      if (phase?.type === 'phase') {
        expect(phase.from).toBe('idle');
        expect(phase.to).toBe('calling-llm');
      }
    });

    it('triggers onPhaseChange hook and passes event', () => {
      const onPhaseChange = vi.fn();
      const consumer = new StreamEventConsumer(entries.setter, state.setter, { onPhaseChange });

      consumer.consume(phaseChangeEvent('idle', 'calling-llm'));

      expect(onPhaseChange).toHaveBeenCalledTimes(1);
      const event = onPhaseChange.mock.calls[0][0];
      expect(event.from.type).toBe('idle');
      expect(event.to.type).toBe('calling-llm');
    });

    it('does not crash on phase-change when no assistant entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(phaseChangeEvent('idle', 'preparing'));

      const phases = entries.lastEntries.filter((e) => e.type === 'phase');
      expect(phases).toHaveLength(1);
      // No assistant entry
      const assistants = entries.lastEntries.filter((e) => e.type === 'assistant');
      expect(assistants).toHaveLength(0);
    });

    it('advance mode: onPhaseChange resetsAssistant at calling-llm', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter, {
        onPhaseChange: (event) => {
          if (event.to.type === 'calling-llm') {
            consumer.resetAssistant();
          }
        },
      });

      // Send token first so first assistant entry exists
      consumer.consume(tokenEvent('text'));
      const assistantsBefore = entries.lastEntries.filter((e) => e.type === 'assistant').length;
      expect(assistantsBefore).toBe(1);

      // calling-llm phase-change triggers resetAssistant (lazy: does not create entry immediately)
      consumer.consume(phaseChangeEvent('preparing', 'calling-llm'));
      const assistantsAfterReset = entries.lastEntries.filter((e) => e.type === 'assistant').length;
      // lazy creation: resetAssistant does not create new entry, assistant count unchanged
      expect(assistantsAfterReset).toBe(1);

      // New token triggers creation of new assistant entry
      consumer.consume(tokenEvent('new-text'));
      const assistantsFinal = entries.lastEntries.filter((e) => e.type === 'assistant').length;
      expect(assistantsFinal).toBe(2);
    });
  });

  // ── error events ──

  describe('error events', () => {
    it('creates error entry and stops assistant streaming', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume(tokenEvent('thinking'));

      consumer.consume(errorEvent('API rate limit'));

      const err = entries.lastEntries.find((e) => e.type === 'error');
      if (err?.type === 'error') {
        expect(err.message).toBe('API rate limit');
      }
    });

    it('flushes residual tokens to assistant before error', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume(tokenEvent('partial text'));

      consumer.consume(errorEvent('fail'));

      // After flush, assistant has partial text
      const asst = entries.lastEntries.find((e) => e.type === 'assistant');
      if (asst?.type === 'assistant') {
        expect(asst.content).toBe('partial text');
      }
    });

    it('does not crash on error when no assistant entry, only creates error entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(errorEvent('unexpected'));

      const err = entries.lastEntries.find((e) => e.type === 'error');
      expect(err).toBeDefined();
      if (err?.type === 'error') {
        expect(err.message).toBe('unexpected');
      }
      // No assistant entry
      const assistants = entries.lastEntries.filter((e) => e.type === 'assistant');
      expect(assistants).toHaveLength(0);
    });
  });

  // ── skill events ──

  describe('skill series events', () => {
    it('skill:start creates active skill entry and updates state', () => {
      const mockState = { id: 'test' } as any;

      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume({ type: 'skill:start', name: 'poet', task: 'write poem', state: mockState });

      expect(state.setter).toHaveBeenCalledWith(mockState);
      const skill = entries.lastEntries.find((e) => e.type === 'skill');
      if (skill?.type === 'skill') {
        expect(skill.name).toBe('poet');
        expect(skill.status).toBe('active');
      }
    });

    it('does not call setState when skill:start state is undefined', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      const callCount = state.setter.mock.calls.length;

      consumer.consume({ type: 'skill:start', name: 'test', task: 't', state: undefined as any });

      expect(state.setter.mock.calls.length).toBe(callCount);
    });

    it('skill:end creates completed skill entry and carries result', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({
        type: 'skill:end',
        name: 'poet',
        result: 'Roses are red',
        state: null as any,
      });

      const skill = entries.lastEntries.find((e) => e.type === 'skill');
      if (skill?.type === 'skill') {
        expect(skill.name).toBe('poet');
        expect(skill.status).toBe('completed');
        expect(skill.result).toBe('Roses are red');
      }
    });

    it('skill:loading creates loading skill entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({ type: 'skill:loading', name: 'my-skill' });

      const skill = entries.lastEntries.find((e) => e.type === 'skill');
      if (skill?.type === 'skill') {
        expect(skill.name).toBe('my-skill');
        expect(skill.status).toBe('loading');
      }
    });

    it('skill:loaded creates loaded skill entry and carries tokenCount', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({ type: 'skill:loaded', name: 'my-skill', tokenCount: 1500 });

      const skill = entries.lastEntries.find((e) => e.type === 'skill');
      if (skill?.type === 'skill') {
        expect(skill.name).toBe('my-skill');
        expect(skill.status).toBe('loaded');
        expect(skill.tokenCount).toBe(1500);
      }
    });

    it('full skill lifecycle: loading → loaded → start → end', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({ type: 'skill:loading', name: 'poet' });
      consumer.consume({ type: 'skill:loaded', name: 'poet', tokenCount: 800 });
      consumer.consume({
        type: 'skill:start',
        name: 'poet',
        task: 'write',
        state: undefined as any,
      });
      consumer.consume({
        type: 'skill:end',
        name: 'poet',
        result: 'A poem',
        state: undefined as any,
      });

      const skills = entries.lastEntries.filter((e) => e.type === 'skill');
      expect(skills).toHaveLength(4);

      const statuses = skills.map((e) => (e as any).status);
      expect(statuses).toEqual(['loading', 'loaded', 'active', 'completed']);
    });
  });

  // ── subagent events ──

  describe('subagent events', () => {
    it('subagent:start creates start entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({ type: 'subagent:start', name: 'researcher', task: 'Find sources' });

      const sa = entries.lastEntries.find((e) => e.type === 'subagent');
      if (sa?.type === 'subagent') {
        expect(sa.name).toBe('researcher');
        expect(sa.task).toBe('Find sources');
        expect(sa.status).toBe('start');
      }
    });

    it('subagent:end creates end entry and carries result', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({
        type: 'subagent:end',
        name: 'researcher',
        result: { answer: 'found 3 sources' } as any,
      });

      const sa = entries.lastEntries.find((e) => e.type === 'subagent');
      if (sa?.type === 'subagent') {
        expect(sa.name).toBe('researcher');
        expect(sa.status).toBe('end');
        expect(sa.result).toEqual({ answer: 'found 3 sources' });
      }
    });
  });

  // ── step events ──

  describe('step events', () => {
    it('step:start creates step-start entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({ type: 'step:start', step: 1, state: null as any });

      const step = entries.lastEntries.find((e) => e.type === 'step-start');
      if (step?.type === 'step-start') {
        expect(step.step).toBe(1);
      }
    });

    it('step:end creates step-end entry and carries result', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({ type: 'step:end', step: 2, result: { type: 'done', answer: '42' } });

      const step = entries.lastEntries.find((e) => e.type === 'step-end');
      if (step?.type === 'step-end') {
        expect(step.step).toBe(2);
        expect(step.result).toEqual({ type: 'done', answer: '42' });
      }
    });
  });

  // ── compress events ──

  describe('compress events', () => {
    it('compressing creates compressing entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(compressingEvent());

      const comp = entries.lastEntries.find((e) => e.type === 'compress');
      if (comp?.type === 'compress') {
        expect(comp.status).toBe('compressing');
      }
    });

    it('compressed creates compressed entry and carries summary and removedCount', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(compressedEvent('Kept key facts', 5));

      const comp = entries.lastEntries.find((e) => e.type === 'compress');
      if (comp?.type === 'compress') {
        expect(comp.status).toBe('compressed');
        expect(comp.summary).toBe('Kept key facts');
        expect(comp.removedCount).toBe(5);
      }
    });
  });

  // ── resetAssistant ──

  describe('resetAssistant', () => {
    it('flushes residual content then creates new assistant entry and resets accumulation', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume(tokenEvent('old content'));

      const oldId = consumer.getAssistantId();
      consumer.resetAssistant();
      const newId = consumer.getAssistantId();

      expect(newId).not.toBe(oldId);
      expect(consumer.getAccumulatedContent()).toBe('');
    });

    it('new token writes to new assistant entry after reset', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(tokenEvent('first'));
      consumer.resetAssistant();
      consumer.consume(tokenEvent('second'));
      consumer.flush();

      expect(consumer.getAccumulatedContent()).toBe('second');
    });
  });

  // ── finalizeAssistant ──

  describe('finalizeAssistant', () => {
    it('marks assistant as isStreaming=false and uses accumulated content', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.consume(tokenEvent('final answer'));

      consumer.finalizeAssistant();

      const asst = entries.lastEntries.find((e) => e.type === 'assistant');
      if (asst?.type === 'assistant') {
        expect(asst.content).toBe('final answer');
        expect(asst.isStreaming).toBe(false);
      }
    });

    it('overrides accumulated content when content parameter is passed', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.resetAssistant();
      consumer.consume(tokenEvent('streaming content'));

      consumer.finalizeAssistant('override content');

      const asst = entries.lastEntries.find(
        (e) => e.type === 'assistant' && (e as any).content === 'override content'
      );
      expect(asst).toBeDefined();
      if (asst?.type === 'assistant') {
        expect(asst.isStreaming).toBe(false);
      }
    });

    it('marks disposed, subsequent consume does not process events', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.finalizeAssistant('done');
      const callCount = entries.setter.mock.calls.length;

      consumer.consume(tokenEvent('after finalize'));
      consumer.consume(toolStartEvent('tool'));

      // consume does not produce new setter calls after disposed
      expect(entries.setter.mock.calls.length).toBe(callCount);
    });

    it('final content is empty string when accumulated content is empty and no parameter passed', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.finalizeAssistant();

      const asst = entries.lastEntries.find((e) => e.type === 'assistant');
      if (asst?.type === 'assistant') {
        expect(asst.content).toBe('');
      }
    });
  });

  // ── flush ──

  describe('flush', () => {
    it('forces refresh of accumulated content, bypassing throttling', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(tokenEvent('hello'));
      // Do not advance time, flush directly
      consumer.flush();

      const asst = entries.lastEntries.find((e) => e.type === 'assistant');
      if (asst?.type === 'assistant') {
        expect(asst.content).toBe('hello');
      }
    });
  });

  // ── Manual operations after disposed ──

  describe('disposed state', () => {
    it('consume does not process any events after finalize', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.finalizeAssistant('done');
      const callCount = entries.setter.mock.calls.length;

      // All event types should not be processed
      consumer.consume(tokenEvent('x'));
      consumer.consume(toolStartEvent('x'));
      consumer.consume(toolEndEvent('x'));
      consumer.consume(phaseChangeEvent('a', 'b'));
      consumer.consume(errorEvent('x'));

      expect(entries.setter.mock.calls.length).toBe(callCount);
    });

    it('resetAssistant / flush can still be called (manual API not restricted by disposed)', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.finalizeAssistant('done');

      // resetAssistant and flush are public APIs, not restricted by disposed
      // Caller needs to manage lifecycle themselves
      expect(() => consumer.resetAssistant()).not.toThrow();
      expect(() => consumer.flush()).not.toThrow();
    });
  });

  // ── Ignored events ──

  describe('Ignored events', () => {
    it('complete event does not produce TimelineEntry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      const callCount = entries.setter.mock.calls.length;

      consumer.consume({
        type: 'complete',
        result: { type: 'success', answer: 'yes', totalSteps: 1 },
      } as RunStreamEvent);

      expect(entries.setter.mock.calls.length).toBe(callCount);
    });

    it('thinking event produces thought entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({
        type: 'thinking',
        content: 'Let me reason about this...',
      } as RunStreamEvent);

      const thought = entries.lastEntries.find((e) => e.type === 'thought');
      expect(thought).toBeDefined();
      if (thought?.type === 'thought') {
        expect(thought.content).toBe('Let me reason about this...');
        expect(thought.seq).toBeGreaterThan(0);
      }
    });

    it('llm:request event produces llm-request entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({
        type: 'llm:request',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
        tools: ['read_file', 'search'],
        skill: null,
      } as RunStreamEvent);

      const reqEntry = entries.lastEntries.find((e) => e.type === 'llm-request');
      expect(reqEntry).toBeDefined();
      if (reqEntry?.type === 'llm-request') {
        expect(reqEntry.messageCount).toBe(2);
        expect(reqEntry.tools).toEqual(['read_file', 'search']);
      }
    });

    it('llm:response event produces llm-response entry', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({
        type: 'llm:response',
        text: 'response text',
        toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: 'a.ts' } }],
      } as RunStreamEvent);

      const resEntry = entries.lastEntries.find((e) => e.type === 'llm-response');
      expect(resEntry).toBeDefined();
      if (resEntry?.type === 'llm-response') {
        expect(resEntry.textLength).toBe(13);
        expect(resEntry.toolCalls).toHaveLength(1);
        expect(resEntry.toolCalls![0].name).toBe('read_file');
      }
    });
  });

  // ── Full flow simulation ──

  describe('Full flow', () => {
    it('run mode: token → tool → resetAssistant → token → finalize', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter, {
        onToolEnd: () => consumer.resetAssistant(),
      });

      // Round 1: thinking + tool
      consumer.consume(tokenEvent('Let me check'));
      consumer.consume(toolStartEvent('read_file', { path: '/tmp' }));
      consumer.consume(toolEndEvent('file contents'));

      // onToolEnd triggers resetAssistant, new assistant entry
      consumer.consume(tokenEvent('The answer is 42'));
      consumer.finalizeAssistant('The answer is 42');

      // Final assistant should be the last one
      const lastAsst = [...entries.lastEntries].reverse().find((e) => e.type === 'assistant');
      if (lastAsst?.type === 'assistant') {
        expect(lastAsst.content).toBe('The answer is 42');
        expect(lastAsst.isStreaming).toBe(false);
      }
    });

    it('step mode: no onToolEnd, tool within a step does not trigger reset', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(tokenEvent('thinking'));
      consumer.consume(toolStartEvent('search'));
      consumer.consume(toolEndEvent('results'));

      // No resetAssistant, assistant unchanged
      const assistants = entries.lastEntries.filter((e) => e.type === 'assistant');
      // Should have only one assistant (resetAssistant on construction does not create entry, but flush before tool:start also does not create)
      // Actually flush before tool:start only updates existing assistant
      expect(assistants.length).toBeLessThanOrEqual(1);
    });

    it('advance mode: phase-change hook triggers pause and assistant reset', () => {
      const phaseChanges: string[] = [];

      const consumer = new StreamEventConsumer(entries.setter, state.setter, {
        onPhaseChange: (event) => {
          phaseChanges.push(`${event.from.type}->${event.to.type}`);
          if (event.to.type === 'calling-llm') {
            consumer.resetAssistant();
          }
        },
      });

      consumer.consume(phaseChangeEvent('idle', 'calling-llm'));
      expect(phaseChanges).toEqual(['idle->calling-llm']);

      // New token enters new entry after resetAssistant
      consumer.consume(tokenEvent('thinking'));
      expect(consumer.getAccumulatedContent()).toBe('thinking');
    });

    it('complex flow: skill + tool + token do not interfere with each other', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume({ type: 'skill:loading', name: 'poet' });
      consumer.consume({ type: 'skill:loaded', name: 'poet', tokenCount: 500 });
      consumer.consume({
        type: 'skill:start',
        name: 'poet',
        task: 'write',
        state: undefined as any,
      });
      consumer.consume(tokenEvent('Once upon'));
      consumer.consume(toolStartEvent('search'));
      consumer.consume(toolEndEvent('results'));
      consumer.consume(tokenEvent(' a time'));
      consumer.consume({
        type: 'skill:end',
        name: 'poet',
        result: 'Once upon a time',
        state: undefined as any,
      });

      const skills = entries.lastEntries.filter((e) => e.type === 'skill');
      const tools = entries.lastEntries.filter((e) => e.type === 'tool');
      expect(skills).toHaveLength(4);
      expect(tools).toHaveLength(1);
      expect(consumer.getAccumulatedContent()).toContain('Once upon');
    });
  });

  // ── ID uniqueness ──

  describe('ID uniqueness', () => {
    it('multiple entries have distinct IDs', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(toolStartEvent('a'));
      consumer.consume(toolStartEvent('b'));

      const ids = entries.lastEntries.map((e) => e.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  // T-CLI1: Regression test — tools:start / tools:end parallel tool events (CR CLI-1)
  describe('tools:start / tools:end parallel tool events (CR CLI-1)', () => {
    function toolsStartEvent(
      actions: Array<{ tool: string; id: string; args?: Record<string, unknown> }>
    ): RunStreamEvent {
      return {
        type: 'tools:start',
        actions: actions.map((a) => ({
          id: a.id,
          tool: a.tool,
          arguments: a.args ?? {},
        })),
      };
    }

    function toolsEndEvent(results: Record<string, unknown>): RunStreamEvent {
      return { type: 'tools:end', results };
    }

    it('tools:start should create tool entry with isRunning=true for each action', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(
        toolsStartEvent([
          { tool: 'read_file', id: 'tc-1' },
          { tool: 'calculator', id: 'tc-2' },
        ])
      );

      const tools = entries.lastEntries.filter((e) => e.type === 'tool');
      expect(tools).toHaveLength(2);
      if (tools[0]?.type === 'tool') {
        expect(tools[0].tool).toBe('read_file');
        expect(tools[0].isRunning).toBe(true);
      }
      if (tools[1]?.type === 'tool') {
        expect(tools[1].tool).toBe('calculator');
        expect(tools[1].isRunning).toBe(true);
      }
    });

    it('tools:end should match isRunning tool entries from back to front and set results', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);

      consumer.consume(
        toolsStartEvent([
          { tool: 'read_file', id: 'tc-1' },
          { tool: 'calculator', id: 'tc-2' },
        ])
      );
      consumer.consume(toolsEndEvent({ 'tc-1': 'file content', 'tc-2': 42 }));

      const tools = entries.lastEntries.filter((e) => e.type === 'tool');
      expect(tools).toHaveLength(2);
      // tools:end matches from back to front, so tc-2 matches last, tc-1 matches previous
      if (tools[0]?.type === 'tool') {
        expect(tools[0].result).toBe('file content');
        expect(tools[0].isRunning).toBe(false);
      }
      if (tools[1]?.type === 'tool') {
        expect(tools[1].result).toBe(42);
        expect(tools[1].isRunning).toBe(false);
      }
    });

    it('tools:end should trigger onToolEnd hook', () => {
      const onToolEnd = vi.fn();
      const consumer = new StreamEventConsumer(entries.setter, state.setter, { onToolEnd });

      consumer.consume(
        toolsStartEvent([
          { tool: 'read_file', id: 'tc-1' },
          { tool: 'calculator', id: 'tc-2' },
        ])
      );
      consumer.consume(toolsEndEvent({ 'tc-1': 'a', 'tc-2': 'b' }));

      expect(onToolEnd).toHaveBeenCalledTimes(1);
    });

    it('should flush accumulated tokens before tools:start', () => {
      const consumer = new StreamEventConsumer(entries.setter, state.setter);
      consumer.resetAssistant();

      consumer.consume(tokenEvent('partial text'));
      consumer.consume(
        toolsStartEvent([
          { tool: 'read_file', id: 'tc-1' },
          { tool: 'calc', id: 'tc-2' },
        ])
      );

      // Assistant entry should have accumulated tokens
      const assistant = entries.lastEntries.find((e) => e.type === 'assistant');
      if (assistant?.type === 'assistant') {
        expect(assistant.content).toBe('partial text');
        expect(assistant.isStreaming).toBe(false);
      }
    });
  });
});
