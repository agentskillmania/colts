/**
 * @fileoverview Agent 交互 hook — 管理对话、执行模式、消息流
 *
 * 提供与 AgentRunner 交互的核心逻辑，包括：
 * - 消息发送与接收（流式）
 * - 执行模式切换（run / step / advance）
 * - 命令解析（/run, /step, /advance, /clear, /help, /skill <name>）
 * - 事件转发到 useEvents
 */

import { useState, useCallback, useRef } from 'react';
import type { AgentRunner, AgentState, ISkillProvider, StreamEvent } from '@agentskillmania/colts';
import { createAgentState } from '@agentskillmania/colts';

/**
 * 执行模式
 *
 * - run: 完整执行（runStream），自动循环至完成
 * - step: 单步执行（stepStream），一个 ReAct 周期
 * - advance: 微步执行（advanceStream），一个阶段推进
 */
export type ExecutionMode = 'run' | 'step' | 'advance';

/**
 * 聊天消息
 */
export interface ChatMessage {
  /** 唯一标识 */
  id: string;
  /** 角色 */
  role: 'user' | 'assistant' | 'system';
  /** 消息内容 */
  content: string;
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** 工具调用列表（显示在消息内部） */
  toolCalls?: Array<{
    tool: string;
    args?: unknown;
    result?: unknown;
    isRunning?: boolean;
  }>;
}

/**
 * 命令解析结果
 */
export interface ParsedCommand {
  /** 命令类型 */
  type: 'mode-run' | 'mode-step' | 'mode-advance' | 'clear' | 'help' | 'skill' | 'message';
  /** 原始输入 */
  raw: string;
  /** Skill 名称（仅 type 为 skill 时有值） */
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
  if (trimmed === '/clear') return { type: 'clear', raw: trimmed };
  if (trimmed === '/help') return { type: 'help', raw: trimmed };
  if (trimmed.startsWith('/skill '))
    return { type: 'skill', raw: trimmed, skillName: trimmed.slice(7).trim() };

  return { type: 'message', raw: trimmed };
}

/**
 * 事件转发回调类型
 */
export type EventCallback = (event: StreamEvent) => void;

/**
 * useAgent hook 返回值
 */
export interface UseAgentReturn {
  /** 当前消息列表 */
  messages: ChatMessage[];
  /** 当前执行模式 */
  mode: ExecutionMode;
  /** 是否正在运行 */
  isRunning: boolean;
  /** 当前 AgentState */
  state: AgentState | null;
  /** 发送消息或命令 */
  sendMessage: (input: string) => Promise<void>;
  /** 设置执行模式 */
  setMode: (mode: ExecutionMode) => void;
  /** 清空消息 */
  clearMessages: () => void;
}

