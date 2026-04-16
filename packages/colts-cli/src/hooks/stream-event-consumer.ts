/**
 * @fileoverview 流式事件消费者 — 统一处理 StreamEvent → TimelineEntry 转换
 *
 * 将 run/step/advance 三种执行模式中重复的事件处理逻辑收敛到一处。
 * 编排层（executeRun/executeStep/executeAdvance）只负责控制流差异。
 */

import throttle from 'throttleit';
import type { AgentState } from '@agentskillmania/colts';
import type { StreamEvent, RunStreamEvent } from '@agentskillmania/colts';
import type { TimelineEntry } from '../types/timeline.js';

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

  /** 累积的文本内容 */
  private accumulatedContent = '';

  /** 节流后的 flush 函数 */
  private throttledFlush: () => void;

  /** 是否已销毁（finalize 后不再处理事件） */
  private disposed = false;

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

      case 'complete':
      case 'llm:request':
      case 'llm:response': {
        // 这些事件由 TraceWriter 记录，不需要 UI 展示
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
   * 创建新的 assistant entry，重置累积内容
   *
   * 在 tool:end 后（run 模式）或 calling-llm phase 前（advance 模式）调用。
   */
  resetAssistant(): void {
    this.flush();
    this.assistantId = this.uid();
    this.accumulatedContent = '';
    this.addEntry({
      type: 'assistant',
      id: this.assistantId,
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    });
  }

  /**
   * 将 assistant entry 标记为不再 streaming，并设置最终内容
   *
   * @param content - 最终内容，如果为空则使用累积的内容
   */
  finalizeAssistant(content?: string): void {
    this.flush();
    const id = this.assistantId;
    const c = content ?? this.accumulatedContent;
    this.setEntries((prev) =>
      prev.map((e) =>
        e.type === 'assistant' && e.id === id ? { ...e, content: c, isStreaming: false } : e
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

  /** token 事件：累积文本，节流更新 UI */
  private handleToken(event: Extract<StreamEvent, { type: 'token' }>): void {
    if (event.token) {
      this.accumulatedContent += event.token;
      this.throttledFlush();
    }
  }

  /** tool:start 事件：flush token，停止 assistant streaming，创建 tool entry */
  private handleToolStart(event: Extract<StreamEvent, { type: 'tool:start' }>): void {
    this.flush();
    const id = this.assistantId;
    this.setEntries((prev) =>
      prev.map((e) => (e.type === 'assistant' && e.id === id ? { ...e, isStreaming: false } : e))
    );
    this.addEntry({
      type: 'tool',
      id: this.uid(),
      tool: event.action.tool,
      args: event.action.arguments,
      isRunning: true,
      timestamp: Date.now(),
    });
  }

  /** tool:end 事件：更新 tool entry 的结果，调用模式特化钩子 */
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
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          result: event.result,
          isRunning: false,
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
    const id = this.assistantId;
    this.setEntries((prev) =>
      prev.map((e) => (e.type === 'assistant' && e.id === id ? { ...e, isStreaming: false } : e))
    );
    for (const action of event.actions) {
      this.addEntry({
        type: 'tool',
        id: this.uid(),
        tool: action.tool,
        args: action.arguments,
        isRunning: true,
        timestamp: Date.now(),
      });
    }
  }

  /** tools:end 事件：从后往前匹配 isRunning 的 tool 条目，更新结果 */
  private handleToolsEnd(event: Extract<StreamEvent, { type: 'tools:end' }>): void {
    this.setEntries((prev) => {
      const next = [...prev];
      const keys = Object.keys(event.results);
      let ki = keys.length - 1;
      for (let i = next.length - 1; i >= 0 && ki >= 0; i--) {
        if (next[i].type === 'tool' && (next[i] as { isRunning?: boolean }).isRunning) {
          const callId = keys[ki];
          next[i] = {
            ...next[i],
            result: event.results[callId],
            isRunning: false,
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
    const id = this.assistantId;
    this.setEntries((prev) => [
      ...prev.map((e) =>
        e.type === 'assistant' && e.id === id ? { ...e, isStreaming: false } : e
      ),
      {
        type: 'phase',
        id: this.uid(),
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
    const id = this.assistantId;
    this.setEntries((prev) => [
      ...prev.map((e) =>
        e.type === 'assistant' && e.id === id ? { ...e, isStreaming: false } : e
      ),
      { type: 'error', id: this.uid(), message: errMsg, timestamp: Date.now() },
    ]);
  }

  /** compressing 事件 */
  private handleCompressing(): void {
    this.addEntry({
      type: 'compress',
      id: this.uid(),
      status: 'compressing',
      timestamp: Date.now(),
    });
  }

  /** compressed 事件 */
  private handleCompressed(event: Extract<StreamEvent, { type: 'compressed' }>): void {
    this.addEntry({
      type: 'compress',
      id: this.uid(),
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
      name: event.name,
      result: event.result,
      status: 'end',
      timestamp: Date.now(),
    });
  }

  /** step:start 事件 */
  private handleStepStart(event: Extract<RunStreamEvent, { type: 'step:start' }>): void {
    this.addEntry({ type: 'step-start', id: this.uid(), step: event.step, timestamp: Date.now() });
  }

  /** step:end 事件 */
  private handleStepEnd(event: Extract<RunStreamEvent, { type: 'step:end' }>): void {
    this.addEntry({
      type: 'step-end',
      id: this.uid(),
      step: event.step,
      result: event.result,
      timestamp: Date.now(),
    });
  }

  // ── 内部工具 ──

  /** 实际执行 flush：把累积内容写入 assistant entry */
  private doFlush(): void {
    const content = this.accumulatedContent;
    const id = this.assistantId;
    this.setEntries((prev) =>
      prev.map((e) => (e.type === 'assistant' && e.id === id ? { ...e, content } : e))
    );
  }

  /** 追加一条 TimelineEntry */
  private addEntry(entry: TimelineEntry): void {
    this.setEntries((prev) => [...prev, entry]);
  }

  /** 生成唯一 ID */
  private uid(): string {
    return `entry-${Date.now()}-${++idCounter}`;
  }
}

/** 全局 ID 计数器 */
let idCounter = 0;

/** 渲染节流间隔（毫秒） */
const RENDER_INTERVAL_MS = 50;
