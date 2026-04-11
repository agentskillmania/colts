/**
 * @fileoverview Agent interaction hook — manages conversation, execution modes, and message streams
 *
 * Provides core logic for interacting with AgentRunner, including:
 * - Message sending and receiving (streaming)
 * - Execution mode switching (run / step / advance)
 * - Command parsing (/run, /step, /advance, /clear, /help, /skill <name>)
 * - Event forwarding to useEvents
 */

import { useState, useCallback, useRef } from 'react';
import type { AgentRunner, AgentState, ISkillProvider, StreamEvent } from '@agentskillmania/colts';
import { createAgentState } from '@agentskillmania/colts';

/**
 * Execution mode
 *
 * - run: Full execution (runStream), automatically loops to completion
 * - step: Single step execution (stepStream), one ReAct cycle
 * - advance: Micro-step execution (advanceStream), one phase advance
 */
export type ExecutionMode = 'run' | 'step' | 'advance';

/**
 * Chat message
 */
export interface ChatMessage {
  /** Unique identifier */
  id: string;
  /** Message role */
  role: 'user' | 'assistant' | 'system';
  /** Message content */
  content: string;
  /** Timestamp in milliseconds */
  timestamp: number;
  /** Whether the message is currently streaming */
  isStreaming?: boolean;
  /** Tool call list (displayed inside the message) */
  toolCalls?: Array<{
    tool: string;
    args?: unknown;
    result?: unknown;
    isRunning?: boolean;
  }>;
}

/**
 * Parsed command result
 */
export interface ParsedCommand {
  /** Command type */
  type: 'mode-run' | 'mode-step' | 'mode-advance' | 'clear' | 'help' | 'skill' | 'message';
  /** Raw input string */
  raw: string;
  /** Skill name (only present when type is 'skill') */
  skillName?: string;
}

/**
 * Parse user input into a command
 *
 * @param input - Raw input text
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
 * Event forwarding callback type
 */
export type EventCallback = (event: StreamEvent) => void;

/**
 * useAgent hook return value
 */
export interface UseAgentReturn {
  /** Current message list */
  messages: ChatMessage[];
  /** Current execution mode */
  mode: ExecutionMode;
  /** Whether the agent is currently running */
  isRunning: boolean;
  /** Current AgentState */
  state: AgentState | null;
  /** Send a message or command */
  sendMessage: (input: string) => Promise<void>;
  /** Set the execution mode */
  setMode: (mode: ExecutionMode) => void;
  /** Clear all messages */
  clearMessages: () => void;
}

/**
 * Agent interaction hook
 *
 * Manages conversation with AgentRunner. Supports three execution modes:
 * - run: Full execution, automatically loops to completion
 * - step: Single step execution, one ReAct cycle
 * - advance: Micro-step execution, one phase advance
 *
 * @param runner - AgentRunner instance (can be null)
 * @param initialState - Initial AgentState (can be null, will be auto-created)
 * @param skillProvider - Skill provider (optional, for /skill command)
 * @param onEvent - Event callback (optional, for forwarding StreamEvent to useEvents)
 * @returns Agent interaction state and action methods
 *
 * @example
 * ```tsx
 * const { messages, mode, isRunning, sendMessage } = useAgent(runner, state);
 *
 * // Send message
 * await sendMessage('Hello!');
 *
 * // Switch mode
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

  // Use ref to avoid callback closure issues
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  /** Clear all messages */
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  /**
   * Send a message or execute a command
   *
   * Supported commands:
   * - /run - Switch to full execution mode
   * - /step - Switch to single step mode
   * - /advance - Switch to micro-step mode
   * - /clear - Clear messages
   * - /help - Show help
   *
   * @param input - User input
   */
  const sendMessage = useCallback(
    async (input: string) => {
      const command = parseCommand(input);

      // Handle commands
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

      // Ensure a valid state exists (auto-create if none)
      const currentState =
        state ??
        createAgentState({
          name: 'colts-agent',
          instructions: 'You are a helpful assistant.',
          tools: [],
        });

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
 * Execute in run mode (streaming)
 *
 * Uses chatStream for streaming conversation, updating the assistant message in real time.
 *
 * @param runner - AgentRunner instance
 * @param currentState - Current AgentState
 * @param userInput - User message content (passed to chatStream)
 * @param setMessages - Message state updater
 * @param setState - Agent state updater
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
    // The second parameter of chatStream is the user message, not the assistant content
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
 * Execute in step mode (streaming)
 *
 * Uses stepStream for single step execution.
 *
 * @param runner - AgentRunner instance
 * @param currentState - Current AgentState
 * @param setMessages - Message state updater
 * @param setState - Agent state updater
 * @param onEventRef - Event callback ref
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

      // Forward event to external handler
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
 * Execute in advance mode (streaming)
 *
 * Uses advanceStream for micro-step execution.
 *
 * @param runner - AgentRunner instance
 * @param currentState - Current AgentState
 * @param setMessages - Message state updater
 * @param setState - Agent state updater
 * @param onEventRef - Event callback ref
 */
async function executeAdvanceWithStreaming(
  runner: AgentRunner,
  currentState: AgentState,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setState: React.Dispatch<React.SetStateAction<AgentState | null>>,
  onEventRef: React.RefObject<EventCallback | undefined>
): Promise<void> {
  // advance requires ExecutionState, create a temporary instance
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

      // Forward event to external handler
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
