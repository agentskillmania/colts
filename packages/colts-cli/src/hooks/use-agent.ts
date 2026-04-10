/**
 * @fileoverview Agent 交互 Hook — 管理 Agent 对话、执行模式和消息流
 *
 * 提供与 AgentRunner 交互的核心逻辑，包括：
 * - 消息发送和接收（支持流式传输）
 * - 执行模式切换（run / step / advance）
 * - 命令解析（/run, /step, /advance, /clear, /help）
 */

import { useState, useCallback } from 'react';
import type { AgentRunner, AgentState } from '@agentskillmania/colts';

/**
 * 执行模式
 *
 * - run: 完整运行（runStream），自动循环直到完成
 * - step: 单步执行（stepStream），一次 ReAct 周期
 * - advance: 微步执行（advanceStream），一次相位推进
 */
export type ExecutionMode = 'run' | 'step' | 'advance';

/**
 * 聊天消息
 */
export interface ChatMessage {
  /** 消息唯一标识 */
  id: string;
  /** 角色 */
  role: 'user' | 'assistant' | 'system';
  /** 消息内容 */
  content: string;
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
}

/**
 * 命令解析结果
 */
export interface ParsedCommand {
  /** 命令类型 */
  type: 'mode-run' | 'mode-step' | 'mode-advance' | 'clear' | 'help' | 'message';
  /** 原始输入 */
  raw: string;
}

/**
 * 解析用户输入命令
 *
 * @param input - 用户输入的原始文本
 * @returns 解析后的命令对象
 */
export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();

  if (trimmed === '/run') return { type: 'mode-run', raw: trimmed };
  if (trimmed === '/step') return { type: 'mode-step', raw: trimmed };
  if (trimmed === '/advance') return { type: 'mode-advance', raw: trimmed };
  if (trimmed === '/clear') return { type: 'clear', raw: trimmed };
  if (trimmed === '/help') return { type: 'help', raw: trimmed };

  return { type: 'message', raw: trimmed };
}

/**
 * useAgent Hook 的返回值
 */
export interface UseAgentReturn {
  /** 当前消息列表 */
  messages: ChatMessage[];
  /** 当前执行模式 */
  mode: ExecutionMode;
  /** 是否正在运行 */
  isRunning: boolean;
  /** 当前 Agent 状态 */
  state: AgentState | null;
  /** 发送消息或命令 */
  sendMessage: (input: string) => Promise<void>;
  /** 设置执行模式 */
  setMode: (mode: ExecutionMode) => void;
  /** 清空消息 */
  clearMessages: () => void;
}

/**
 * Agent 交互 Hook
 *
 * 管理与 AgentRunner 的对话交互。支持三种执行模式：
 * - run: 完整运行，自动循环直到完成
 * - step: 单步执行，一次 ReAct 周期
 * - advance: 微步执行，一次相位推进
 *
 * @param runner - AgentRunner 实例（可为 null）
 * @param initialState - 初始 AgentState（可为 null）
 * @returns Agent 交互状态和操作方法
 *
 * @example
 * ```tsx
 * const { messages, mode, isRunning, sendMessage } = useAgent(runner, state);
 *
 * // 发送消息
 * await sendMessage('Hello!');
 *
 * // 切换模式
 * await sendMessage('/step');
 * ```
 */
export function useAgent(
  runner: AgentRunner | null,
  initialState: AgentState | null
): UseAgentReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<ExecutionMode>('run');
  const [isRunning, setIsRunning] = useState(false);
  const [state, setState] = useState<AgentState | null>(initialState);

  /** 清空消息 */
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  /**
   * 发送消息或执行命令
   *
   * 支持以下命令：
   * - /run - 切换到完整运行模式
   * - /step - 切换到单步模式
   * - /advance - 切换到微步模式
   * - /clear - 清空消息
   * - /help - 显示帮助信息
   *
   * @param input - 用户输入
   */
  const sendMessage = useCallback(
    async (input: string) => {
      const command = parseCommand(input);

      // 处理命令
      switch (command.type) {
        case 'mode-run':
          setMode('run');
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              role: 'system',
              content: '切换到 RUN 模式',
              timestamp: Date.now(),
            },
          ]);
          return;

        case 'mode-step':
          setMode('step');
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              role: 'system',
              content: '切换到 STEP 模式',
              timestamp: Date.now(),
            },
          ]);
          return;

        case 'mode-advance':
          setMode('advance');
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              role: 'system',
              content: '切换到 ADVANCE 模式',
              timestamp: Date.now(),
            },
          ]);
          return;

        case 'clear':
          clearMessages();
          return;

        case 'help':
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              role: 'system',
              content:
                '可用命令：/run（完整运行） /step（单步） /advance（微步） /clear（清空） /help（帮助）',
              timestamp: Date.now(),
            },
          ]);
          return;

        case 'message':
          break;
      }

      if (!runner || !state) {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'system',
            content: 'Agent 未就绪，请检查配置',
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      // 添加用户消息
      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: input.trim(),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsRunning(true);

      try {
        if (mode === 'run') {
          await executeRunWithStreaming(runner, state, setMessages, setState);
        } else if (mode === 'step') {
          await executeStepWithStreaming(runner, state, setMessages, setState);
        } else {
          await executeAdvanceWithStreaming(runner, state, setMessages, setState);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 2).toString(),
            role: 'system',
            content: `错误: ${errorMsg}`,
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setIsRunning(false);
      }
    },
    [runner, state, mode, clearMessages]
  );

  return { messages, mode, isRunning, state, sendMessage, setMode, clearMessages };
}

