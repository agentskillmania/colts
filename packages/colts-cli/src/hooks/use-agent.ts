/**
 * @fileoverview Agent 交互 hook — 管理时间线、执行模式、展示级别
 *
 * 核心职责：
 * - 消息发送与接收（流式）
 * - 执行模式切换（run / step / advance）
 * - 展示级别切换（compact / detail / verbose）
 * - 命令解析
 * - StreamEvent → TimelineEntry 转换
 */

import { useState, useCallback, useRef } from 'react';
import type { AgentRunner, AgentState, ISkillProvider } from '@agentskillmania/colts';
import { createAgentState, addUserMessage, createExecutionState } from '@agentskillmania/colts';
import type { TimelineEntry, DetailLevel } from '../types/timeline.js';

/**
 * 执行模式
 *
 * - run: 全量执行（runStream），自动循环到完成
 * - step: 单步执行（stepStream），一个 ReAct 周期
 * - advance: 微步执行（advanceStream），一次 phase 推进
 */
export type ExecutionMode = 'run' | 'step' | 'advance';

/**
 * 解析后的命令
 */
export interface ParsedCommand {
  type:
    | 'mode-run'
    | 'mode-step'
    | 'mode-advance'
    | 'show-compact'
    | 'show-detail'
    | 'show-verbose'
    | 'clear'
    | 'help'
    | 'skill'
    | 'message';
  raw: string;
  skillName?: string;
}

/**
 * 解析用户输入为命令
 *
 * @param input - 原始输入文本
 * @returns 解析后的命令对象
 */
export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();

  if (trimmed === '/run') return { type: 'mode-run', raw: trimmed };
  if (trimmed === '/step') return { type: 'mode-step', raw: trimmed };
  if (trimmed === '/advance') return { type: 'mode-advance', raw: trimmed };
  if (trimmed === '/show:compact' || trimmed === '/compact')
    return { type: 'show-compact', raw: trimmed };
  if (trimmed === '/show:detail' || trimmed === '/detail')
    return { type: 'show-detail', raw: trimmed };
  if (trimmed === '/show:verbose' || trimmed === '/verbose')
    return { type: 'show-verbose', raw: trimmed };
  if (trimmed === '/clear') return { type: 'clear', raw: trimmed };
  if (trimmed === '/help') return { type: 'help', raw: trimmed };
  if (trimmed.startsWith('/skill '))
    return { type: 'skill', raw: trimmed, skillName: trimmed.slice(7).trim() };

  return { type: 'message', raw: trimmed };
}

/**
 * useAgent hook 返回值
 */
export interface UseAgentReturn {
  /** 时间线条目列表 */
  entries: TimelineEntry[];
  /** 当前执行模式 */
  mode: ExecutionMode;
  /** 展示级别 */
  detailLevel: DetailLevel;
  /** agent 是否正在运行 */
  isRunning: boolean;
  /** agent 是否暂停，等待用户输入继续 */
  isPaused: boolean;
  /** 当前 AgentState */
  state: AgentState | null;
  /** 发送消息或命令 */
  sendMessage: (input: string) => Promise<void>;
  /** 设置执行模式 */
  setMode: (mode: ExecutionMode) => void;
  /** 设置展示级别 */
  setDetailLevel: (level: DetailLevel) => void;
  /** 清空条目 */
  clearEntries: () => void;
  /** 中断正在运行的 agent（优雅终止） */
  abort: () => void;
}

/** 生成唯一 ID */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Agent 交互 hook
 *
 * 管理 AgentRunner 的对话流程。支持三种执行模式和三种展示级别。
 *
 * @param runner - AgentRunner 实例（可以为 null）
 * @param initialState - 初始 AgentState（可以为 null，自动创建）
 * @param skillProvider - Skill 提供者（可选，用于 /skill 命令）
 * @returns Agent 交互状态和操作方法
 */
