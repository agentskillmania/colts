/**
 * @fileoverview 执行过程追踪日志写入器
 *
 * 记录所有 RunStreamEvent 为 JSONL 格式，每个事件对应一条 trace record。
 * 与 session 快照对称：session 记录最终状态，trace 记录完整执行过程。
 *
 * 特性：
 * - 双时间戳：ISO 8601（人可读）+ elapsed ms（调试间隔）
 * - tool 配对计时：tool:start → tool:end 自动计算 durationMs
 * - 大字段截断：避免 trace 文件膨胀
 * - 构造时写 trace.start，flush 时写 trace.end
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { RunStreamEvent } from '@agentskillmania/colts';

/** 追踪日志默认存储目录 */
const DEFAULT_TRACE_DIR = path.join(os.homedir(), '.agentskillmania', 'colts', 'traces');

/** 大字段截断长度 */
const TRUNCATE_MAX_LENGTH = 200;

/**
 * 截断字符串到指定长度
 *
 * 超长部分用 "..." 省略。
 *
 * @param value - 要截断的值
 * @param maxLength - 最大长度
 * @returns 截断后的字符串
 */
function truncate(value: unknown, maxLength: number = TRUNCATE_MAX_LENGTH): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (!str) return '';
  return str.length > maxLength ? str.slice(0, maxLength) + '...' : str;
}

/**
 * 追踪日志记录类型
 *
 * 所有记录都有 ts（ISO 8601）和 elapsed（毫秒）两个时间字段。
 */
type TraceRecord =
  // 包裹事件
  | { event: 'trace.start'; ts: string; elapsed: 0; sessionId: string }
  | { event: 'trace.end'; ts: string; elapsed: number; totalEvents: number }
  // run/step 事件
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
  // LLM 事件
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
  // tool 事件
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
  // 错误
  | { event: 'error'; ts: string; elapsed: number; message: string; context: string }
  // skill 事件
  | { event: 'skill.loading'; ts: string; elapsed: number; name: string }
  | { event: 'skill.loaded'; ts: string; elapsed: number; name: string; tokenCount: number }
  | { event: 'skill.start'; ts: string; elapsed: number; name: string; task: string }
  | { event: 'skill.end'; ts: string; elapsed: number; name: string; result: string }
  // subagent 事件
  | { event: 'subagent.start'; ts: string; elapsed: number; name: string; task: string }
  | { event: 'subagent.end'; ts: string; elapsed: number; name: string; result: string }
  // 压缩事件
  | { event: 'compress.start'; ts: string; elapsed: number }
  | {
      event: 'compress.end';
      ts: string;
      elapsed: number;
      summary: string;
      removedCount: number;
    }
  // run 结束
  | {
      event: 'run.end';
      ts: string;
      elapsed: number;
      result: string;
      totalSteps: number;
      answer?: string;
    };

/**
 * 执行过程追踪写入器
 *
 * @example
 * ```typescript
 * const tracer = new TraceWriter(sessionId);
 * for await (const event of runner.runStream(state, ...)) {
 *   tracer.consume(event);
 *   // ... 处理事件
 * }
 * await tracer.flush();
 * ```
 */
export class TraceWriter {
  private stream: fs.WriteStream;
  private startTime: number;
  private eventCount = 0;
  /** tool:start 信息记录，key 是 action.id */
  private toolStartInfos = new Map<string, { startTime: number; tool: string; callId: string }>();
  /** tools:start 时间戳记录，用于多 tool 并行调用 */
  private toolsStartTime: number | null = null;

  /**
   * @param sessionId - 会话 ID，作为文件名
   * @param traceDir - 可选自定义输出目录（用于测试隔离）
   */
  constructor(sessionId: string, traceDir?: string) {
    const dir = traceDir ?? DEFAULT_TRACE_DIR;
    fs.mkdirSync(dir, { recursive: true });
    this.stream = fs.createWriteStream(path.join(dir, `${sessionId}.jsonl`), { flags: 'a' });

    this.startTime = Date.now();

    // 写入 trace.start 标记
    const record: TraceRecord = {
      event: 'trace.start',
      ts: new Date().toISOString(),
      elapsed: 0,
      sessionId,
    };
    this.write(record);
  }

  /**
   * 从事件流中提取 trace 记录并写入
   *
   * 记录所有 RunStreamEvent（token 除外）。
   *
   * @param event - 来自 runStream 的事件
   */
  consume(event: RunStreamEvent): void {
    const record = this.toRecord(event);
    if (record) {
      this.eventCount++;
      this.write(record);
    }
  }

  /**
   * 刷新并关闭写入流
   *
   * 必须在会话结束时调用，确保所有数据落盘。
   * 写入 trace.end 标记后关闭流。
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
   * 生成当前时间戳和 elapsed
   */
  private timestamp(): { ts: string; elapsed: number } {
    return {
      ts: new Date().toISOString(),
      elapsed: Date.now() - this.startTime,
    };
  }

  /**
   * 将 RunStreamEvent 转换为 TraceRecord
   */
  private toRecord(event: RunStreamEvent): TraceRecord | null {
    const { ts, elapsed } = this.timestamp();

    switch (event.type) {
      // token 不记录，量大且最终文本在 session 和 llm.response 里已有
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
        // 记录开始时间和 action 信息，用于 tool:end 配对
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
        // 从 tool:start 配对获取 durationMs 和 tool/callId 信息
        const info = this.getFirstToolStartInfo();
        const durationMs = info !== null ? Date.now() - info.startTime : null;
        return {
          event: 'tool.end',
          ts,
          elapsed,
          tool: info?.tool ?? '',
          result: truncate(event.result),
          durationMs,
          callId: info?.callId ?? '',
        };
      }

      case 'tools:start': {
        this.toolsStartTime = Date.now();
        // 记录每个 action 的信息
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
   * 获取第一个 tool:start 的信息并从 map 中移除
   *
   * 用于 tool:end 事件（没有 callId/tool）配对计时和信息关联。
   */
  private getFirstToolStartInfo(): { startTime: number; tool: string; callId: string } | null {
    const firstKey = this.toolStartInfos.keys().next().value;
    if (firstKey === undefined) return null;
    const info = this.toolStartInfos.get(firstKey)!;
    this.toolStartInfos.delete(firstKey);
    return info;
  }

  /**
   * 写入一行 JSONL
   */
  private write(data: TraceRecord): void {
    this.stream.write(JSON.stringify(data) + '\n');
  }
}
