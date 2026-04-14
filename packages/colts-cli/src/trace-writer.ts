/**
 * @fileoverview 执行过程追踪日志写入器
 *
 * 监听 RunStreamEvent，过滤出关键事件，追加写入 JSONL 文件。
 * 与 session 快照对称：session 记录最终状态，trace 记录执行过程。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { RunStreamEvent } from '@agentskillmania/colts';

/** 追踪日志默认存储目录 */
const DEFAULT_TRACE_DIR = path.join(os.homedir(), '.agentskillmania', 'colts', 'traces');

/**
 * 追踪日志记录类型
 */
type TraceRecord =
  | {
      type: 'llm.call';
      timestamp: number;
      messages: Array<{ role: string; content: string }>;
      tools: string[];
      skill: { current: string | null; stack: string[] } | null;
    }
  | {
      type: 'llm.response';
      timestamp: number;
      text: string;
      toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | null;
    }
  | { type: 'tool.result'; timestamp: number; result: unknown }
  | { type: 'step.end'; timestamp: number; step: number; result: string };

/**
 * 执行过程追踪写入器
 *
 * 从 RunStreamEvent 中提取关键信息，追加写入 JSONL 文件。
 * 每次 consume 调用只做同步写入（低延迟），flush 时关闭流。
 *
 * @example
 * ```typescript
 * const tracer = new TraceWriter(sessionId);
 * for await (const event of runner.runStream(state, ...)) {
 *   tracer.consume(event);
 *   // ... 现有的事件处理逻辑
 * }
 * await tracer.flush();
 * ```
 */
export class TraceWriter {
  private stream: fs.WriteStream;

  /**
   * @param sessionId - 会话 ID，作为文件名
   * @param traceDir - 可选的自定义输出目录（用于测试隔离）
   */
  constructor(sessionId: string, traceDir?: string) {
    const dir = traceDir ?? DEFAULT_TRACE_DIR;
    // 确保目录存在
    fs.mkdirSync(dir, { recursive: true });
    this.stream = fs.createWriteStream(path.join(dir, `${sessionId}.jsonl`), { flags: 'a' });
  }

  /**
   * 从事件流中提取 trace 记录并写入
   *
   * 只处理 4 种事件类型，其余忽略。
   *
   * @param event - 来自 runStream 的事件
   */
  consume(event: RunStreamEvent): void {
    const record = this.toRecord(event);
    if (record) {
      this.write(record);
    }
  }

  /**
   * 刷新并关闭写入流
   *
   * 必须在会话结束时调用，确保所有数据落盘。
   */
  async flush(): Promise<void> {
    return new Promise((resolve) => {
      this.stream.end(resolve);
    });
  }

  /**
   * 将 RunStreamEvent 转换为 TraceRecord
   */
  private toRecord(event: RunStreamEvent): TraceRecord | null {
    const timestamp = Date.now();
    switch (event.type) {
      case 'llm:request':
        return {
          type: 'llm.call',
          timestamp,
          messages: event.messages,
          tools: event.tools,
          skill: event.skill,
        };
      case 'llm:response':
        return { type: 'llm.response', timestamp, text: event.text, toolCalls: event.toolCalls };
      case 'tool:end':
        return { type: 'tool.result', timestamp, result: event.result };
      case 'step:end':
        return { type: 'step.end', timestamp, step: event.step, result: event.result.type };
      default:
        return null;
    }
  }

  /**
   * 写入一行 JSONL
   */
  private write(data: TraceRecord): void {
    this.stream.write(JSON.stringify(data) + '\n');
  }
}
