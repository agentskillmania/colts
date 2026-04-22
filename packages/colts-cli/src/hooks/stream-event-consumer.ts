/**
 * @fileoverview Stream event consumer — unified StreamEvent → TimelineEntry conversion
 *
 * Consolidates duplicated event processing logic from run/step/advance execution modes.
 * Orchestration layer (executeRun/executeStep/executeAdvance) only handles control flow differences.
 *
 * Each TimelineEntry carries a globally monotonically increasing seq number.
 * Even if React batch updates merge intermediate states, sorting by seq ensures correct entry order.
 *
 * Assistant entry uses lazy creation: not inserted immediately during resetAssistant(),
 * but created only when the first token arrives. This ensures the assistant entry's seq
 * is greater than structural events like step-start / phase-change, so render order is correct.
 */

import throttle from 'throttleit';
import type { AgentState } from '@agentskillmania/colts';
import type { StreamEvent, RunStreamEvent } from '@agentskillmania/colts';
import type { TimelineEntry } from '../types/timeline.js';
import { nextSeq } from '../types/timeline.js';

/** setEntries callback type */
export type SetEntries = React.Dispatch<React.SetStateAction<TimelineEntry[]>>;

/** setState callback type */
export type SetState = React.Dispatch<React.SetStateAction<AgentState | null>>;

/**
 * Mode-specific hook callbacks
 *
 * Different execution modes inject behavior differences through these callbacks; event processing is unified by Consumer.
 */
export interface EventHooks {
  /** Extra processing after tool:end. Run mode creates a new assistant entry here; step/advance do not */
  onToolEnd?: () => void;

  /** Extra processing for phase-change events. Advance mode flushes + pauses here; run/step do not */
  onPhaseChange?: (event: Extract<StreamEvent, { type: 'phase-change' }>) => void;
}

/** Render throttle interval (milliseconds) */
const RENDER_INTERVAL_MS = 50;

/**
 * Stream event consumer
 *
 * Consumes StreamEvent events, converts them to TimelineEntry, and updates UI state.
 * Token accumulation uses throttle (50ms) to limit rendering, avoiding setEntries on every token.
 *
 * @remarks
 * Usage:
 * ```typescript
 * const consumer = new StreamEventConsumer(setEntries, setState, {
 *   onToolEnd: () => consumer.resetAssistant(),
 * });
 *
 * // In event loop
 * for await (const event of generator) {
 *   consumer.consume(event);
 * }
 *
 * // After completion
 * consumer.flush();
 * ```
 */
export class StreamEventConsumer {
  /** Current assistant entry ID */
  private assistantId: string;

  /** Current assistant entry seq */
  private assistantSeq: number;

  /** Accumulated text content */
  private accumulatedContent = '';

  /** Throttled flush function */
  private throttledFlush: () => void;

  /** Whether disposed (no longer processes events after finalize) */
  private disposed = false;

  /** Tool start time record (key is tool entry seq) */
  private toolStartTimes = new Map<number, number>();

  /** Whether assistant entry has been inserted into timeline (lazy creation flag) */
  private assistantInserted = false;

  /**
   * @param setEntries - React state setter for timeline entries
   * @param setState - React state setter for agent state
   * @param hooks - Mode-specific hook callbacks
   */
  constructor(
    private readonly setEntries: SetEntries,
    private readonly setState: SetState,
    private readonly hooks: EventHooks = {}
  ) {
    this.assistantSeq = nextSeq();
    this.assistantId = this.uid();

    // Create throttled flush: call setEntries at most once within 50ms to update assistant content
    this.throttledFlush = throttle(() => {
      this.doFlush();
    }, RENDER_INTERVAL_MS);
  }

  // ── Public API ──

