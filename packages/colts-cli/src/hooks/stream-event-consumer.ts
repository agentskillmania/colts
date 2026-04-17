/**
 * @fileoverview 流式事件消费者 — 统一处理 StreamEvent → TimelineEntry 转换
 *
 * 将 run/step/advance 三种执行模式中重复的事件处理逻辑收敛到一处。
 * 编排层（executeRun/executeStep/executeAdvance）只负责控制流差异。
 *
 * 每个 TimelineEntry 带有全局单调递增的 seq 序号，
 * 即使 React 批量更新合并了中间状态，按 seq 排序后条目顺序始终正确。
 *
 * Assistant entry 采用延迟创建策略：不在 resetAssistant() 时立即插入，
 * 而是在第一个 token 到达时才创建。这保证了 assistant entry 的 seq
 * 大于 step-start / phase-change 等结构性事件，渲染时顺序正确。
 */

import throttle from 'throttleit';
import type { AgentState } from '@agentskillmania/colts';
import type { StreamEvent, RunStreamEvent } from '@agentskillmania/colts';
import type { TimelineEntry } from '../types/timeline.js';
import { nextSeq } from '../types/timeline.js';

/** setEntries 回调类型 */
export type SetEntries = React.Dispatch<React.SetStateAction<TimelineEntry[]>>;

/** setState 回调类型 */
export type SetState = React.Dispatch<React.SetStateAction<AgentState | null>>;

/**
 * 模式特化的钩子回调
 *
 * 不同执行模式通过这些回调注入差异行为，事件处理本身由 Consumer 统一完成。
 */
export interface EventHooks {
  /** tool:end 后的额外处理。run 模式在此创建新 assistant entry，step/advance 不需要 */
  onToolEnd?: () => void;

  /** phase-change 事件的额外处理。advance 模式在此 flush + 暂停，run/step 不需要 */
  onPhaseChange?: (event: Extract<StreamEvent, { type: 'phase-change' }>) => void;
}

/** 渲染节流间隔（毫秒） */
const RENDER_INTERVAL_MS = 50;

/**
 * 流式事件消费者
 *
 * 消费 StreamEvent 事件，将其转换为 TimelineEntry 并更新 UI 状态。
 * token 累积使用 throttle（50ms）节流渲染，避免每个 token 都触发 setEntries。
 *
 * @remarks
 * 用法：
 * ```typescript
 * const consumer = new StreamEventConsumer(setEntries, setState, {
 *   onToolEnd: () => consumer.resetAssistant(),
 * });
 *
 * // 在事件循环中
 * for await (const event of generator) {
 *   consumer.consume(event);
 * }
 *
 * // 结束后
 * consumer.flush();
 * ```
 */
export class StreamEventConsumer {
  /** 当前 assistant entry 的 ID */
  private assistantId: string;

  /** 当前 assistant entry 的 seq */
  private assistantSeq: number;

  /** 累积的文本内容 */
  private accumulatedContent = '';

  /** 节流后的 flush 函数 */
  private throttledFlush: () => void;

  /** 是否已销化（finalize 后不再处理事件） */
  private disposed = false;

  /** 工具开始时间记录（key 为 tool entry seq） */
  private toolStartTimes = new Map<number, number>();

  /** assistant entry 是否已插入 timeline（延迟创建标志） */
  private assistantInserted = false;

  /**
   * @param setEntries - React state setter for timeline entries
   * @param setState - React state setter for agent state
   * @param hooks - 模式特化的钩子回调
   */
  constructor(
    private readonly setEntries: SetEntries,
    private readonly setState: SetState,
    private readonly hooks: EventHooks = {}
  ) {
    this.assistantSeq = nextSeq();
    this.assistantId = this.uid();

    // 创建节流 flush：50ms 内最多调用一次 setEntries 更新 assistant 内容
    this.throttledFlush = throttle(() => {
      this.doFlush();
    }, RENDER_INTERVAL_MS);
  }

  // ── 公共 API ──

