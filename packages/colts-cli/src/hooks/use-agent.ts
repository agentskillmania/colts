/**
 * @fileoverview Agent interaction hook — manages timeline, execution mode, and display level
 *
 * Core responsibilities:
 * - Message sending and receiving (streaming)
 * - Execution mode switching (run / step / advance)
 * - Display level switching (compact / detail / verbose)
 * - Command parsing
 * - StreamEvent → TimelineEntry conversion
 */

import { useState, useCallback, useRef } from 'react';
import type { AgentRunner, AgentState, ISkillProvider } from '@agentskillmania/colts';
import {
  createAgentState,
  addUserMessage,
  createExecutionState,
  isTerminalPhase,
  loadSkill,
} from '@agentskillmania/colts';
import type { TimelineEntry, DetailLevel } from '../types/timeline.js';
import { TraceWriter } from '../trace-writer.js';
import { StreamEventConsumer } from './stream-event-consumer.js';

/**
 * Execution mode
 *
 * - run: full execution (runStream), automatically loops until completion
 * - step: single-step execution (stepStream), one ReAct cycle
 * - advance: micro-step execution (advanceStream), one phase advancement
 */
export type ExecutionMode = 'run' | 'step' | 'advance';

/**
 * Parsed command
 */
export interface ParsedCommand {
  /** Command type */
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
  /** Raw input text */
  raw: string;
  /** Target skill name (for /skill command) */
  skillName?: string;
  /** Message to send to the skill (for /skill command) */
  skillMessage?: string;
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
  if (trimmed === '/show:compact' || trimmed === '/compact')
    return { type: 'show-compact', raw: trimmed };
  if (trimmed === '/show:detail' || trimmed === '/detail')
    return { type: 'show-detail', raw: trimmed };
  if (trimmed === '/show:verbose' || trimmed === '/verbose')
    return { type: 'show-verbose', raw: trimmed };
  if (trimmed === '/clear') return { type: 'clear', raw: trimmed };
  if (trimmed === '/help') return { type: 'help', raw: trimmed };
  if (trimmed === '/skill' || trimmed.startsWith('/skill ')) {
    if (trimmed === '/skill') {
      return { type: 'skill', raw: trimmed };
    }
    // "/skill name message" → skillName = name, skillMessage = message
    const rest = trimmed.slice(6).trim(); // "name message"
    const spaceIdx = rest.indexOf(' ');
    if (spaceIdx === -1) {
      return { type: 'skill', raw: trimmed, skillName: rest };
    }
    return {
      type: 'skill',
      raw: trimmed,
      skillName: rest.slice(0, spaceIdx),
      skillMessage: rest.slice(spaceIdx + 1).trim() || undefined,
    };
  }

  return { type: 'message', raw: trimmed };
}

/**
 * Return value of the useAgent hook
 */
export interface UseAgentReturn {
  /** List of timeline entries */
  entries: TimelineEntry[];
  /** Current execution mode */
  mode: ExecutionMode;
  /** Display level */
  detailLevel: DetailLevel;
  /** Whether the agent is currently running */
  isRunning: boolean;
  /** Whether the agent is paused, waiting for user input to continue */
  isPaused: boolean;
  /** Current AgentState */
  state: AgentState | null;
  /** Send a message or command */
  sendMessage: (input: string) => Promise<void>;
  /** Set the execution mode */
  setMode: (mode: ExecutionMode) => void;
  /** Set the display level */
  setDetailLevel: (level: DetailLevel) => void;
  /** Clear all entries */
  clearEntries: () => void;
  /** Abort the running agent (graceful termination) */
  abort: () => void;
}

/** Generate a unique ID */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Agent interaction hook
 *
 * Manages the conversation flow of AgentRunner. Supports three execution modes and three display levels.
 *
 * @param runner - AgentRunner instance (can be null)
 * @param initialState - Initial AgentState (can be null, auto-created)
 * @param skillProvider - Skill provider (optional, used for the /skill command)
 * @returns Agent interaction state and operation methods
 */