  /** Consume a stream event */
  consume(event: RunStreamEvent): void {
    if (this.disposed) return;

    switch (event.type) {
      case 'token': {
        this.handleToken(event);
        break;
      }

      case 'tool:start': {
        this.handleToolStart(event);
        break;
      }

      case 'tool:end': {
        this.handleToolEnd(event);
        break;
      }

      case 'tools:start': {
        this.handleToolsStart(event);
        break;
      }

      case 'tools:end': {
        this.handleToolsEnd(event);
        break;
      }

      case 'thinking': {
        this.addEntry({
          type: 'thought',
          id: this.uid(),
          seq: nextSeq(),
          content: event.content,
          timestamp: Date.now(),
        });
        break;
      }

      case 'phase-change': {
        this.handlePhaseChange(event);
        break;
      }

      case 'error': {
        this.handleError(event);
        break;
      }

      case 'compressing': {
        this.handleCompressing();
        break;
      }

      case 'compressed': {
        this.handleCompressed(event);
        break;
      }

      case 'skill:start': {
        this.handleSkillStart(event);
        break;
      }

      case 'skill:end': {
        this.handleSkillEnd(event);
        break;
      }

      case 'skill:loading': {
        this.handleSkillLoading(event);
        break;
      }

      case 'skill:loaded': {
        this.handleSkillLoaded(event);
        break;
      }

      case 'subagent:start': {
        this.handleSubagentStart(event);
        break;
      }

      case 'subagent:end': {
        this.handleSubagentEnd(event);
        break;
      }

      case 'step:start': {
        this.handleStepStart(event);
        break;
      }

      case 'step:end': {
        this.handleStepEnd(event);
        break;
      }

      case 'llm:request': {
        this.handleLlmRequest(event);
        break;
      }

      case 'llm:response': {
        this.handleLlmResponse(event);
        break;
      }

      case 'complete': {
        // Recorded by TraceWriter, no UI display needed
        break;
      }
    }
  }

  /**
   * Force flush all accumulated tokens to UI
   *
   * Called on phase switch, tool call, error, or completion.
   */
  flush(): void {
    // throttleit throttle function has no cancel(); call doFlush directly to bypass throttling
    this.doFlush();
  }

  /**
   * Reset assistant state to prepare for a new token stream
   *
   * Lazy creation strategy: only reset internal state, do not insert entry immediately.
   * Assistant entry is truly created when the first token arrives (ensures correct seq order).
   *
   * Called after tool:end (run mode) or before calling-llm phase (advance mode).
   */
  resetAssistant(): void {
    this.flush();
    this.assistantSeq = nextSeq();
    this.assistantId = this.uid();
    this.accumulatedContent = '';
    this.assistantInserted = false;
  }

  /**
   * Mark assistant entry as no longer streaming and set final content
   *
   * @param content - Final content; if empty, uses accumulated content
   */
  finalizeAssistant(content?: string): void {
    this.ensureAssistantInserted();
    this.flush();
    const id = this.assistantId;
    const seq = this.assistantSeq;
    const c = content ?? this.accumulatedContent;
    this.setEntries((prev) =>
      prev.map((e) =>
        e.type === 'assistant' && e.id === id && e.seq === seq
          ? { ...e, content: c, isStreaming: false }
          : e
      )
    );
    this.disposed = true;
  }

  /** Get accumulated text content */
  getAccumulatedContent(): string {
    return this.accumulatedContent;
  }

  /** Get current assistant entry ID */
  getAssistantId(): string {
    return this.assistantId;
  }

  // ── Event handling ──

  /** Token event: lazily create assistant entry, accumulate text, throttled UI update */
  private handleToken(event: Extract<StreamEvent, { type: 'token' }>): void {
    if (event.token) {
      this.accumulatedContent += event.token;
      // Only create assistant entry when there is non-whitespace content (avoid empty entries from pure newlines)
      if (this.accumulatedContent.trim()) {
        this.ensureAssistantInserted();
      }
      if (this.assistantInserted) {
        this.throttledFlush();
      }
    }
  }

  /** tool:start event: flush tokens, stop assistant streaming, create tool entry */
  private handleToolStart(event: Extract<StreamEvent, { type: 'tool:start' }>): void {
    this.flush();
    // Only mark streaming as ended when an assistant entry already exists
    if (this.assistantInserted) {
      const id = this.assistantId;
      const seq = this.assistantSeq;
      this.setEntries((prev) =>
        prev.map((e) =>
          e.type === 'assistant' && e.id === id && e.seq === seq ? { ...e, isStreaming: false } : e
        )
      );
    }
    const toolSeq = nextSeq();
    this.toolStartTimes.set(toolSeq, Date.now());
    this.addEntry({
      type: 'tool',
      id: this.uid(),
      seq: toolSeq,
      tool: event.action.tool,
      args: event.action.arguments,
      isRunning: true,
      timestamp: Date.now(),
    });
  }