  /** 消费一个流式事件 */
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
        // 由 TraceWriter 记录，不需要 UI 展示
        break;
      }
    }
  }

  /**
   * 强制刷出所有累积的 token 到 UI
   *
   * 在 phase 切换、工具调用、错误、完成时调用。
   */
  flush(): void {
    // throttleit 的 throttle 函数没有 cancel()，直接调 doFlush 跳过节流
    this.doFlush();
  }

  /**
   * 重置 assistant 状态，准备接收新的 token 流
   *
   * 延迟创建策略：只重置内部状态，不立即插入 entry。
   * 第一个 token 到达时才真正创建 assistant entry（保证 seq 顺序正确）。
   *
   * 在 tool:end 后（run 模式）或 calling-llm phase 前（advance 模式）调用。
   */
  resetAssistant(): void {
    this.flush();
    this.assistantSeq = nextSeq();
    this.assistantId = this.uid();
    this.accumulatedContent = '';
    this.assistantInserted = false;
  }

  /**
   * 将 assistant entry 标记为不再 streaming，并设置最终内容
   *
   * @param content - 最终内容，如果为空则使用累积的内容
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

  /** 获取累积的文本内容 */
  getAccumulatedContent(): string {
    return this.accumulatedContent;
  }

  /** 获取当前 assistant entry ID */
  getAssistantId(): string {
    return this.assistantId;
  }

  // ── 事件处理 ──

  /** token 事件：延迟创建 assistant entry，累积文本，节流更新 UI */
  private handleToken(event: Extract<StreamEvent, { type: 'token' }>): void {
    if (event.token) {
      this.accumulatedContent += event.token;
      // 只在有非空白内容时才创建 assistant entry（避免纯换行产生空 entry）
      if (this.accumulatedContent.trim()) {
        this.ensureAssistantInserted();
      }
      if (this.assistantInserted) {
        this.throttledFlush();
      }
    }
  }

  /** tool:start 事件：flush token，停止 assistant streaming，创建 tool entry */
  private handleToolStart(event: Extract<StreamEvent, { type: 'tool:start' }>): void {
    this.flush();
    // 只在已有 assistant entry 时才标记 streaming 结束
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

  /** tool:end 事件：更新 tool entry 的结果，计算 duration，调用模式特化钩子 */
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

  /** tools:start 事件：flush token，停止 assistant streaming，批量创建 tool entry */
  private handleToolsStart(event: Extract<StreamEvent, { type: 'tools:start' }>): void {
    this.flush();
    // 只在已有 assistant entry 时才标记 streaming 结束
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

  /** tools:end 事件：从后往前匹配 isRunning 的 tool 条目，更新结果和 duration */
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

  /** phase-change 事件：创建 phase entry，调用模式特化钩子 */
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

  /** error 事件：flush，创建 error entry */
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

  /** compressing 事件 */
  private handleCompressing(): void {
    this.addEntry({
      type: 'compress',
      id: this.uid(),
      seq: nextSeq(),
      status: 'compressing',
      timestamp: Date.now(),
    });
  }

  /** compressed 事件 */
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

  /** skill:start 事件 */
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

  /** skill:end 事件 */
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

  /** skill:loading 事件 */
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

  /** skill:loaded 事件 */
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

  /** subagent:start 事件 */
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

  /** subagent:end 事件 */
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

  /** step:start 事件 */
  private handleStepStart(event: Extract<RunStreamEvent, { type: 'step:start' }>): void {
    this.addEntry({
      type: 'step-start',
      id: this.uid(),
      seq: nextSeq(),
      step: event.step,
      timestamp: Date.now(),
    });
  }

  /** step:end 事件 */
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

  /** llm:request 事件：记录发送给 LLM 的请求概要（verbose only） */
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

  /** llm:response 事件：记录 LLM 返回的响应概要（verbose only） */
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

  // ── 内部工具 ──

  /**
   * 确保 assistant entry 已插入 timeline
   *
   * 延迟创建的核心：只在第一个 token 或需要标记 isStreaming=false 时才真正创建 entry。
   * 这保证 assistant entry 的 seq 大于 step-start 等结构性事件，渲染顺序正确。
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

  /** 实际执行 flush：把累积内容写入 assistant entry */
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

  /** 追加一条 TimelineEntry */
  private addEntry(entry: TimelineEntry): void {
    this.setEntries((prev) => [...prev, entry]);
  }

  /** 生成唯一 ID */
  private uid(): string {
    return `entry-${++idCounter}`;
  }
}

/** 全局 ID 计数器 */
let idCounter = 0;
