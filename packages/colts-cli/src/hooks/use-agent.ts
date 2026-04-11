/**
 * @fileoverview Agent interaction hook — manages agent conversation, execution modes, and message flow
 *
 * Provides core logic for interacting with AgentRunner, including:
 * - Message sending and receiving (with streaming support)
 * - Execution mode switching (run / step / advance)
 * - Command parsing (/run, /step, /advance, /clear, /help, /skill <name>)
 */

import { useState, useCallback } from 'react';
import type { AgentRunner, AgentState, ISkillProvider } from '@agentskillmania/colts';

/**
 * Execution mode
 *
 * - run: Full run (runStream), auto-loops until completion
 * - step: Single step (stepStream), one ReAct cycle
 * - advance: Micro-step (advanceStream), one phase advancement
 */
export type ExecutionMode = 'run' | 'step' | 'advance';

/**
 * Chat message
 */
export interface ChatMessage {
  /** Unique message identifier */
  id: string;
  /** Role */
  role: 'user' | 'assistant' | 'system';
  /** Message content */
  content: string;
  /** Timestamp in milliseconds */
  timestamp: number;
  /** Whether currently streaming output */
  isStreaming?: boolean;
}

/**
 * Command parse result
 */
export interface ParsedCommand {
  /** Command type */
  type: 'mode-run' | 'mode-step' | 'mode-advance' | 'clear' | 'help' | 'skill' | 'message';
  /** Raw input */
  raw: string;
  /** Skill name (only set when type is 'skill') */
  skillName?: string;
}

/**
 * Parse user input as a command
 *
 * @param input - Raw user input text
 * @returns Parsed command object
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
 * Return value of useAgent hook
 */
export interface UseAgentReturn {
  /** Current message list */
  messages: ChatMessage[];
  /** Current execution mode */
  mode: ExecutionMode;
  /** Whether currently running */
  isRunning: boolean;
  /** Current agent state */
  state: AgentState | null;
  /** Send a message or command */
  sendMessage: (input: string) => Promise<void>;
  /** Set execution mode */
  setMode: (mode: ExecutionMode) => void;
  /** Clear messages */
  clearMessages: () => void;
}

/**
 * Agent interaction hook
 *
 * Manages conversation with AgentRunner. Supports three execution modes:
 * - run: Full run, auto-loops until completion
 * - step: Single step, one ReAct cycle
 * - advance: Micro-step, one phase advancement
 *
 * @param runner - AgentRunner instance (can be null)
 * @param initialState - Initial AgentState (can be null)
 * @param skillProvider - Skill provider (optional, for /skill command)
 * @returns Agent interaction state and action methods
 *
 * @example
 * ```tsx
 * const { messages, mode, isRunning, sendMessage } = useAgent(runner, state);
 *
 * // Send a message
 * await sendMessage('Hello!');
 *
 * // Switch mode
 * await sendMessage('/step');
 * ```
 */
export function useAgent(
  runner: AgentRunner | null,
  initialState: AgentState | null,
  skillProvider?: ISkillProvider
): UseAgentReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<ExecutionMode>('run');
  const [isRunning, setIsRunning] = useState(false);
  const [state, setState] = useState<AgentState | null>(initialState);

  /** Clear messages */
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  /**
   * Send a message or execute a command
   *
   * Supported commands:
   * - /run - Switch to full run mode
   * - /step - Switch to step mode
   * - /advance - Switch to advance mode
   * - /clear - Clear messages
   * - /help - Show help
   *
   * @param input - User input
   */
  const sendMessage = useCallback(
    async (input: string) => {
      const command = parseCommand(input);

      // Handle command
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
          // Load skill instructions and inject as system message
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

      if (!runner || !state) {
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

      // Add user message
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
 * Execute agent in run mode (streaming)
 *
 * Uses chatStream for streaming conversation, updating assistant messages in real time.
 *
 * @param runner - AgentRunner instance
 * @param currentState - Current agent state
 * @param setMessages - Message state setter
 * @param setState - Agent state setter
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
 * Execute agent in step mode (streaming)
 *
 * Uses stepStream for single-step execution.
 *
 * @param runner - AgentRunner instance
 * @param currentState - Current agent state
 * @param setMessages - Message state setter
 * @param setState - Agent state setter
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
            content: `Tool call: ${event.action.tool}`,
            timestamp: Date.now(),
          },
        ]);
      }

      result = await gen.next();
    }

    // Final result
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
 * Execute agent in advance mode (streaming)
 *
 * Uses advanceStream for micro-step execution.
 *
 * @param runner - AgentRunner instance
 * @param currentState - Current agent state
 * @param setMessages - Message state setter
 * @param setState - Agent state setter
 */
async function executeAdvanceWithStreaming(
  runner: AgentRunner,
  currentState: AgentState,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setState: React.Dispatch<React.SetStateAction<AgentState | null>>
): Promise<void> {
  // advance requires external ExecutionState management, create a temporary one here
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
            content: `Phase: ${event.from.type} -> ${event.to.type}`,
            timestamp: Date.now(),
          },
        ]);
      }

      result = await gen.next();
    }

    // Final result
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