  /** tool:end event: update tool entry result, calculate duration, call mode-specific hook */
  private handleToolEnd(event: Extract<StreamEvent, { type: 'tool:end' }>): void {
    this.setEntries((prev) => {
      let idx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        const e = prev[i];
        if (e.type === 'tool' && e.isRunning) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        const toolEntry = prev[idx] as Extract<TimelineEntry, { type: 'tool' }>;
        const startTime = this.toolStartTimes.get(toolEntry.seq);
        const duration = startTime ? Date.now() - startTime : undefined;
        this.toolStartTimes.delete(toolEntry.seq);
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          result: event.result,
          isRunning: false,
          duration,
        } as TimelineEntry;
        return updated;
      }
      return prev;
    });
    this.hooks.onToolEnd?.();
  }

  /** tools:start event: flush tokens, stop assistant streaming, batch create tool entries */
  private handleToolsStart(event: Extract<StreamEvent, { type: 'tools:start' }>): void {
    this.flush();
    // Only mark streaming as ended when an assistant entry already exists
    if (this.assistantInserted) {
      const id = this.assistantId;
      const seq = this.assistantSeq;
      this.setEntries((prev) =>
        prev.map((e) =>
          e.type === 'assistant' && e.id === id && e.seq === seq ? { ...e, isStreaming: false } : e
        )
      );
    }
    const now = Date.now();
    for (const action of event.actions) {
      const toolSeq = nextSeq();
      this.toolStartTimes.set(toolSeq, now);
      this.addEntry({
        type: 'tool',
        id: this.uid(),
        seq: toolSeq,
        tool: action.tool,
        args: action.arguments,
        isRunning: true,
        timestamp: now,
      });
    }
  }

  /** tools:end event: match isRunning tool entries from back to front, update results and duration */
  private handleToolsEnd(event: Extract<StreamEvent, { type: 'tools:end' }>): void {
    this.setEntries((prev) => {
      const next = [...prev];
      const keys = Object.keys(event.results);
      let ki = keys.length - 1;
      for (let i = next.length - 1; i >= 0 && ki >= 0; i--) {
        const e = next[i];
        if (e.type === 'tool' && (e as { isRunning?: boolean }).isRunning) {
          const toolEntry = e as Extract<TimelineEntry, { type: 'tool' }>;
          const startTime = this.toolStartTimes.get(toolEntry.seq);
          const duration = startTime ? Date.now() - startTime : undefined;
          this.toolStartTimes.delete(toolEntry.seq);
          const callId = keys[ki];
          next[i] = {
            ...next[i],
            result: event.results[callId],
            isRunning: false,
            duration,
          } as TimelineEntry;
          ki--;
        }
      }
      return next;
    });
    this.hooks.onToolEnd?.();
  }

  /** phase-change event: create phase entry, call mode-specific hook */
  private handlePhaseChange(event: Extract<StreamEvent, { type: 'phase-change' }>): void {
    this.flush();
    const mapAssistant = this.assistantInserted
      ? (prev: TimelineEntry[]) =>
          prev.map((e) =>
            e.type === 'assistant' && e.id === this.assistantId && e.seq === this.assistantSeq
              ? { ...e, isStreaming: false }
              : e
          )
      : (prev: TimelineEntry[]) => prev;
    this.setEntries((prev) => [
      ...mapAssistant(prev),
      {
        type: 'phase',
        id: this.uid(),
        seq: nextSeq(),
        from: event.from.type,
        to: event.to.type,
        timestamp: Date.now(),
      },
    ]);
    this.hooks.onPhaseChange?.(event);
  }

  /** error event: flush, create error entry */
  private handleError(event: Extract<StreamEvent, { type: 'error' }>): void {
    this.flush();
    const errMsg = event.error instanceof Error ? event.error.message : String(event.error);
    const mapAssistant = this.assistantInserted
      ? (prev: TimelineEntry[]) =>
          prev.map((e) =>
            e.type === 'assistant' && e.id === this.assistantId && e.seq === this.assistantSeq
              ? { ...e, isStreaming: false }
              : e
          )
      : (prev: TimelineEntry[]) => prev;
    this.setEntries((prev) => [
      ...mapAssistant(prev),
      { type: 'error', id: this.uid(), seq: nextSeq(), message: errMsg, timestamp: Date.now() },
    ]);
  }

  /** compressing event */
  private handleCompressing(): void {
    this.addEntry({
      type: 'compress',
      id: this.uid(),
      seq: nextSeq(),
      status: 'compressing',
      timestamp: Date.now(),
    });
  }

  /** compressed event */
  private handleCompressed(event: Extract<StreamEvent, { type: 'compressed' }>): void {
    this.addEntry({
      type: 'compress',
      id: this.uid(),
      seq: nextSeq(),
      status: 'compressed',
      summary: event.summary,
      removedCount: event.removedCount,
      timestamp: Date.now(),
    });
  }

  /** skill:start event */
  private handleSkillStart(event: Extract<StreamEvent, { type: 'skill:start' }>): void {
    if (event.state) this.setState(event.state);
    this.addEntry({
      type: 'skill',
      id: this.uid(),
      seq: nextSeq(),
      name: event.name,
      status: 'active',
      timestamp: Date.now(),
    });
  }

  /** skill:end event */
  private handleSkillEnd(event: Extract<StreamEvent, { type: 'skill:end' }>): void {
    if (event.state) this.setState(event.state);
    this.addEntry({
      type: 'skill',
      id: this.uid(),
      seq: nextSeq(),
      name: event.name,
      status: 'completed',
      result: event.result,
      timestamp: Date.now(),
    });
  }

  /** skill:loading event */
  private handleSkillLoading(event: Extract<StreamEvent, { type: 'skill:loading' }>): void {
    this.addEntry({
      type: 'skill',
      id: this.uid(),
      seq: nextSeq(),
      name: event.name,
      status: 'loading',
      timestamp: Date.now(),
    });
  }

  /** skill:loaded event */
  private handleSkillLoaded(event: Extract<StreamEvent, { type: 'skill:loaded' }>): void {
    this.addEntry({
      type: 'skill',
      id: this.uid(),
      seq: nextSeq(),
      name: event.name,
      status: 'loaded',
      tokenCount: event.tokenCount,
      timestamp: Date.now(),
    });
  }

  /** subagent:start event */
  private handleSubagentStart(event: Extract<StreamEvent, { type: 'subagent:start' }>): void {
    this.addEntry({
      type: 'subagent',
      id: this.uid(),
      seq: nextSeq(),
      name: event.name,
      task: event.task,
      status: 'start',
      timestamp: Date.now(),
    });
  }

  /** subagent:end event */
  private handleSubagentEnd(event: Extract<StreamEvent, { type: 'subagent:end' }>): void {
    this.addEntry({
      type: 'subagent',
      id: this.uid(),
      seq: nextSeq(),
      name: event.name,
      result: event.result,
      status: 'end',
      timestamp: Date.now(),
    });
  }

  /** step:start event */
  private handleStepStart(event: Extract<RunStreamEvent, { type: 'step:start' }>): void {
    this.addEntry({
      type: 'step-start',
      id: this.uid(),
      seq: nextSeq(),
      step: event.step,
      timestamp: Date.now(),
    });
  }

  /** step:end event */
  private handleStepEnd(event: Extract<RunStreamEvent, { type: 'step:end' }>): void {
    this.addEntry({
      type: 'step-end',
      id: this.uid(),
      seq: nextSeq(),
      step: event.step,
      result: event.result,
      timestamp: Date.now(),
    });
  }

  /** llm:request event: record summary of request sent to LLM (verbose only) */
  private handleLlmRequest(event: Extract<StreamEvent, { type: 'llm:request' }>): void {
    this.addEntry({
      type: 'llm-request',
      id: this.uid(),
      seq: nextSeq(),
      messageCount: event.messages.length,
      tools: event.tools,
      skill: event.skill,
      timestamp: Date.now(),
    });
  }

  /** llm:response event: record summary of response returned by LLM (verbose only) */
  private handleLlmResponse(event: Extract<StreamEvent, { type: 'llm:response' }>): void {
    this.addEntry({
      type: 'llm-response',
      id: this.uid(),
      seq: nextSeq(),
      textLength: event.text.length,
      toolCalls: event.toolCalls,
      timestamp: Date.now(),
    });
  }

  // ── Internal utilities ──

  /**
   * Ensure assistant entry is inserted into timeline
   *
   * Core of lazy creation: only truly create entry on first token or when isStreaming=false needs to be set.
   * This ensures assistant entry seq is greater than structural events like step-start, so render order is correct.
   */
  private ensureAssistantInserted(): void {
    if (this.assistantInserted) return;
    this.assistantInserted = true;
    this.addEntry({
      type: 'assistant',
      id: this.assistantId,
      seq: this.assistantSeq,
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    });
  }

  /** Actually execute flush: write accumulated content to assistant entry */
  private doFlush(): void {
    if (!this.assistantInserted) return;
    const content = this.accumulatedContent;
    const id = this.assistantId;
    const seq = this.assistantSeq;
    this.setEntries((prev) =>
      prev.map((e) =>
        e.type === 'assistant' && e.id === id && e.seq === seq ? { ...e, content } : e
      )
    );
  }

  /** Append a TimelineEntry */
  private addEntry(entry: TimelineEntry): void {
    this.setEntries((prev) => [...prev, entry]);
  }

  /** Generate unique ID */
  private uid(): string {
    return `entry-${++idCounter}`;
  }
}

/** Global ID counter */
let idCounter = 0;