/**
 * Agent 交互 hook
 *
 * 管理与 AgentRunner 的对话。支持三种执行模式：
 * - run: 完整执行，自动循环至完成
 * - step: 单步执行，一个 ReAct 周期
 * - advance: 微步执行，一个阶段推进
 *
 * @param runner - AgentRunner 实例（可为 null）
 * @param initialState - 初始 AgentState（可为 null，会自动创建）
 * @param skillProvider - Skill 提供者（可选，用于 /skill 命令）
 * @param onEvent - 事件回调（可选，用于转发 StreamEvent 到 useEvents）
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
  initialState: AgentState | null,
  skillProvider?: ISkillProvider,
  onEvent?: EventCallback
): UseAgentReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<ExecutionMode>('run');
  const [isRunning, setIsRunning] = useState(false);
  const [state, setState] = useState<AgentState | null>(initialState);

  // 使用 ref 避免回调闭包问题
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  /** 清空消息 */
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  /**
   * 发送消息或执行命令
   *
   * 支持的命令：
   * - /run - 切换到完整执行模式
   * - /step - 切换到单步模式
   * - /advance - 切换到微步模式
   * - /clear - 清空消息
   * - /help - 显示帮助
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
              content: 'Switched to RUN mode',
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
              content: 'Switched to STEP mode',
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
              content: 'Switched to ADVANCE mode',
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
                'Commands: /run (full run) /step (single step) /advance (micro-step) /skill <name> (load skill) /clear (clear) /help (help)',
              timestamp: Date.now(),
            },
          ]);
          return;

        case 'skill': {
          // 加载 skill 指令并注入为系统消息
          const skillName = command.skillName;
          if (!skillName) {
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now().toString(),
                role: 'system',
                content: 'Usage: /skill <name>',
                timestamp: Date.now(),
              },
            ]);
            return;
          }

          if (!skillProvider) {
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now().toString(),
                role: 'system',
                content: 'Skill provider not configured',
                timestamp: Date.now(),
              },
            ]);
            return;
          }

          try {
            const manifest = skillProvider.getManifest(skillName);
            if (!manifest) {
              const available = skillProvider
                .listSkills()
                .map((s) => s.name)
                .join(', ');
              setMessages((prev) => [
                ...prev,
                {
                  id: Date.now().toString(),
                  role: 'system',
                  content: `Skill '${skillName}' not found. Available: ${available || 'none'}`,
                  timestamp: Date.now(),
                },
              ]);
              return;
            }

            const instructions = await skillProvider.loadInstructions(skillName);
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now().toString(),
                role: 'system',
                content: `Skill '${skillName}' loaded (${instructions.length} chars)`,
                timestamp: Date.now(),
              },
              {
                id: (Date.now() + 1).toString(),
                role: 'system',
                content: `[Skill: ${skillName}]\n${instructions}`,
                timestamp: Date.now(),
              },
            ]);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now().toString(),
                role: 'system',
                content: `Failed to load skill: ${errorMsg}`,
                timestamp: Date.now(),
              },
            ]);
          }
          return;
        }

        case 'message':
          break;
      }

      if (!runner) {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'system',
            content: 'Agent not ready, check configuration',
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      // 确保有有效 state（无 state 则自动创建）
      const currentState =
        state ??
        createAgentState({
          name: 'colts-agent',
          instructions: 'You are a helpful assistant.',
          tools: [],
        });

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
          await executeRunWithStreaming(runner, currentState, input.trim(), setMessages, setState);
        } else if (mode === 'step') {
          await executeStepWithStreaming(runner, currentState, setMessages, setState, onEventRef);
        } else {
          await executeAdvanceWithStreaming(
            runner,
            currentState,
            setMessages,
            setState,
            onEventRef
          );
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 2).toString(),
            role: 'system',
            content: `Error: ${errorMsg}`,
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setIsRunning(false);
      }
    },
    [runner, state, mode, clearMessages, skillProvider]
  );

  return { messages, mode, isRunning, state, sendMessage, setMode, clearMessages };
}

/**
 * 执行 run 模式（流式）
 *
 * 使用 chatStream 进行流式对话，实时更新 assistant 消息。
 *
 * @param runner - AgentRunner 实例
 * @param currentState - 当前 AgentState
 * @param userInput - 用户消息内容（传递给 chatStream）
 * @param setMessages - 消息状态更新器
 * @param setState - Agent 状态更新器
 */
async function executeRunWithStreaming(
  runner: AgentRunner,
  currentState: AgentState,
  userInput: string,
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
    // chatStream 第二个参数是用户消息，不是 assistant 的内容
    for await (const chunk of runner.chatStream(currentState, userInput)) {
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
              ? { ...m, content: `Error: ${chunk.error}`, isStreaming: false }
              : m
          )
        );
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantMsg.id ? { ...m, content: `Error: ${errorMsg}`, isStreaming: false } : m
      )
    );
  }
}

/**
 * 执行 step 模式（流式）
 *
 * 使用 stepStream 进行单步执行。
 *
 * @param runner - AgentRunner 实例
 * @param currentState - 当前 AgentState
 * @param setMessages - 消息状态更新器
 * @param setState - Agent 状态更新器
 * @param onEventRef - 事件回调 ref
 */
async function executeStepWithStreaming(
  runner: AgentRunner,
  currentState: AgentState,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setState: React.Dispatch<React.SetStateAction<AgentState | null>>,
  onEventRef: React.RefObject<EventCallback | undefined>
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

      // 转发事件到外部
      onEventRef.current?.(event);

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
            content: `Tool call: ${event.action.tool}`,
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
        m.id === assistantMsg.id ? { ...m, content: `Error: ${errorMsg}`, isStreaming: false } : m
      )
    );
  }
}

/**
 * 执行 advance 模式（流式）
 *
 * 使用 advanceStream 进行微步执行。
 *
 * @param runner - AgentRunner 实例
 * @param currentState - 当前 AgentState
 * @param setMessages - 消息状态更新器
 * @param setState - Agent 状态更新器
 * @param onEventRef - 事件回调 ref
 */
async function executeAdvanceWithStreaming(
  runner: AgentRunner,
  currentState: AgentState,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setState: React.Dispatch<React.SetStateAction<AgentState | null>>,
  onEventRef: React.RefObject<EventCallback | undefined>
): Promise<void> {
  // advance 需要 ExecutionState，创建临时实例
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

      // 转发事件到外部
      onEventRef.current?.(event);

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
            content: `Phase: ${event.from.type} -> ${event.to.type}`,
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
        m.id === assistantMsg.id ? { ...m, content: `Error: ${errorMsg}`, isStreaming: false } : m
      )
    );
  }
}