export function useAgent(
  runner: AgentRunner | null,
  initialState: AgentState | null,
  skillProvider?: ISkillProvider
): UseAgentReturn {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [mode, setMode] = useState<ExecutionMode>('run');
  const [detailLevel, setDetailLevelState] = useState<DetailLevel>('compact');
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [state, setState] = useState<AgentState | null>(initialState);

  // 暂停/继续机制（step/advance 模式）
  const continueFnRef = useRef<(() => void) | null>(null);
  // AbortController 用于优雅中断
  const abortControllerRef = useRef<AbortController | null>(null);

  /** 解除暂停，让 step/advance 继续 */
  const resumeExecution = useCallback(() => {
    if (continueFnRef.current) {
      continueFnRef.current();
      continueFnRef.current = null;
    }
  }, []);

  /** 清空所有条目 */
  const clearEntries = useCallback(() => {
    setEntries([]);
  }, []);

  /** 添加系统条目 */
  const addSystemEntry = useCallback((content: string) => {
    setEntries((prev) => [...prev, { type: 'system', id: uid(), content, timestamp: Date.now() }]);
  }, []);

  /** 添加错误条目 */
  const addErrorEntry = useCallback((message: string) => {
    setEntries((prev) => [...prev, { type: 'error', id: uid(), message, timestamp: Date.now() }]);
  }, []);

  /**
   * 发送消息或执行命令
   *
   * @param input - 用户输入
   */
  const sendMessage = useCallback(
    async (input: string) => {
      const command = parseCommand(input);

      // 暂停状态下，空输入 = 继续
      if (isPaused && command.type === 'message' && !input.trim()) {
        setIsPaused(false);
        resumeExecution();
        return;
      }

      // 处理命令
      switch (command.type) {
        case 'mode-run':
          setMode('run');
          addSystemEntry('Switched to RUN mode');
          return;

        case 'mode-step':
          setMode('step');
          addSystemEntry('Switched to STEP mode');
          return;

        case 'mode-advance':
          setMode('advance');
          addSystemEntry('Switched to ADVANCE mode');
          return;

        case 'show-compact':
          setDetailLevelState('compact');
          addSystemEntry('Detail level: compact');
          return;

        case 'show-detail':
          setDetailLevelState('detail');
          addSystemEntry('Detail level: detail');
          return;

        case 'show-verbose':
          setDetailLevelState('verbose');
          addSystemEntry('Detail level: verbose');
          return;

        case 'clear':
          clearEntries();
          return;

        case 'help':
          addSystemEntry(
            'Commands: /run /step /advance | /compact /detail /verbose | /skill <name> /clear /help'
          );
          return;

        case 'skill': {
          const skillName = command.skillName;
          if (!skillName) {
            addSystemEntry('Usage: /skill <name>');
            return;
          }
          if (!skillProvider) {
            addSystemEntry('Skill provider not configured');
            return;
          }
          try {
            const manifest = skillProvider.getManifest(skillName);
            if (!manifest) {
              const available = skillProvider
                .listSkills()
                .map((s) => s.name)
                .join(', ');
              addSystemEntry(`Skill '${skillName}' not found. Available: ${available || 'none'}`);
              return;
            }
            const instructions = await skillProvider.loadInstructions(skillName);
            setEntries((prev) => [
              ...prev,
              {
                type: 'system',
                id: uid(),
                content: `Skill '${skillName}' loaded (${instructions.length} chars)`,
                timestamp: Date.now(),
              },
              {
                type: 'system',
                id: uid(),
                content: `[Skill: ${skillName}]\n${instructions}`,
                timestamp: Date.now(),
              },
            ]);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            addSystemEntry(`Failed to load skill: ${msg}`);
          }
          return;
        }

        case 'message':
          break;
      }

      if (!runner) {
        addSystemEntry('Agent not ready, check configuration');
        return;
      }

      // 确保有有效的 state（无则自动创建）
      const currentState =
        state ??
        createAgentState({
          name: 'colts-agent',
          instructions: 'You are a helpful assistant.',
          tools: [],
        });

      // 添加用户消息条目
      setEntries((prev) => [
        ...prev,
        { type: 'user', id: uid(), content: input.trim(), timestamp: Date.now() },
      ]);
      setIsRunning(true);

      // 创建 AbortController
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      const signal = abortController.signal;

      try {
        if (mode === 'run') {
          await executeRun(runner, currentState, input.trim(), setEntries, setState, signal);
        } else if (mode === 'step') {
          await executeStep(
            runner,
            currentState,
            input.trim(),
            setEntries,
            setState,
            signal,
            () =>
              new Promise<void>((resolve) => {
                continueFnRef.current = resolve;
                setIsPaused(true);
              })
          );
        } else {
          await executeAdvance(
            runner,
            currentState,
            input.trim(),
            setEntries,
            setState,
            signal,
            () =>
              new Promise<void>((resolve) => {
                continueFnRef.current = resolve;
                setIsPaused(true);
              })
          );
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        addErrorEntry(msg);
      } finally {
        setIsRunning(false);
        setIsPaused(false);
        abortControllerRef.current = null;
      }
    },
    [
      runner,
      state,
      mode,
      isPaused,
      clearEntries,
      addSystemEntry,
      addErrorEntry,
      skillProvider,
      resumeExecution,
    ]
  );

  /** 中断正在运行的 agent */
  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // 如果在暂停状态，也要解除暂停
    if (continueFnRef.current) {
      continueFnRef.current();
      continueFnRef.current = null;
    }
  }, []);

  return {
    entries,
    mode,
    detailLevel,
    isRunning,
    isPaused,
    state,
    sendMessage,
    setMode,
    setDetailLevel: setDetailLevelState,
    clearEntries,
    abort,
  };
}

