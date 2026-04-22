/**
 * @fileoverview Execution trace log writer
 *
 * Records all RunStreamEvent as JSONL format; each event corresponds to one trace record.
 * Symmetric to session snapshot: session records final state, trace records full execution process.
 *
 * Features:
 * - Dual timestamps: ISO 8601 (human-readable) + elapsed ms (debug interval)
 * - Tool pairing timing: tool:start → tool:end automatically calculates durationMs
 * - Large field truncation: prevents trace file bloat
 * - Writes trace.start on construction, trace.end on flush
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { RunStreamEvent } from '@agentskillmania/colts';

/** Default trace log storage directory */
const DEFAULT_TRACE_DIR = path.join(os.homedir(), '.agentskillmania', 'colts', 'traces');

/** Large field truncation length */
const TRUNCATE_MAX_LENGTH = 200;

/**
 * Truncate string to specified length
 *
 * Omitted excess is replaced with "...".
 *
 * @param value - Value to truncate
 * @param maxLength - Maximum length
 * @returns Truncated string
 */
function truncate(value: unknown, maxLength: number = TRUNCATE_MAX_LENGTH): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (!str) return '';
  return str.length > maxLength ? str.slice(0, maxLength) + '...' : str;
}

/**
 * Trace log record type
 *
 * All records have ts (ISO 8601) and elapsed (ms) time fields.
 */
type TraceRecord =
  // Wrapper events
  | { event: 'trace.start'; ts: string; elapsed: 0; sessionId: string }
  | { event: 'trace.end'; ts: string; elapsed: number; totalEvents: number }
  // run/step events
  | { event: 'step.start'; ts: string; elapsed: number; step: number }
  | {
      event: 'step.end';
      ts: string;
      elapsed: number;
      step: number;
      result: string;
      answer?: string;
    }
  | { event: 'phase.change'; ts: string; elapsed: number; from: string; to: string }
  // LLM events
  | {
      event: 'llm.request';
      ts: string;
      elapsed: number;
      msgCount: number;
      tools: string[];
      skill: { current: string | null; stack: string[] } | null;
    }
  | {
      event: 'llm.response';
      ts: string;
      elapsed: number;
      text: string;
      toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | null;
    }
  // Tool events
  | {
      event: 'tool.start';
      ts: string;
      elapsed: number;
      tool: string;
      args: Record<string, unknown>;
      callId: string;
    }
  | {
      event: 'tool.end';
      ts: string;
      elapsed: number;
      tool: string;
      result: string;
      durationMs: number | null;
      callId: string;
    }
  | {
      event: 'tools.start';
      ts: string;
      elapsed: number;
      actions: Array<{ tool: string; callId: string; args: Record<string, unknown> }>;
    }
  | {
      event: 'tools.end';
      ts: string;
      elapsed: number;
      results: Record<string, unknown>;
      durationMs: number | null;
    }
  // Error
  | { event: 'error'; ts: string; elapsed: number; message: string; context: string }
  // Skill events
  | { event: 'skill.loading'; ts: string; elapsed: number; name: string }
  | { event: 'skill.loaded'; ts: string; elapsed: number; name: string; tokenCount: number }
  | { event: 'skill.start'; ts: string; elapsed: number; name: string; task: string }
  | { event: 'skill.end'; ts: string; elapsed: number; name: string; result: string }
  // Subagent events
  | { event: 'subagent.start'; ts: string; elapsed: number; name: string; task: string }
  | { event: 'subagent.end'; ts: string; elapsed: number; name: string; result: string }
  // Compression events
  | { event: 'compress.start'; ts: string; elapsed: number }
  | {
      event: 'compress.end';
      ts: string;
      elapsed: number;
      summary: string;
      removedCount: number;
    }
  // Run end
  | {
      event: 'run.end';
      ts: string;
      elapsed: number;
      result: string;
      totalSteps: number;
      answer?: string;
    };

/**
 * Execution trace writer
 *
 * @example
 * ```typescript
 * const tracer = new TraceWriter(sessionId);
 * for await (const event of runner.runStream(state, ...)) {
 *   tracer.consume(event);
 *   // ... process events
 * }
 * await tracer.flush();
 * ```
 */
export class TraceWriter {
  private stream: fs.WriteStream;
  private startTime: number;
  private eventCount = 0;
  /** tool:start info record, key is action.id */
  private toolStartInfos = new Map<string, { startTime: number; tool: string; callId: string }>();
  /** tools:start timestamp record, for multi-tool parallel calls */
  private toolsStartTime: number | null = null;

  /**
   * @param sessionId - Session ID, used as filename
   * @param traceDir - Optional custom output directory (for test isolation)
   */
  constructor(sessionId: string, traceDir?: string) {
    const dir = traceDir ?? DEFAULT_TRACE_DIR;
    fs.mkdirSync(dir, { recursive: true });
    this.stream = fs.createWriteStream(path.join(dir, `${sessionId}.jsonl`), { flags: 'a' });

    this.startTime = Date.now();

    // Write trace.start marker
    const record: TraceRecord = {
      event: 'trace.start',
      ts: new Date().toISOString(),
      elapsed: 0,
      sessionId,
    };
    this.write(record);
  }

  /**
   * Extract trace records from event stream and write
   *
   * Records all RunStreamEvent (except tokens).
   *
   * @param event - Event from runStream
   */
  consume(event: RunStreamEvent): void {
    const record = this.toRecord(event);
    if (record) {
      this.eventCount++;
      this.write(record);
    }
  }

  /**
   * Flush and close write stream
   *
   * Must be called at session end to ensure all data is persisted.
   * Closes stream after writing trace.end marker.
   */
  async flush(): Promise<void> {
    const record: TraceRecord = {
      event: 'trace.end',
      ts: new Date().toISOString(),
      elapsed: Date.now() - this.startTime,
      totalEvents: this.eventCount,
    };
    this.write(record);

    return new Promise((resolve) => {
      this.stream.end(resolve);
    });
  }

