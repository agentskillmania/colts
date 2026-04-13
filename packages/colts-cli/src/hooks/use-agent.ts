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
  loadSkill,
} from '@agentskillmania/colts';
import type { TimelineEntry, DetailLevel } from '../types/timeline.js';

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
    setEntries((prev) => [...prev, { type: 'system', id: uid(), content, timestamp: Date.now() }]);
  }, []);

  /** Add an error entry */
  const addErrorEntry = useCallback((message: string) => {
    setEntries((prev) => [...prev, { type: 'error', id: uid(), message, timestamp: Date.now() }]);
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
            setEntries((prev) => [
              ...prev,
              { type: 'user', id: uid(), content: userMsg, timestamp: Date.now() },
            ]);
            setIsRunning(true);

            const abortController = new AbortController();
            abortControllerRef.current = abortController;
            const signal = abortController.signal;

            try {
              if (mode === 'run') {
                await executeRun(runner, skillInjectedState, userMsg, setEntries, setState, signal);
              } else if (mode === 'step') {
                await executeStep(
                  runner,
                  skillInjectedState,
                  userMsg,
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
                  skillInjectedState,
                  userMsg,
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
      setEntries((prev) => [
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
 * Throttled render interval (ms)
 *
 * LLM tokens arrive in bursts of 3-5 at a rate of ~50ms intervals,
 * but within each burst setEntries is triggered 3-5 times in 1-5ms.
 * React 18 automatic batching merges them into a single render.
 * Using setTimeout to throttle to ~50ms ensures Ink renders every frame.
 */
const RENDER_INTERVAL = 50;

/**
 * Run mode streaming execution
 *
 * Uses runStream for a full ReAct loop (including tool calls).
 * Stream starts after manually adding the user message.
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

  // Create initial assistant entry
  let assistantId = uid();
  let accumulatedContent = '';
  // Throttle rendering: avoid triggering setEntries for every token
  let renderTimer: ReturnType<typeof setTimeout> | null = null;

  /** Flush assistant content to the UI */
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
        // Token streaming output (throttled)
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

        // Tool call started
        case 'tool:start': {
          // Flush remaining tokens first, then switch to tool entry
          flushContent();
          // Stop current assistant streaming
          setEntries((prev) =>
            prev.map((e) =>
              e.type === 'assistant' && e.id === assistantId ? { ...e, isStreaming: false } : e
            )
          );
          // Add tool entry
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

        // Tool call ended
        case 'tool:end': {
          // Update the most recent running tool entry, add a new assistant entry for the next round
          setEntries((prev) => {
            // Find the most recent isRunning tool from the end backwards
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
          // New assistant entry (for the next round of LLM output)
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

        // Step boundary
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

        // Context compression
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

        // Phase change
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

        // Skill loading
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

        // Error
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

        // complete event — stream ended
        case 'complete': {
          // handled after the loop
          break;
        }
      }

      iterResult = await gen.next();
    }

    // Final result
    if (iterResult.done && iterResult.value) {
      const { state: finalState, result: runResult } = iterResult.value;
      setState(finalState);
      // Flush residual tokens
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
 * Step mode streaming execution
 *
 * Uses stepStream to execute one ReAct cycle. Pauses after completion, waiting for the user to press Enter to continue.
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

  // Add user message to state for the first time
  if (userInput) {
    runningState = addUserMessage(runningState, userInput);
  }

  while (continueLoop) {
    if (signal.aborted) return;

    const assistantId = uid();
    let accumulatedContent = '';
    let renderTimer: ReturnType<typeof setTimeout> | null = null;

    /** Flush assistant content to the UI */
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

      // Step completed
      if (iterResult.done && iterResult.value) {
        const { state: newState, result: stepResult } = iterResult.value;
        runningState = newState;
        setState(newState);

        // Flush residual tokens
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

        // Step completed but more steps needed — pause and wait
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
 * Advance mode streaming execution
 *
 * Uses advanceStream to execute one phase advancement. Pauses after each phase change, waiting to continue.
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

  /** Flush assistant content to the UI */
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

          // Pause after phase change
          await pauseFn();

          // After resuming, if tokens need to continue outputting, create a new assistant entry
          // (only needed when the new phase is calling-llm or streaming)
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

    // Final result
    if (iterResult.done && iterResult.value) {
      const { state: newState } = iterResult.value;
      setState(newState);
      // Flush residual tokens
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
