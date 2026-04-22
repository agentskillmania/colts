/**
 * TraceWriter unit tests
 *
 * Covers trace record format for all event types, dual timestamps, tool pairing timing, truncation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TraceWriter } from '../../src/trace-writer.js';

/** Create temp directory for test isolation */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'colts-trace-test-'));
}

/** Read trace file content and parse each line */
function readTraceLines(dir: string, sessionId: string): unknown[] {
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

/** Check if a value is ISO 8601 format */
function isISO8601(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
}

describe('TraceWriter', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('trace.start and trace.end markers', () => {
    it('should write trace.start as first record on construction', async () => {
      const tracer = new TraceWriter('test-start', tempDir);
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-start');
      expect(lines[0]).toEqual({
        event: 'trace.start',
        ts: expect.any(String),
        elapsed: 0,
        sessionId: 'test-start',
      });
      expect(isISO8601((lines[0] as { ts: string }).ts)).toBe(true);
    });

    it('should write trace.end as last record on flush', async () => {
      const tracer = new TraceWriter('test-end', tempDir);
      tracer.consume({ type: 'phase-change', from: { type: 'idle' }, to: { type: 'preparing' } });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-end');
      const last = lines[lines.length - 1];
      expect(last).toEqual({
        event: 'trace.end',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        totalEvents: 1,
      });
    });
  });

  describe('dual timestamps', () => {
    it('should have ts in ISO 8601 format on every record', async () => {
      const tracer = new TraceWriter('test-ts', tempDir);
      tracer.consume({ type: 'compressing' });
      tracer.consume({ type: 'compressed', summary: 'test', removedCount: 5 });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-ts');
      for (const line of lines) {
        expect(isISO8601((line as { ts: string }).ts)).toBe(true);
      }
    });

    it('should have elapsed >= 0 and non-decreasing', async () => {
      const tracer = new TraceWriter('test-elapsed', tempDir);
      tracer.consume({ type: 'compressing' });
      tracer.consume({ type: 'compressed', summary: 'test', removedCount: 5 });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-elapsed');
      let prevElapsed = 0;
      for (const line of lines) {
        const elapsed = (line as { elapsed: number }).elapsed;
        expect(elapsed).toBeGreaterThanOrEqual(prevElapsed);
        prevElapsed = elapsed;
      }
    });
  });

  describe('step events', () => {
    it('should record step:start', async () => {
      const tracer = new TraceWriter('test-step-start', tempDir);
      tracer.consume({ type: 'step:start', step: 1, state: {} as never });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-step-start');
      const record = lines.find((l) => (l as { event: string }).event === 'step.start');
      expect(record).toEqual({
        event: 'step.start',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        step: 1,
      });
    });

    it('should record step:end with done result', async () => {
      const tracer = new TraceWriter('test-step-end', tempDir);
      tracer.consume({ type: 'step:end', step: 1, result: { type: 'done', answer: '42' } });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-step-end');
      const record = lines.find((l) => (l as { event: string }).event === 'step.end');
      expect(record).toEqual({
        event: 'step.end',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        step: 1,
        result: 'done',
        answer: '42',
      });
    });

    it('should record step:end with continue result (no answer field)', async () => {
      const tracer = new TraceWriter('test-step-cont', tempDir);
      tracer.consume({
        type: 'step:end',
        step: 1,
        result: { type: 'continue', toolResult: 'ok' },
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-step-cont');
      const record = lines.find((l) => (l as { event: string }).event === 'step.end');
      expect(record).toEqual({
        event: 'step.end',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        step: 1,
        result: 'continue',
      });
      expect(record).not.toHaveProperty('answer');
    });
  });

  describe('phase-change', () => {
    it('should record from.type and to.type', async () => {
      const tracer = new TraceWriter('test-phase', tempDir);
      tracer.consume({ type: 'phase-change', from: { type: 'idle' }, to: { type: 'calling-llm' } });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-phase');
      const record = lines.find((l) => (l as { event: string }).event === 'phase.change');
      expect(record).toEqual({
        event: 'phase.change',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        from: 'idle',
        to: 'calling-llm',
      });
    });
  });

  describe('llm events', () => {
    it('should record llm.request with message count instead of full messages', async () => {
      const tracer = new TraceWriter('test-llm-req', tempDir);
      tracer.consume({
        type: 'llm:request',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
        ],
        tools: ['calculator', 'read_file'],
        skill: { current: 'math', stack: [] },
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-llm-req');
      const record = lines.find((l) => (l as { event: string }).event === 'llm.request');
      expect(record).toEqual({
        event: 'llm.request',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        msgCount: 2,
        tools: ['calculator', 'read_file'],
        skill: { current: 'math', stack: [] },
      });
      // Should NOT have messages field
      expect(record).not.toHaveProperty('messages');
    });

    it('should record llm.response with truncated text', async () => {
      const tracer = new TraceWriter('test-llm-resp', tempDir);
      const longText = 'A'.repeat(500);
      tracer.consume({
        type: 'llm:response',
        text: longText,
        toolCalls: [{ id: 'c1', name: 'calculator', arguments: { expr: '1+1' } }],
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-llm-resp');
      const record = lines.find((l) => (l as { event: string }).event === 'llm.response') as
        | { text: string }
        | undefined;
      expect(record).toBeDefined();
      expect(record!.text.length).toBeLessThanOrEqual(203); // 200 + "..."
      expect(record!.text).toContain('...');
    });

    it('should record llm.response without toolCalls', async () => {
      const tracer = new TraceWriter('test-llm-no-tc', tempDir);
      tracer.consume({
        type: 'llm:response',
        text: 'Hello!',
        toolCalls: null,
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-llm-no-tc');
      const record = lines.find((l) => (l as { event: string }).event === 'llm.response');
      expect(record).toEqual({
        event: 'llm.response',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        text: 'Hello!',
        toolCalls: null,
      });
    });

    it('should record null skill in llm.request', async () => {
      const tracer = new TraceWriter('test-skill-null', tempDir);
      tracer.consume({
        type: 'llm:request',
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [],
        skill: null,
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-skill-null');
      const record = lines.find((l) => (l as { event: string }).event === 'llm.request');
      expect(record).toHaveProperty('skill', null);
    });
  });

  describe('tool events with duration pairing', () => {
    it('should pair tool:start and tool:end with durationMs', async () => {
      const tracer = new TraceWriter('test-tool-pair', tempDir);

      tracer.consume({
        type: 'tool:start',
        action: { id: 'call-1', tool: 'calculator', arguments: { expr: '25*37' } },
      });

      tracer.consume({
        type: 'tool:end',
        result: 925,
      });

      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-tool-pair');

      const startRecord = lines.find((l) => (l as { event: string }).event === 'tool.start');
      expect(startRecord).toEqual({
        event: 'tool.start',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        tool: 'calculator',
        args: { expr: '25*37' },
        callId: 'call-1',
      });

      const endRecord = lines.find((l) => (l as { event: string }).event === 'tool.end');
      expect(endRecord).toEqual({
        event: 'tool.end',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        tool: 'calculator',
        result: '925',
        durationMs: expect.any(Number),
        callId: 'call-1',
      });

      const end = endRecord as { durationMs: number };
      expect(end.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle tool:end without preceding tool:start', async () => {
      const tracer = new TraceWriter('test-tool-orphan', tempDir);
      tracer.consume({ type: 'tool:end', result: 'orphan result' });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-tool-orphan');
      const record = lines.find((l) => (l as { event: string }).event === 'tool.end');
      expect(record).toEqual({
        event: 'tool.end',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        tool: '',
        result: 'orphan result',
        durationMs: null,
        callId: '',
      });
    });

    it('should truncate tool:end result when too long', async () => {
      const tracer = new TraceWriter('test-tool-trunc', tempDir);
      tracer.consume({
        type: 'tool:start',
        action: { id: 'c1', tool: 'reader', arguments: {} },
      });
      tracer.consume({ type: 'tool:end', result: 'X'.repeat(500) });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-tool-trunc');
      const endRecord = lines.find((l) => (l as { event: string }).event === 'tool.end') as
        | { result: string }
        | undefined;
      expect(endRecord!.result.length).toBeLessThanOrEqual(203);
      expect(endRecord!.result).toContain('...');
    });
  });

  describe('tools:start and tools:end (parallel)', () => {
    it('should record tools:start with action summaries', async () => {
      const tracer = new TraceWriter('test-tools-start', tempDir);
      tracer.consume({
        type: 'tools:start',
        actions: [
          { id: 'c1', tool: 'weather', arguments: { city: 'Beijing' } },
          { id: 'c2', tool: 'weather', arguments: { city: 'Shanghai' } },
        ],
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-tools-start');
      const record = lines.find((l) => (l as { event: string }).event === 'tools.start');
      expect(record).toEqual({
        event: 'tools.start',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        actions: [
          { tool: 'weather', callId: 'c1', args: { city: 'Beijing' } },
          { tool: 'weather', callId: 'c2', args: { city: 'Shanghai' } },
        ],
      });
    });

    it('should record tools:end with durationMs', async () => {
      const tracer = new TraceWriter('test-tools-end', tempDir);
      tracer.consume({
        type: 'tools:start',
        actions: [
          { id: 'c1', tool: 'weather', arguments: { city: 'Beijing' } },
          { id: 'c2', tool: 'weather', arguments: { city: 'Shanghai' } },
        ],
      });
      tracer.consume({
        type: 'tools:end',
        results: { c1: 'sunny', c2: 'rainy' },
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-tools-end');
      const record = lines.find((l) => (l as { event: string }).event === 'tools.end');
      expect(record).toEqual({
        event: 'tools.end',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        results: { c1: 'sunny', c2: 'rainy' },
        durationMs: expect.any(Number),
      });
    });
  });

  describe('error event', () => {
    it('should record error message and context', async () => {
      const tracer = new TraceWriter('test-error', tempDir);
      tracer.consume({
        type: 'error',
        error: new Error('API rate limit exceeded'),
        context: { toolName: 'calculator', step: 3 },
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-error');
      const record = lines.find((l) => (l as { event: string }).event === 'error');
      expect(record).toEqual({
        event: 'error',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        message: 'API rate limit exceeded',
        context: expect.stringContaining('calculator'),
      });
    });
  });

  describe('skill events', () => {
    it('should record skill:loading', async () => {
      const tracer = new TraceWriter('test-skill-load', tempDir);
      tracer.consume({ type: 'skill:loading', name: 'greeting' });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-skill-load');
      const record = lines.find((l) => (l as { event: string }).event === 'skill.loading');
      expect(record).toEqual({
        event: 'skill.loading',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        name: 'greeting',
      });
    });

    it('should record skill:loaded with tokenCount', async () => {
      const tracer = new TraceWriter('test-skill-loaded', tempDir);
      tracer.consume({ type: 'skill:loaded', name: 'greeting', tokenCount: 42 });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-skill-loaded');
      const record = lines.find((l) => (l as { event: string }).event === 'skill.loaded');
      expect(record).toEqual({
        event: 'skill.loaded',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        name: 'greeting',
        tokenCount: 42,
      });
    });

    it('should record skill:start and skill:end', async () => {
      const tracer = new TraceWriter('test-skill-se', tempDir);
      tracer.consume({ type: 'skill:start', name: 'math', task: 'solve equation' });
      tracer.consume({ type: 'skill:end', name: 'math', result: 'x = 42' });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-skill-se');

      const start = lines.find((l) => (l as { event: string }).event === 'skill.start');
      expect(start).toEqual({
        event: 'skill.start',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        name: 'math',
        task: 'solve equation',
      });

      const end = lines.find((l) => (l as { event: string }).event === 'skill.end');
      expect(end).toEqual({
        event: 'skill.end',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        name: 'math',
        result: 'x = 42',
      });
    });

    it('should truncate skill:end result when too long', async () => {
      const tracer = new TraceWriter('test-skill-trunc', tempDir);
      tracer.consume({ type: 'skill:end', name: 'test', result: 'R'.repeat(500) });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-skill-trunc');
      const record = lines.find((l) => (l as { event: string }).event === 'skill.end') as
        | { result: string }
        | undefined;
      expect(record!.result.length).toBeLessThanOrEqual(203);
    });
  });

  describe('subagent events', () => {
    it('should record subagent:start and subagent:end', async () => {
      const tracer = new TraceWriter('test-subagent', tempDir);
      tracer.consume({ type: 'subagent:start', name: 'researcher', task: 'find sources' });
      tracer.consume({
        type: 'subagent:end',
        name: 'researcher',
        result: { answer: 'Found 3 sources', totalSteps: 2, finalState: null },
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-subagent');

      const start = lines.find((l) => (l as { event: string }).event === 'subagent.start');
      expect(start).toEqual({
        event: 'subagent.start',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        name: 'researcher',
        task: 'find sources',
      });

      const end = lines.find((l) => (l as { event: string }).event === 'subagent.end');
      expect(end).toEqual({
        event: 'subagent.end',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        name: 'researcher',
        result: 'Found 3 sources',
      });
    });

    it('should truncate subagent:end result when too long', async () => {
      const tracer = new TraceWriter('test-sub-trunc', tempDir);
      tracer.consume({
        type: 'subagent:end',
        name: 'test',
        result: { answer: 'X'.repeat(500), totalSteps: 1, finalState: null },
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-sub-trunc');
      const record = lines.find((l) => (l as { event: string }).event === 'subagent.end') as
        | { result: string }
        | undefined;
      expect(record!.result.length).toBeLessThanOrEqual(203);
    });
  });

  describe('compress events', () => {
    it('should record compress.start and compress.end', async () => {
      const tracer = new TraceWriter('test-compress', tempDir);
      tracer.consume({ type: 'compressing' });
      tracer.consume({ type: 'compressed', summary: 'Conversation about math', removedCount: 5 });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-compress');

      const start = lines.find((l) => (l as { event: string }).event === 'compress.start');
      expect(start).toEqual({
        event: 'compress.start',
        ts: expect.any(String),
        elapsed: expect.any(Number),
      });

      const end = lines.find((l) => (l as { event: string }).event === 'compress.end');
      expect(end).toEqual({
        event: 'compress.end',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        summary: 'Conversation about math',
        removedCount: 5,
      });
    });
  });

  describe('complete event', () => {
    it('should record run.end with success result', async () => {
      const tracer = new TraceWriter('test-complete-ok', tempDir);
      tracer.consume({
        type: 'complete',
        result: { type: 'success', answer: '42', totalSteps: 3 },
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-complete-ok');
      const record = lines.find((l) => (l as { event: string }).event === 'run.end');
      expect(record).toEqual({
        event: 'run.end',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        result: 'success',
        totalSteps: 3,
        answer: '42',
      });
    });

    it('should record run.end with max_steps result', async () => {
      const tracer = new TraceWriter('test-complete-max', tempDir);
      tracer.consume({ type: 'complete', result: { type: 'max_steps', totalSteps: 10 } });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-complete-max');
      const record = lines.find((l) => (l as { event: string }).event === 'run.end');
      expect(record).toEqual({
        event: 'run.end',
        ts: expect.any(String),
        elapsed: expect.any(Number),
        result: 'max_steps',
        totalSteps: 10,
      });
      expect(record).not.toHaveProperty('answer');
    });
  });

  describe('token event', () => {
    it('should ignore token events', async () => {
      const tracer = new TraceWriter('test-token', tempDir);
      tracer.consume({ type: 'token', token: 'Hello' });
      tracer.consume({ type: 'token', token: ' World' });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-token');
      // Only trace.start and trace.end, no token records
      const tokenRecords = lines.filter((l) => (l as { event: string }).event === 'token');
      expect(tokenRecords).toHaveLength(0);
    });
  });

  describe('JSONL format', () => {
    it('should write one JSON object per line', async () => {
      const tracer = new TraceWriter('test-jsonl', tempDir);
      tracer.consume({ type: 'phase-change', from: { type: 'idle' }, to: { type: 'preparing' } });
      tracer.consume({ type: 'compressing' });
      await tracer.flush();

      const filePath = path.join(tempDir, 'test-jsonl.jsonl');
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');

      // Every line should be valid JSON
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });

    it('should support append mode (same session, multiple tracer instances)', async () => {
      const tracer1 = new TraceWriter('test-append', tempDir);
      tracer1.consume({ type: 'compressing' });
      await tracer1.flush();

      const tracer2 = new TraceWriter('test-append', tempDir);
      tracer2.consume({ type: 'compressed', summary: 'test', removedCount: 1 });
      await tracer2.flush();

      const lines = readTraceLines(tempDir, 'test-append');
      // First instance: trace.start + compress.start + trace.end
      // Second instance: trace.start + compress.end + trace.end
      expect(lines.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('auto-create directory', () => {
    it('should create nested directories automatically', async () => {
      const nestedDir = path.join(tempDir, 'a', 'b', 'c');
      const tracer = new TraceWriter('test-nested', nestedDir);
      tracer.consume({ type: 'compressing' });
      await tracer.flush();

      expect(fs.existsSync(path.join(nestedDir, 'test-nested.jsonl'))).toBe(true);
    });
  });

  describe('full flow simulation', () => {
    it('should record a complete execution lifecycle', async () => {
      const tracer = new TraceWriter('test-flow', tempDir);

      // step 1
      tracer.consume({ type: 'step:start', step: 1, state: {} as never });
      tracer.consume({ type: 'phase-change', from: { type: 'idle' }, to: { type: 'calling-llm' } });
      tracer.consume({
        type: 'llm:request',
        messages: [{ role: 'user', content: 'What is 25*37?' }],
        tools: ['calculator'],
        skill: null,
      });
      tracer.consume({
        type: 'llm:response',
        text: 'Let me calculate',
        toolCalls: [{ id: 'c1', name: 'calculator', arguments: { expr: '25*37' } }],
      });
      tracer.consume({
        type: 'tool:start',
        action: { id: 'c1', tool: 'calculator', arguments: { expr: '25*37' } },
      });
      tracer.consume({ type: 'tool:end', result: 925 });
      tracer.consume({
        type: 'step:end',
        step: 1,
        result: { type: 'continue', toolResult: 925 },
      });

      // step 2
      tracer.consume({ type: 'step:start', step: 2, state: {} as never });
      tracer.consume({
        type: 'llm:request',
        messages: [
          { role: 'user', content: 'What is 25*37?' },
          { role: 'tool', content: '925' },
        ],
        tools: ['calculator'],
        skill: null,
      });
      tracer.consume({
        type: 'llm:response',
        text: 'The answer is 925',
        toolCalls: null,
      });
      tracer.consume({
        type: 'step:end',
        step: 2,
        result: { type: 'done', answer: 'The answer is 925' },
      });

      tracer.consume({
        type: 'complete',
        result: { type: 'success', answer: 'The answer is 925', totalSteps: 2 },
      });

      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-flow');
      const events = lines.map((l) => (l as { event: string }).event);

      // Verify event sequence
      expect(events[0]).toBe('trace.start');
      expect(events).toContain('step.start');
      expect(events).toContain('phase.change');
      expect(events).toContain('llm.request');
      expect(events).toContain('llm.response');
      expect(events).toContain('tool.start');
      expect(events).toContain('tool.end');
      expect(events).toContain('step.end');
      expect(events).toContain('run.end');
      expect(events[events.length - 1]).toBe('trace.end');

      // totalEvents should match consumed events (excluding token)
      const traceEnd = lines[lines.length - 1] as { totalEvents: number };
      expect(traceEnd.totalEvents).toBe(events.length - 2); // minus trace.start and trace.end
    });
  });
});