// ──────────────────────────────────────────────────────────────
// 以下为流式执行函数，统一产出 TimelineEntry
// ──────────────────────────────────────────────────────────────

type SetEntries = React.Dispatch<React.SetStateAction<TimelineEntry[]>>;
type SetState = React.Dispatch<React.SetStateAction<AgentState | null>>;

/**
 * 节流渲染间隔（ms）
 *
 * LLM token 以 3-5 个/波的节奏到达（间隔 ~50ms），
 * 但每波内 1-5ms 就触发 3-5 次 setEntries，
 * React 18 自动批处理会将它们合并成一次渲染。
 * 用 setTimeout 节流到 ~50ms 一次，确保 Ink 每帧都能渲染。
 */
const RENDER_INTERVAL = 50;

/**
 * Run 模式流式执行
 *
 * 使用 runStream 进行完整 ReAct 循环（含工具调用）。
 * 手动 addUserMessage 后启动流。
 */
async function executeRun(
  runner: AgentRunner,
  currentState: AgentState,
  userInput: string,
  setEntries: SetEntries,
  setState: SetState,
  signal: AbortSignal
): Promise<void> {
  const stateWithMsg = addUserMessage(currentState, userInput);

  // 创建初始 assistant 条目
  let assistantId = uid();
  let accumulatedContent = '';
  // 节流渲染：避免每个 token 都触发 setEntries
  let renderTimer: ReturnType<typeof setTimeout> | null = null;

  /** 刷新 assistant 内容到 UI */
  const flushContent = () => {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    const content = accumulatedContent;
    const id = assistantId;
    setEntries((prev) =>
      prev.map((e) => (e.type === 'assistant' && e.id === id ? { ...e, content } : e))
    );
  };

  setEntries((prev) => [
    ...prev,
    { type: 'assistant', id: assistantId, content: '', timestamp: Date.now(), isStreaming: true },
  ]);

  try {
    const gen = runner.runStream(stateWithMsg, { signal });
    let iterResult = await gen.next();

    while (!iterResult.done) {
      const event = iterResult.value;

      switch (event.type) {
        // token 流式输出（节流）
        case 'token': {
          if (event.token) {
            accumulatedContent += event.token;
            if (!renderTimer) {
              renderTimer = setTimeout(() => {
                renderTimer = null;
                flushContent();
              }, RENDER_INTERVAL);
            }
          }
          break;
        }

        // 工具调用开始
        case 'tool:start': {
          // 先 flush 剩余 token，再切换到 tool 条目
          flushContent();
          // 停止当前 assistant 流式
          setEntries((prev) =>
            prev.map((e) =>
              e.type === 'assistant' && e.id === assistantId ? { ...e, isStreaming: false } : e
            )
          );
          // 添加 tool 条目
          const toolId = uid();
          setEntries((prev) => [
            ...prev,
            {
              type: 'tool',
              id: toolId,
              tool: event.action.tool,
              args: event.action.arguments,
              isRunning: true,
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        // 工具调用结束
        case 'tool:end': {
          // 更新最近的 running tool 条目，添加新 assistant 条目用于下一轮
          setEntries((prev) => {
            // 从后往前找最近的 isRunning tool
            let idx = -1;
            for (let i = prev.length - 1; i >= 0; i--) {
              const entry = prev[i];
              if (entry.type === 'tool' && entry.isRunning) {
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
          // 新 assistant 条目（下一轮 LLM 输出）
          assistantId = uid();
          accumulatedContent = '';
          setEntries((prev) => [
            ...prev,
            {
              type: 'assistant',
              id: assistantId,
              content: '',
              timestamp: Date.now(),
              isStreaming: true,
            },
          ]);
          break;
        }

        // 步骤边界
        case 'step:start': {
          setEntries((prev) => [
            ...prev,
            { type: 'step-start', id: uid(), step: event.step, timestamp: Date.now() },
          ]);
          break;
        }

        case 'step:end': {
          setEntries((prev) => [
            ...prev,
            {
              type: 'step-end',
              id: uid(),
              step: event.step,
              result: event.result,
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        // 上下文压缩
        case 'compressing': {
          setEntries((prev) => [
            ...prev,
            { type: 'compress', id: uid(), status: 'compressing', timestamp: Date.now() },
          ]);
          break;
        }

        case 'compressed': {
          setEntries((prev) => [
            ...prev,
            {
              type: 'compress',
              id: uid(),
              status: 'compressed',
              summary: event.summary,
              removedCount: event.removedCount,
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        // Phase 变化
        case 'phase-change': {
          setEntries((prev) => [
            ...prev,
            {
              type: 'phase',
              id: uid(),
              from: event.from.type,
              to: event.to.type,
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        // Skill 加载
        case 'skill:loading': {
          setEntries((prev) => [
            ...prev,
            {
              type: 'skill',
              id: uid(),
              name: event.name,
              status: 'loading',
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        case 'skill:loaded': {
          setEntries((prev) => [
            ...prev,
            {
              type: 'skill',
              id: uid(),
              name: event.name,
              status: 'loaded',
              tokenCount: event.tokenCount,
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        // SubAgent
        case 'subagent:start': {
          setEntries((prev) => [
            ...prev,
            {
              type: 'subagent',
              id: uid(),
              name: event.name,
              task: event.task,
              status: 'start',
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        case 'subagent:end': {
          setEntries((prev) => [
            ...prev,
            {
              type: 'subagent',
              id: uid(),
              name: event.name,
              result: event.result,
              status: 'end',
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        // 错误
        case 'error': {
          const errMsg = event.error instanceof Error ? event.error.message : String(event.error);
          setEntries((prev) => [
            ...prev.map((e) =>
              e.type === 'assistant' && e.id === assistantId ? { ...e, isStreaming: false } : e
            ),
            { type: 'error', id: uid(), message: errMsg, timestamp: Date.now() },
          ]);
          break;
        }

        // complete 事件 — 流结束
        case 'complete': {
          // handled after the loop
          break;
        }
      }

      iterResult = await gen.next();
    }

    // 最终结果
    if (iterResult.done && iterResult.value) {
      const { state: finalState, result: runResult } = iterResult.value;
      setState(finalState);
      // flush 残留 token
      flushContent();

      if (runResult.type === 'success') {
        setEntries((prev) =>
          prev.map((e) =>
            e.type === 'assistant' && e.id === assistantId
              ? { ...e, content: accumulatedContent || runResult.answer, isStreaming: false }
              : e
          )
        );
      } else if (runResult.type === 'max_steps') {
        setEntries((prev) => [
          ...prev.map((e) =>
            e.type === 'assistant' && e.id === assistantId ? { ...e, isStreaming: false } : e
          ),
          { type: 'run-complete', id: uid(), result: runResult, timestamp: Date.now() },
        ]);
      } else {
        // error result
        setEntries((prev) => [
          ...prev.map((e) =>
            e.type === 'assistant' && e.id === assistantId ? { ...e, isStreaming: false } : e
          ),
          { type: 'run-complete', id: uid(), result: runResult, timestamp: Date.now() },
        ]);
      }
    }
  } catch (error) {
    if (signal.aborted) return;
    const msg = error instanceof Error ? error.message : String(error);
    setEntries((prev) =>
      prev.map((e) =>
        e.type === 'assistant' && e.id === assistantId
          ? { ...e, content: `Error: ${msg}`, isStreaming: false }
          : e
      )
    );
  }
}

/**
 * Step 模式流式执行
 *
 * 使用 stepStream 执行一个 ReAct 周期。完成后暂停等待用户按 Enter 继续。
 */
async function executeStep(
  runner: AgentRunner,
  currentState: AgentState,
  userInput: string,
  setEntries: SetEntries,
  setState: SetState,
  signal: AbortSignal,
  pauseFn: () => Promise<void>
): Promise<void> {
  let runningState = currentState;
  let continueLoop = true;

  // 首次添加用户消息到 state
  if (userInput) {
    runningState = addUserMessage(runningState, userInput);
  }

  while (continueLoop) {
    if (signal.aborted) return;

    const assistantId = uid();
    let accumulatedContent = '';
    let renderTimer: ReturnType<typeof setTimeout> | null = null;

    /** 刷新 assistant 内容到 UI */
    const flushContent = () => {
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = null;
      }
      const content = accumulatedContent;
      const id = assistantId;
      setEntries((prev) =>
        prev.map((e) => (e.type === 'assistant' && e.id === id ? { ...e, content } : e))
      );
    };

    setEntries((prev) => [
      ...prev,
      { type: 'assistant', id: assistantId, content: '', timestamp: Date.now(), isStreaming: true },
    ]);

    try {
      const gen = runner.stepStream(runningState, undefined, { signal });
      let iterResult = await gen.next();

      while (!iterResult.done) {
        const event = iterResult.value;

        switch (event.type) {
          case 'token': {
            if (event.token) {
              accumulatedContent += event.token;
              if (!renderTimer) {
                renderTimer = setTimeout(() => {
                  renderTimer = null;
                  flushContent();
                }, RENDER_INTERVAL);
              }
            }
            break;
          }

          case 'tool:start': {
            flushContent();
            setEntries((prev) =>
              prev.map((e) =>
                e.type === 'assistant' && e.id === assistantId ? { ...e, isStreaming: false } : e
              )
            );
            setEntries((prev) => [
              ...prev,
              {
                type: 'tool',
                id: uid(),
                tool: event.action.tool,
                args: event.action.arguments,
                isRunning: true,
                timestamp: Date.now(),
              },
            ]);
            break;
          }

          case 'tool:end': {
            setEntries((prev) => {
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
            break;
          }

          case 'phase-change': {
            setEntries((prev) => [
              ...prev,
              {
                type: 'phase',
                id: uid(),
                from: event.from.type,
                to: event.to.type,
                timestamp: Date.now(),
              },
            ]);
            break;
          }

          case 'error': {
            const errMsg = event.error instanceof Error ? event.error.message : String(event.error);
            setEntries((prev) => [
              ...prev.map((e) =>
                e.type === 'assistant' && e.id === assistantId ? { ...e, isStreaming: false } : e
              ),
              { type: 'error', id: uid(), message: errMsg, timestamp: Date.now() },
            ]);
            break;
          }

          case 'compressing': {
            setEntries((prev) => [
              ...prev,
              { type: 'compress', id: uid(), status: 'compressing', timestamp: Date.now() },
            ]);
            break;
          }

          case 'compressed': {
            setEntries((prev) => [
              ...prev,
              {
                type: 'compress',
                id: uid(),
                status: 'compressed',
                summary: event.summary,
                removedCount: event.removedCount,
                timestamp: Date.now(),
              },
            ]);
            break;
          }

          case 'skill:loading': {
            setEntries((prev) => [
              ...prev,
              {
                type: 'skill',
                id: uid(),
                name: event.name,
                status: 'loading',
                timestamp: Date.now(),
              },
            ]);
            break;
          }

          case 'skill:loaded': {
            setEntries((prev) => [
              ...prev,
              {
                type: 'skill',
                id: uid(),
                name: event.name,
                status: 'loaded',
                tokenCount: event.tokenCount,
                timestamp: Date.now(),
              },
            ]);
            break;
          }

          case 'subagent:start': {
            setEntries((prev) => [
              ...prev,
              {
                type: 'subagent',
                id: uid(),
                name: event.name,
                task: event.task,
                status: 'start',
                timestamp: Date.now(),
              },
            ]);
            break;
          }

          case 'subagent:end': {
            setEntries((prev) => [
              ...prev,
              {
                type: 'subagent',
                id: uid(),
                name: event.name,
                result: event.result,
                status: 'end',
                timestamp: Date.now(),
              },
            ]);
            break;
          }
        }

        iterResult = await gen.next();
      }

      // Step 完成
      if (iterResult.done && iterResult.value) {
        const { state: newState, result: stepResult } = iterResult.value;
        runningState = newState;
        setState(newState);

        // flush 残留 token
        flushContent();

        if (stepResult.type === 'done') {
          setEntries((prev) =>
            prev.map((e) =>
              e.type === 'assistant' && e.id === assistantId
                ? { ...e, content: accumulatedContent || stepResult.answer, isStreaming: false }
                : e
            )
          );
          continueLoop = false;
          return;
        }

        // Step 完成但需要更多步骤 — 暂停等待
        setEntries((prev) => [
          ...prev.map((e) =>
            e.type === 'assistant' && e.id === assistantId ? { ...e, isStreaming: false } : e
          ),
          {
            type: 'system',
            id: uid(),
            content: 'Step complete. Press Enter to continue.',
            timestamp: Date.now(),
          },
        ]);

        await pauseFn();
      }
    } catch (error) {
      if (signal.aborted) return;
      flushContent();
      const msg = error instanceof Error ? error.message : String(error);
      setEntries((prev) =>
        prev.map((e) =>
          e.type === 'assistant' && e.id === assistantId
            ? { ...e, content: `Error: ${msg}`, isStreaming: false }
            : e
        )
      );
      continueLoop = false;
      return;
    }
  }
}

/**
 * Advance 模式流式执行
 *
 * 使用 advanceStream 执行一次 phase 推进。每次 phase 变化后暂停等待。
 */
async function executeAdvance(
  runner: AgentRunner,
  currentState: AgentState,
  userInput: string,
  setEntries: SetEntries,
  setState: SetState,
  signal: AbortSignal,
  pauseFn: () => Promise<void>
): Promise<void> {
  const execState = createExecutionState();

  let effectiveState = currentState;
  if (userInput) {
    effectiveState = addUserMessage(effectiveState, userInput);
  }

  let assistantId = uid();
  let accumulatedContent = '';
  let renderTimer: ReturnType<typeof setTimeout> | null = null;

  /** 刷新 assistant 内容到 UI */
  const flushContent = () => {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    const content = accumulatedContent;
    const id = assistantId;
    setEntries((prev) =>
      prev.map((e) => (e.type === 'assistant' && e.id === id ? { ...e, content } : e))
    );
  };

  setEntries((prev) => [
    ...prev,
    { type: 'assistant', id: assistantId, content: '', timestamp: Date.now(), isStreaming: true },
  ]);

  try {
    const gen = runner.advanceStream(effectiveState, execState, undefined, { signal });
    let iterResult = await gen.next();

    while (!iterResult.done) {
      const event = iterResult.value;

      switch (event.type) {
        case 'token': {
          if (event.token) {
            accumulatedContent += event.token;
            if (!renderTimer) {
              renderTimer = setTimeout(() => {
                renderTimer = null;
                flushContent();
              }, RENDER_INTERVAL);
            }
          }
          break;
        }

        case 'tool:start': {
          flushContent();
          setEntries((prev) =>
            prev.map((e) =>
              e.type === 'assistant' && e.id === assistantId ? { ...e, isStreaming: false } : e
            )
          );
          setEntries((prev) => [
            ...prev,
            {
              type: 'tool',
              id: uid(),
              tool: event.action.tool,
              args: event.action.arguments,
              isRunning: true,
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        case 'tool:end': {
          setEntries((prev) => {
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
          break;
        }

        case 'phase-change': {
          flushContent();
          setEntries((prev) => [
            ...prev.map((e) =>
              e.type === 'assistant' && e.id === assistantId ? { ...e, isStreaming: false } : e
            ),
            {
              type: 'phase',
              id: uid(),
              from: event.from.type,
              to: event.to.type,
              timestamp: Date.now(),
            },
          ]);

          // phase 变化后暂停
          await pauseFn();

          // 恢复后如果需要继续输出 token，创建新 assistant 条目
          // （仅当新 phase 是 calling-llm 或 streaming 时需要）
          if (event.to.type === 'calling-llm') {
            assistantId = uid();
            accumulatedContent = '';
            setEntries((prev) => [
              ...prev,
              {
                type: 'assistant',
                id: assistantId,
                content: '',
                timestamp: Date.now(),
                isStreaming: true,
              },
            ]);
          }
          break;
        }

        case 'error': {
          flushContent();
          const errMsg = event.error instanceof Error ? event.error.message : String(event.error);
          setEntries((prev) => [
            ...prev.map((e) =>
              e.type === 'assistant' && e.id === assistantId ? { ...e, isStreaming: false } : e
            ),
            { type: 'error', id: uid(), message: errMsg, timestamp: Date.now() },
          ]);
          break;
        }

        case 'skill:loading': {
          setEntries((prev) => [
            ...prev,
            {
              type: 'skill',
              id: uid(),
              name: event.name,
              status: 'loading',
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        case 'skill:loaded': {
          setEntries((prev) => [
            ...prev,
            {
              type: 'skill',
              id: uid(),
              name: event.name,
              status: 'loaded',
              tokenCount: event.tokenCount,
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        case 'subagent:start': {
          setEntries((prev) => [
            ...prev,
            {
              type: 'subagent',
              id: uid(),
              name: event.name,
              task: event.task,
              status: 'start',
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        case 'subagent:end': {
          setEntries((prev) => [
            ...prev,
            {
              type: 'subagent',
              id: uid(),
              name: event.name,
              result: event.result,
              status: 'end',
              timestamp: Date.now(),
            },
          ]);
          break;
        }
      }

      iterResult = await gen.next();
    }

    // 最终结果
    if (iterResult.done && iterResult.value) {
      const { state: newState } = iterResult.value;
      setState(newState);
      // flush 残留 token
      flushContent();
      setEntries((prev) =>
        prev.map((e) =>
          e.type === 'assistant' && e.id === assistantId ? { ...e, isStreaming: false } : e
        )
      );
    }
  } catch (error) {
    if (signal.aborted) return;
    flushContent();
    const msg = error instanceof Error ? error.message : String(error);
    setEntries((prev) =>
      prev.map((e) =>
        e.type === 'assistant' && e.id === assistantId
          ? { ...e, content: `Error: ${msg}`, isStreaming: false }
          : e
      )
    );
  }
}
