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
import type { AgentRunner, AgentState, ISkillProvider, StreamEvent } from '@agentskillmania/colts';
import {
  createAgentState,
  addUserMessage,
  createExecutionState,
  isTerminalPhase,
  loadSkill,
} from '@agentskillmania/colts';
import type { TimelineEntry, DetailLevel } from '../types/timeline.js';
import { nextSeq } from '../types/timeline.js';
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

/** Entry count limit; trims oldest entries when exceeded to prevent render lag in long conversations */
export const MAX_ENTRIES = 200;

/**
 * Trim entries to limit
 *
 * Pure function for easy testing. Keeps last max entries when exceeding max.
 *
 * @param entries - Current entry array
 * @param max - Maximum number of entries
 * @returns Trimmed array (same reference or new array)
 */
export function trimToMaxEntries<T>(entries: T[], max: number): T[] {
  return entries.length > max ? entries.slice(-max) : entries;
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

  /** setEntries wrapper: auto-trim entries exceeding the limit */
  const trimEntries = useCallback((action: React.SetStateAction<TimelineEntry[]>) => {
    setEntries((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      return trimToMaxEntries(next, MAX_ENTRIES);
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
    trimEntries((prev) => [
      ...prev,
      { type: 'system', id: uid(), seq: nextSeq(), content, timestamp: Date.now() },
    ]);
  }, []);

  /** Add an error entry */
  const addErrorEntry = useCallback((message: string) => {
    trimEntries((prev) => [
      ...prev,
      { type: 'error', id: uid(), seq: nextSeq(), message, timestamp: Date.now() },
    ]);
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
              { type: 'user', id: uid(), seq: nextSeq(), content: userMsg, timestamp: Date.now() },
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
              const msg = error instanceof Error ? error.message : String(error);
              addErrorEntry(msg);
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
        { type: 'user', id: uid(), seq: nextSeq(), content: input.trim(), timestamp: Date.now() },
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
 * @param setEntries - Setter for timeline entries (auto-trim)
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

  // Create event consumer; run mode auto-creates new assistant entry after tool:end
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

    // Process final result
    if (iterResult.done && iterResult.value) {
      const { state: finalState, result: runResult } = iterResult.value;
      setState(finalState);

      if (runResult.type === 'success') {
        consumer.finalizeAssistant(consumer.getAccumulatedContent() || runResult.answer);
      } else if (runResult.type === 'abort') {
        // Aborted: silently clean up without adding error entry
        consumer.flush();
        const id = consumer.getAssistantId();
        setEntries((prev) =>
          prev.map((e) =>
            e.type === 'assistant' && e.id === id ? { ...e, isStreaming: false } : e
          )
        );
      } else {
        // max_steps or error
        consumer.flush();
        const id = consumer.getAssistantId();
        setEntries((prev) => [
          ...prev.map((e) =>
            e.type === 'assistant' && e.id === id ? { ...e, isStreaming: false } : e
          ),
          {
            type: 'run-complete',
            id: uid(),
            seq: nextSeq(),
            result: runResult,
            timestamp: Date.now(),
          },
        ]);
      }
    }
  } catch (error) {
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
export async function executeStep(
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
  // Step mode does not set onToolEnd: do not reset assistant within a step; handle holistically after step ends
  const consumer = new StreamEventConsumer(setEntries, setState);

  let continueLoop = true;

  while (continueLoop) {
    consumer.resetAssistant();

    try {
      const gen = runner.stepStream(runningState, undefined, { signal });
      let iterResult = await gen.next();

      while (!iterResult.done) {
        tracer.consume(iterResult.value);
        consumer.consume(iterResult.value);
        iterResult = await gen.next();
      }

      // Step complete
      if (iterResult.done && iterResult.value) {
        const { state: newState, result: stepResult } = iterResult.value;
        runningState = newState;
        setState(newState);

        if (stepResult.type === 'done') {
          consumer.finalizeAssistant(consumer.getAccumulatedContent() || stepResult.answer);
          continueLoop = false;
          break;
        }

        if (stepResult.type === 'abort') {
          // Aborted: silently exit
          continueLoop = false;
          break;
        }

        // Step complete but needs to continue — pause and wait for user to press Enter
        consumer.flush();
        const id = consumer.getAssistantId();
        setEntries((prev) => [
          ...prev.map((e) =>
            e.type === 'assistant' && e.id === id ? { ...e, isStreaming: false } : e
          ),
          {
            type: 'system',
            id: uid(),
            seq: nextSeq(),
            content: 'Step complete. Press Enter to continue.',
            timestamp: Date.now(),
          },
        ]);

        await pauseFn();
      }
    } catch (error) {
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
export async function executeAdvance(
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

  // Advance mode: consumer does not handle pause; pause is triggered after detecting phase-change events in loop
  const consumer = new StreamEventConsumer(setEntries, setState);

  consumer.resetAssistant();

  // advanceStream advances one phase at a time; loop until reaching terminal phase
  let currentExecState = execState;
  let currentPhase = currentExecState.phase;

  try {
    while (!isTerminalPhase(currentPhase)) {
      const gen = runner.advanceStream(effectiveState, currentExecState, undefined, { signal });
      let iterResult = await gen.next();

      while (!iterResult.done) {
        tracer.consume(iterResult.value);
        consumer.consume(iterResult.value);

        // Detect phase-change events and execute pause in inner loop
        // This makes await pauseFn() truly blocking, not fire-and-forget
        if (iterResult.value.type === 'phase-change') {
          const phaseEvent = iterResult.value as Extract<StreamEvent, { type: 'phase-change' }>;
          await pauseFn();
          if (phaseEvent.to.type === 'calling-llm') {
            consumer.resetAssistant();
          }
        }

        iterResult = await gen.next();
      }

      // One advanceStream iteration ends; check result and prepare for next advancement
      if (iterResult.done && iterResult.value) {
        const result = iterResult.value;
        effectiveState = result.state;
        currentExecState = result.execState;
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
        // Generator ended abnormally (no return value); exit loop
        break;
      }
    }
  } catch (error) {
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