  /**
   * Generate current timestamp and elapsed
   */
  private timestamp(): { ts: string; elapsed: number } {
    return {
      ts: new Date().toISOString(),
      elapsed: Date.now() - this.startTime,
    };
  }

  /**
   * Convert RunStreamEvent to TraceRecord
   */
  private toRecord(event: RunStreamEvent): TraceRecord | null {
    const { ts, elapsed } = this.timestamp();

    switch (event.type) {
      // Tokens are not recorded; large volume and final text already exists in session and llm.response
      case 'token':
        return null;

      case 'step:start':
        return { event: 'step.start', ts, elapsed, step: event.step };

      case 'step:end': {
        const base = {
          event: 'step.end' as const,
          ts,
          elapsed,
          step: event.step,
          result: event.result.type,
        };
        return event.result.type === 'done' ? { ...base, answer: event.result.answer } : base;
      }

      case 'phase-change':
        return {
          event: 'phase.change',
          ts,
          elapsed,
          from: event.from.type,
          to: event.to.type,
        };

      case 'llm:request':
        return {
          event: 'llm.request',
          ts,
          elapsed,
          msgCount: event.messages.length,
          tools: event.tools,
          skill: event.skill,
        };

      case 'llm:response':
        return {
          event: 'llm.response',
          ts,
          elapsed,
          text: truncate(event.text),
          toolCalls: event.toolCalls,
        };

      case 'tool:start': {
        // Record start time and action info for tool:end pairing
        this.toolStartInfos.set(event.action.id, {
          startTime: Date.now(),
          tool: event.action.tool,
          callId: event.action.id,
        });
        return {
          event: 'tool.start',
          ts,
          elapsed,
          tool: event.action.tool,
          args: event.action.arguments,
          callId: event.action.id,
        };
      }

      case 'tool:end': {
        // Prefer exact match by callId, fallback to FIFO
        const info = event.callId
          ? this.toolStartInfos.get(event.callId)
          : this.getFirstToolStartInfo();
        if (event.callId && info) {
          this.toolStartInfos.delete(event.callId);
        } else if (!event.callId && info) {
          // FIFO match: remove from map
          const firstKey = this.toolStartInfos.keys().next().value;
          if (firstKey !== undefined) this.toolStartInfos.delete(firstKey);
        }
        const durationMs = info !== null && info !== undefined ? Date.now() - info.startTime : null;
        return {
          event: 'tool.end',
          ts,
          elapsed,
          tool: info?.tool ?? '',
          result: truncate(event.result),
          durationMs,
          callId: info?.callId ?? event.callId ?? '',
        };
      }

      case 'tools:start': {
        this.toolsStartTime = Date.now();
        // Record info for each action
        for (const action of event.actions) {
          this.toolStartInfos.set(action.id, {
            startTime: Date.now(),
            tool: action.tool,
            callId: action.id,
          });
        }
        return {
          event: 'tools.start',
          ts,
          elapsed,
          actions: event.actions.map((a) => ({
            tool: a.tool,
            callId: a.id,
            args: a.arguments,
          })),
        };
      }

      case 'tools:end': {
        const durationMs = this.toolsStartTime !== null ? Date.now() - this.toolsStartTime : null;
        this.toolsStartTime = null;
        return {
          event: 'tools.end',
          ts,
          elapsed,
          results: event.results,
          durationMs,
        };
      }

      case 'error':
        return {
          event: 'error',
          ts,
          elapsed,
          message: event.error.message,
          context: JSON.stringify(event.context),
        };

      case 'skill:loading':
        return { event: 'skill.loading', ts, elapsed, name: event.name };

      case 'skill:loaded':
        return {
          event: 'skill.loaded',
          ts,
          elapsed,
          name: event.name,
          tokenCount: event.tokenCount,
        };

      case 'skill:start':
        return {
          event: 'skill.start',
          ts,
          elapsed,
          name: event.name,
          task: event.task,
        };

      case 'skill:end':
        return {
          event: 'skill.end',
          ts,
          elapsed,
          name: event.name,
          result: truncate(event.result),
        };

      case 'subagent:start':
        return {
          event: 'subagent.start',
          ts,
          elapsed,
          name: event.name,
          task: event.task,
        };

      case 'subagent:end':
        return {
          event: 'subagent.end',
          ts,
          elapsed,
          name: event.name,
          result: truncate(event.result.answer),
        };

      case 'compressing':
        return { event: 'compress.start', ts, elapsed };

      case 'compressed':
        return {
          event: 'compress.end',
          ts,
          elapsed,
          summary: truncate(event.summary),
          removedCount: event.removedCount,
        };

      case 'complete': {
        const base = {
          event: 'run.end' as const,
          ts,
          elapsed,
          result: event.result.type,
          totalSteps: event.result.totalSteps,
        };
        return event.result.type === 'success' ? { ...base, answer: event.result.answer } : base;
      }

      default:
        return null;
    }
  }

  /**
   * Get first tool:start info and remove from map
   *
   * Used for tool:end events (without callId/tool) pairing timing and info association.
   */
  private getFirstToolStartInfo(): { startTime: number; tool: string; callId: string } | null {
    const firstKey = this.toolStartInfos.keys().next().value;
    if (firstKey === undefined) return null;
    const info = this.toolStartInfos.get(firstKey)!;
    this.toolStartInfos.delete(firstKey);
    return info;
  }

  /**
   * Write one JSONL line
   */
  private write(data: TraceRecord): void {
    this.stream.write(JSON.stringify(data) + '\n');
  }
}