/**
 * 以 run 模式执行 Agent（流式）
 *
 * 使用 chatStream 进行流式对话，实时更新助手消息。
 *
 * @param runner - AgentRunner 实例
 * @param currentState - 当前 Agent 状态
 * @param setMessages - 消息状态更新函数
 * @param setState - Agent 状态更新函数
 */
async function executeRunWithStreaming(
  runner: AgentRunner,
  currentState: AgentState,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setState: React.Dispatch<React.SetStateAction<AgentState | null>>
): Promise<void> {
  const assistantMsg: ChatMessage = {
    id: (Date.now() + 1).toString(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isStreaming: true,
  };
  setMessages((prev) => [...prev, assistantMsg]);

  try {
    for await (const chunk of runner.chatStream(currentState, assistantMsg.content || ' ')) {
      if (chunk.type === 'text' && chunk.delta) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  content: chunk.accumulatedContent ?? m.content + chunk.delta!,
                }
              : m
          )
        );
      }
      if (chunk.type === 'done') {
        setState(chunk.state);
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, isStreaming: false } : m))
        );
      }
      if (chunk.type === 'error') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: `错误: ${chunk.error}`, isStreaming: false }
              : m
          )
        );
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantMsg.id ? { ...m, content: `错误: ${errorMsg}`, isStreaming: false } : m
      )
    );
  }
}

/**
 * 以 step 模式执行 Agent（流式）
 *
 * 使用 stepStream 进行单步执行。
 *
 * @param runner - AgentRunner 实例
 * @param currentState - 当前 Agent 状态
 * @param setMessages - 消息状态更新函数
 * @param setState - Agent 状态更新函数
 */
async function executeStepWithStreaming(
  runner: AgentRunner,
  currentState: AgentState,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setState: React.Dispatch<React.SetStateAction<AgentState | null>>
): Promise<void> {
  const assistantMsg: ChatMessage = {
    id: (Date.now() + 1).toString(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isStreaming: true,
  };
  setMessages((prev) => [...prev, assistantMsg]);

  try {
    let accumulatedContent = '';
    const gen = runner.stepStream(currentState);
    let result = await gen.next();

    while (!result.done) {
      const event = result.value;

      if (event.type === 'token' && event.token) {
        accumulatedContent += event.token;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: accumulatedContent } : m))
        );
      }

      if (event.type === 'tool:start') {
        setMessages((prev) => [
          ...prev.map((m) => (m.id === assistantMsg.id ? { ...m, isStreaming: false } : m)),
          {
            id: (Date.now() + Math.random()).toString(),
            role: 'system',
            content: `调用工具: ${event.action.tool}`,
            timestamp: Date.now(),
          },
        ]);
      }

      result = await gen.next();
    }

    // 最终结果
    if (result.done && result.value) {
      const { state: newState } = result.value;
      setState(newState);

      const stepResult = result.value.result;
      if (stepResult.type === 'done') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: stepResult.answer, isStreaming: false } : m
          )
        );
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantMsg.id ? { ...m, content: `错误: ${errorMsg}`, isStreaming: false } : m
      )
    );
  }
}

/**
 * 以 advance 模式执行 Agent（流式）
 *
 * 使用 advanceStream 进行微步执行。
 *
 * @param runner - AgentRunner 实例
 * @param currentState - 当前 Agent 状态
 * @param setMessages - 消息状态更新函数
 * @param setState - Agent 状态更新函数
 */
async function executeAdvanceWithStreaming(
  runner: AgentRunner,
  currentState: AgentState,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setState: React.Dispatch<React.SetStateAction<AgentState | null>>
): Promise<void> {
  // advance 需要外部管理 ExecutionState，此处创建临时状态
  const { createExecutionState } = await import('@agentskillmania/colts');
  const execState = createExecutionState();

  const assistantMsg: ChatMessage = {
    id: (Date.now() + 1).toString(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isStreaming: true,
  };
  setMessages((prev) => [...prev, assistantMsg]);

  try {
    let accumulatedContent = '';
    const gen = runner.advanceStream(currentState, execState);
    let result = await gen.next();

    while (!result.done) {
      const event = result.value;

      if (event.type === 'token' && event.token) {
        accumulatedContent += event.token;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: accumulatedContent } : m))
        );
      }

      if (event.type === 'phase-change') {
        setMessages((prev) => [
          ...prev.map((m) => (m.id === assistantMsg.id ? { ...m, isStreaming: false } : m)),
          {
            id: (Date.now() + Math.random()).toString(),
            role: 'system',
            content: `相位: ${event.from.type} -> ${event.to.type}`,
            timestamp: Date.now(),
          },
        ]);
      }

      result = await gen.next();
    }

    // 最终结果
    if (result.done && result.value) {
      const { state: newState } = result.value;
      setState(newState);

      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsg.id ? { ...m, isStreaming: false } : m))
      );
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantMsg.id ? { ...m, content: `错误: ${errorMsg}`, isStreaming: false } : m
      )
    );
  }
}