export function useAgent(
  runner: AgentRunner | null,
  initialState: AgentState | null,
  skillProvider?: ISkillProvider
): UseAgentReturn {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);

  /** 条目数量上限，超过时裁剪最老的条目，防止长对话导致渲染卡顿 */
  const MAX_ENTRIES = 200;

  /** setEntries 包装：自动裁剪超出上限的条目 */
  const trimEntries = useCallback((action: React.SetStateAction<TimelineEntry[]>) => {
    setEntries((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
    });
  }, []);
  const [mode, setMode] = useState<ExecutionMode>('run');
  const [detailLevel, setDetailLevelState] = useState<DetailLevel>('compact');
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [state, setState] = useState<AgentState | null>(initialState);

  // Pause/resume mechanism (step/advance mode)
  const continueFnRef = useRef<(() => void) | null>(null);
  // AbortController for graceful interruption
  const abortControllerRef = useRef<AbortController | null>(null);

  /** Resume from pause to let step/advance continue */
  const resumeExecution = useCallback(() => {
    if (continueFnRef.current) {
      continueFnRef.current();
      continueFnRef.current = null;
    }
  }, []);

  /** Clear all entries */
  const clearEntries = useCallback(() => {
    setEntries([]);
  }, []);

  /** Add a system entry */
  const addSystemEntry = useCallback((content: string) => {
    trimEntries((prev) => [...prev, { type: 'system', id: uid(), content, timestamp: Date.now() }]);
  }, []);

  /** Add an error entry */
  const addErrorEntry = useCallback((message: string) => {
    trimEntries((prev) => [...prev, { type: 'error', id: uid(), message, timestamp: Date.now() }]);
  }, []);

  /**
   * Send a message or execute a command
   *
   * @param input - User input
   */
  const sendMessage = useCallback(
    async (input: string) => {
      const command = parseCommand(input);

      // When paused, empty input = continue
      if (isPaused && command.type === 'message' && !input.trim()) {
        setIsPaused(false);
        resumeExecution();
        return;
      }

      // Process commands
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
          if (!skillProvider) {
            addSystemEntry('Skill provider not configured');
            return;
          }
          if (!skillName) {
            const available = skillProvider
              .listSkills()
              .map((s) => `${s.name} - ${s.description}`)
              .join('\n');
            addSystemEntry(`Available skills:\n${available || 'none'}`);
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
            if (!runner) {
              addSystemEntry('Agent not ready, check configuration');
              return;
            }
            // Inject skill into state
            const currentState =
              state ??
              createAgentState({
                name: 'colts-agent',
                instructions: 'You are a helpful assistant.',
                tools: [],
              });
            const skillInjectedState = loadSkill(currentState, skillName, instructions);
            setState(skillInjectedState);
            addSystemEntry(`Skill '${skillName}' activated`);

            // User message: use skillMessage if available, otherwise generate a default message
            const userMsg = command.skillMessage || `Execute skill: ${skillName}`;

            // Add user message entry
            trimEntries((prev) => [
              ...prev,
              { type: 'user', id: uid(), content: userMsg, timestamp: Date.now() },
            ]);
            setIsRunning(true);

            const abortController = new AbortController();
            abortControllerRef.current = abortController;
            const signal = abortController.signal;

            try {
              if (mode === 'run') {
                await executeRun(
                  runner,
                  skillInjectedState,
                  userMsg,
                  trimEntries,
                  setState,
                  signal
                );
              } else if (mode === 'step') {
                await executeStep(
                  runner,
                  skillInjectedState,
                  userMsg,
                  trimEntries,
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
                  skillInjectedState,
                  userMsg,
                  trimEntries,
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
              if (!signal.aborted) {
                const msg = error instanceof Error ? error.message : String(error);
                addErrorEntry(msg);
              }
            } finally {
              setIsRunning(false);
              setIsPaused(false);
              abortControllerRef.current = null;
            }
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

      // Ensure a valid state exists (auto-create if none)
      const currentState =
        state ??
        createAgentState({
          name: 'colts-agent',
          instructions: 'You are a helpful assistant.',
          tools: [],
        });

      // Add user message entry
      trimEntries((prev) => [
        ...prev,
        { type: 'user', id: uid(), content: input.trim(), timestamp: Date.now() },
      ]);
      setIsRunning(true);

      // Create AbortController
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      const signal = abortController.signal;

      try {
        if (mode === 'run') {
          await executeRun(runner, currentState, input.trim(), trimEntries, setState, signal);
        } else if (mode === 'step') {
          await executeStep(
            runner,
            currentState,
            input.trim(),
            trimEntries,
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
            trimEntries,
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

  /** Abort the running agent */
  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // If paused, also resume
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
// Streaming execution functions below, uniformly producing TimelineEntry
// ──────────────────────────────────────────────────────────────

type SetEntries = React.Dispatch<React.SetStateAction<TimelineEntry[]>>;
type SetState = React.Dispatch<React.SetStateAction<AgentState | null>>;

/**
 * Run mode streaming execution
 *
 * Uses runStream for a full ReAct loop (including tool calls).
 * Stream starts after manually adding the user message.
 *
 * @param runner - AgentRunner instance
 * @param currentState - Current AgentState
 * @param userInput - User message text
 * @param setEntries - Setter for timeline entries（自动裁剪）
 * @param setState - Setter for AgentState
 * @param signal - AbortSignal for cancellation
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
  const tracer = new TraceWriter(stateWithMsg.id);

  // 创建事件消费者，run 模式在 tool:end 后自动创建新 assistant entry
  const consumer = new StreamEventConsumer(setEntries, setState, {
    onToolEnd: () => consumer.resetAssistant(),
  });
  consumer.resetAssistant();

  try {
    const gen = runner.runStream(stateWithMsg, { signal });
    let iterResult = await gen.next();

    while (!iterResult.done) {
      tracer.consume(iterResult.value);
      consumer.consume(iterResult.value);
      iterResult = await gen.next();
    }

    // 处理最终结果
    if (iterResult.done && iterResult.value) {
      const { state: finalState, result: runResult } = iterResult.value;
      setState(finalState);

      if (runResult.type === 'success') {
        consumer.finalizeAssistant(consumer.getAccumulatedContent() || runResult.answer);
      } else {
        // max_steps 或 error
        consumer.flush();
        const id = consumer.getAssistantId();
        setEntries((prev) => [
          ...prev.map((e) =>
            e.type === 'assistant' && e.id === id ? { ...e, isStreaming: false } : e
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
        e.type === 'assistant' && e.id === consumer.getAssistantId()
          ? { ...e, content: `Error: ${msg}`, isStreaming: false }
          : e
      )
    );
  } finally {
    await tracer.flush();
  }
}

/**
 * Step mode streaming execution
 *
 * Uses stepStream to execute one ReAct cycle. Pauses after completion, waiting for the user to press Enter to continue.
 *
 * @param runner - AgentRunner instance
 * @param currentState - Current AgentState
 * @param userInput - User message text
 * @param setEntries - Setter for timeline entries
 * @param setState - Setter for AgentState
 * @param signal - AbortSignal for cancellation
 * @param pauseFn - Async function that pauses execution until resumed
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

  if (userInput) {
    runningState = addUserMessage(runningState, userInput);
  }

  const tracer = new TraceWriter(runningState.id);
  // step 模式不设 onToolEnd：一个 step 内不重置 assistant，step 结束后整体处理
  const consumer = new StreamEventConsumer(setEntries, setState);

  let continueLoop = true;

  while (continueLoop) {
    if (signal.aborted) return;

    consumer.resetAssistant();

    try {
      const gen = runner.stepStream(runningState, undefined, { signal });
      let iterResult = await gen.next();

      while (!iterResult.done) {
        tracer.consume(iterResult.value);
        consumer.consume(iterResult.value);
        iterResult = await gen.next();
      }

      // Step 完成
      if (iterResult.done && iterResult.value) {
        const { state: newState, result: stepResult } = iterResult.value;
        runningState = newState;
        setState(newState);

        if (stepResult.type === 'done') {
          consumer.finalizeAssistant(consumer.getAccumulatedContent() || stepResult.answer);
          continueLoop = false;
          return;
        }

        // Step 完成但还需要继续 — 暂停等用户按 Enter
        consumer.flush();
        const id = consumer.getAssistantId();
        setEntries((prev) => [
          ...prev.map((e) =>
            e.type === 'assistant' && e.id === id ? { ...e, isStreaming: false } : e
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
      const msg = error instanceof Error ? error.message : String(error);
      setEntries((prev) =>
        prev.map((e) =>
          e.type === 'assistant' && e.id === consumer.getAssistantId()
            ? { ...e, content: `Error: ${msg}`, isStreaming: false }
            : e
        )
      );
      continueLoop = false;
    }
  }

  await tracer.flush();
}

/**
 * Advance mode streaming execution
 *
 * Uses advanceStream to execute one phase advancement. Pauses after each phase change, waiting to continue.
 *
 * @param runner - AgentRunner instance
 * @param currentState - Current AgentState
 * @param userInput - User message text
 * @param setEntries - Setter for timeline entries
 * @param setState - Setter for AgentState
 * @param signal - AbortSignal for cancellation
 * @param pauseFn - Async function that pauses execution until resumed
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

  const tracer = new TraceWriter(effectiveState.id);

  // advance 模式：phase-change 时暂停，进入 calling-llm 时重置 assistant
  const consumer = new StreamEventConsumer(setEntries, setState, {
    onPhaseChange: async (event) => {
      await pauseFn();
      if (event.to.type === 'calling-llm') {
        consumer.resetAssistant();
      }
    },
  });

  consumer.resetAssistant();

  // advanceStream 每次只推进一步 phase，需要循环调用直到到达 terminal phase
  const currentExecState = execState;
  let currentPhase = currentExecState.phase;

  try {
    while (!isTerminalPhase(currentPhase)) {
      signal.throwIfAborted();

      const gen = runner.advanceStream(effectiveState, currentExecState, undefined, { signal });
      let iterResult = await gen.next();

      while (!iterResult.done) {
        tracer.consume(iterResult.value);
        consumer.consume(iterResult.value);
        iterResult = await gen.next();
      }

      // 一次 advanceStream 结束，检查结果并准备下一次推进
      if (iterResult.done && iterResult.value) {
        const result = iterResult.value;
        effectiveState = result.state;
        currentPhase = result.phase;
        setState(effectiveState);
        consumer.flush();
        const id = consumer.getAssistantId();
        setEntries((prev) =>
          prev.map((e) =>
            e.type === 'assistant' && e.id === id ? { ...e, isStreaming: false } : e
          )
        );

        if (result.done) break;
      } else {
        // generator 异常结束（没有 return value），退出循环
        break;
      }
    }
  } catch (error) {
    if (signal.aborted) return;
    const msg = error instanceof Error ? error.message : String(error);
    setEntries((prev) =>
      prev.map((e) =>
        e.type === 'assistant' && e.id === consumer.getAssistantId()
          ? { ...e, content: `Error: ${msg}`, isStreaming: false }
          : e
      )
    );
  } finally {
    await tracer.flush();
  }
}
