/**
 * @fileoverview TraceWriter 单元测试
 *
 * 测试追踪日志写入器的 4 种事件过滤、JSONL 格式输出和自定义目录。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TraceWriter } from '../../src/trace-writer.js';

/** 创建临时目录用于测试隔离 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'colts-trace-test-'));
}

/** 读取 trace 文件内容并按行解析 */
function readTraceLines(dir: string, sessionId: string): unknown[] {
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

describe('TraceWriter', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    // 清理临时目录
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('consume 过滤', () => {
    it('应该写入 llm:request 事件为 llm.call 记录', async () => {
      const tracer = new TraceWriter('test-1', tempDir);
      tracer.consume({
        type: 'llm:request',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: ['load_skill'],
        skill: { current: 'greeting', stack: [] },
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-1');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toEqual({
        type: 'llm.call',
        timestamp: expect.any(Number),
        messages: [{ role: 'user', content: 'Hello' }],
        tools: ['load_skill'],
        skill: { current: 'greeting', stack: [] },
      });
    });

    it('应该写入 llm:response 事件为 llm.response 记录', async () => {
      const tracer = new TraceWriter('test-2', tempDir);
      tracer.consume({
        type: 'llm:response',
        text: '让我加载greeting',
        toolCalls: [{ id: 'c1', name: 'load_skill', arguments: { name: 'greeting' } }],
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-2');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toEqual({
        type: 'llm.response',
        timestamp: expect.any(Number),
        text: '让我加载greeting',
        toolCalls: [{ id: 'c1', name: 'load_skill', arguments: { name: 'greeting' } }],
      });
    });

    it('应该写入 llm:response 事件（无 toolCalls）', async () => {
      const tracer = new TraceWriter('test-3', tempDir);
      tracer.consume({
        type: 'llm:response',
        text: '你好！',
        toolCalls: null,
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-3');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toEqual({
        type: 'llm.response',
        timestamp: expect.any(Number),
        text: '你好！',
        toolCalls: null,
      });
    });

    it('应该写入 tool:end 事件为 tool.result 记录', async () => {
      const tracer = new TraceWriter('test-4', tempDir);
      tracer.consume({
        type: 'tool:end',
        result: "Skill 'greeting' loaded",
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-4');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toEqual({
        type: 'tool.result',
        timestamp: expect.any(Number),
        result: "Skill 'greeting' loaded",
      });
    });

    it('应该写入 step:end 事件为 step.end 记录', async () => {
      const tracer = new TraceWriter('test-5', tempDir);
      tracer.consume({
        type: 'step:end',
        step: 0,
        result: { type: 'done', answer: 'Hello!' },
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-5');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toEqual({
        type: 'step.end',
        timestamp: expect.any(Number),
        step: 0,
        result: 'done',
      });
    });

    it('应该忽略不相关的事件类型', async () => {
      const tracer = new TraceWriter('test-6', tempDir);
      // 这些事件应该被忽略
      tracer.consume({ type: 'token', token: 'Hello' });
      tracer.consume({ type: 'phase-change', from: { type: 'idle' }, to: { type: 'preparing' } });
      tracer.consume({ type: 'tool:start', action: { id: '1', tool: 'test', arguments: {} } });
      tracer.consume({ type: 'compressing' });
      tracer.consume({ type: 'skill:loading', name: 'test' });
      tracer.consume({ type: 'error', error: new Error('test'), context: { step: 0 } });
      await tracer.flush();

      // 文件由 createWriteStream 创建，但内容应该为空
      const lines = readTraceLines(tempDir, 'test-6');
      expect(lines).toHaveLength(0);
    });
  });

  describe('JSONL 格式', () => {
    it('应该按时间顺序追加写入多条记录', async () => {
      const tracer = new TraceWriter('test-7', tempDir);

      tracer.consume({
        type: 'llm:request',
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [],
        skill: null,
      });
      tracer.consume({
        type: 'llm:response',
        text: 'Hello!',
        toolCalls: null,
      });
      tracer.consume({
        type: 'step:end',
        step: 0,
        result: { type: 'done', answer: 'Hello!' },
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-7');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toHaveProperty('type', 'llm.call');
      expect(lines[1]).toHaveProperty('type', 'llm.response');
      expect(lines[2]).toHaveProperty('type', 'step.end');
    });

    it('应该每行是一个合法的 JSON', async () => {
      const tracer = new TraceWriter('test-8', tempDir);
      tracer.consume({
        type: 'llm:request',
        messages: [{ role: 'user', content: 'test with "quotes" and \\backslash' }],
        tools: ['a', 'b'],
        skill: null,
      });
      await tracer.flush();

      const filePath = path.join(tempDir, 'test-8.jsonl');
      const content = fs.readFileSync(filePath, 'utf-8');
      // 应该能正常解析
      const parsed = JSON.parse(content.trim());
      expect(parsed.messages[0].content).toContain('"quotes"');
    });
  });

  describe('skill 字段', () => {
    it('应该记录 null skill 状态', async () => {
      const tracer = new TraceWriter('test-9', tempDir);
      tracer.consume({
        type: 'llm:request',
        messages: [],
        tools: [],
        skill: null,
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-9');
      expect(lines[0]).toHaveProperty('skill', null);
    });

    it('应该记录嵌套 skill 栈', async () => {
      const tracer = new TraceWriter('test-10', tempDir);
      tracer.consume({
        type: 'llm:request',
        messages: [],
        tools: ['return_skill'],
        skill: { current: 'tell-time', stack: ['greeting'] },
      });
      await tracer.flush();

      const lines = readTraceLines(tempDir, 'test-10');
      expect(lines[0]).toHaveProperty('skill', { current: 'tell-time', stack: ['greeting'] });
    });
  });

  describe('目录和文件', () => {
    it('应该自动创建不存在的目录', async () => {
      const nestedDir = path.join(tempDir, 'a', 'b', 'c');
      const tracer = new TraceWriter('test-11', nestedDir);
      tracer.consume({
        type: 'tool:end',
        result: 'ok',
      });
      await tracer.flush();

      expect(fs.existsSync(path.join(nestedDir, 'test-11.jsonl'))).toBe(true);
    });

    it('应该支持追加模式（同一 session 多次 flush）', async () => {
      const tracer1 = new TraceWriter('test-12', tempDir);
      tracer1.consume({
        type: 'tool:end',
        result: 'first',
      });
      await tracer1.flush();

      const tracer2 = new TraceWriter('test-12', tempDir);
      tracer2.consume({
        type: 'tool:end',
        result: 'second',
      });
      await tracer2.flush();

      const lines = readTraceLines(tempDir, 'test-12');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toHaveProperty('result', 'first');
      expect(lines[1]).toHaveProperty('result', 'second');
    });
  });
});
