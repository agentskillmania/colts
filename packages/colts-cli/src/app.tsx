/**
 * @fileoverview Root component — routes to the main TUI or config guidance
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { ThemeProvider } from '@inkjs/ui';
import { coltsTheme } from './theme/index.js';
import { HeaderBar } from './components/layout/header-bar.js';
import { InputBar } from './components/input/input-bar.js';
import { TimelinePanel } from './components/timeline/index.js';
import { WelcomeScreen } from './components/screens/welcome-screen.js';
import { useAgent } from './hooks/use-agent.js';
import { useSession } from './hooks/use-session.js';
import type { ExecutionMode } from './components/input/mode-badge.js';
import type { AppConfig } from './config.js';
import type { AgentRunner, AgentState } from '@agentskillmania/colts';
import { theme } from './utils/theme.js';

/**
 * App props
 */
interface AppProps {
  /** Application config */
  config: AppConfig;
  /** AgentRunner instance (null when config is invalid) */
  runner: AgentRunner | null;
  /** Initial AgentState (may be null) */
  initialState?: AgentState | null;
  /** Optional custom session base directory (for test isolation) */
  sessionBaseDir?: string;
}

/**
 * Root component
 *
 * Routes to the main TUI or config guidance based on config validity.
 *
 * @param props - Component props
 * @param props.config - Application config
 * @param props.runner - AgentRunner instance (null when config is invalid)
 * @param props.initialState - Initial AgentState (may be null)
 * @returns Rendered app root
 */
export function App({ config, runner, initialState, sessionBaseDir }: AppProps) {
  return (
    <ThemeProvider theme={coltsTheme}>
      {config.hasValidConfig && runner ? (
        <MainTUI
          config={config}
          runner={runner}
          initialState={initialState ?? null}
          sessionBaseDir={sessionBaseDir}
        />
      ) : (
        <ConfigPrompt configPath={config.configPath} />
      )}
    </ThemeProvider>
  );
}

/**
 * Main TUI
 *
 * Single-canvas layout: HeaderBar + TimelinePanel + InputBar.
 */
function MainTUI({
  config,
  runner,
  initialState,
  sessionBaseDir,
}: {
  config: AppConfig;
  runner: AgentRunner;
  initialState: AgentState | null;
  sessionBaseDir?: string;
}) {
  const { exit } = useApp();

  // Session persistence
  const { save, restoreLatest, setSessionId } = useSession(sessionBaseDir);
  const lastSavedRef = useRef<AgentState | null>(null);

  // Agent interaction
  const {
    entries,
    mode,
    detailLevel,
    isRunning,
    isPaused,
    state,
    sendMessage,
    setMode,
    clearEntries,
    abort,
  } = useAgent(runner, initialState, runner.skillProvider);

  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'error'>('idle');

  // Restore the most recent session on startup
  useEffect(() => {
    if (initialState) {
      setSessionId(initialState.id);
      return;
    }
    restoreLatest().then((restored) => {
      if (restored) {
        setSessionId(restored.id);
      }
    });
  }, []);

  // Auto-save when state changes (skip while running to avoid frequent IO)
  useEffect(() => {
    if (!state || isRunning) return;
    if (state === lastSavedRef.current) return;
    save(state);
    lastSavedRef.current = state;
  }, [state, isRunning, save]);

  // Ctrl+C: abort while running, otherwise exit
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (isRunning) {
        abort();
      } else {
        exit();
      }
    }
  });

  const handleSubmit = useCallback(
    async (value: string) => {
      // Empty input while paused = resume
      if (!value.trim() && !isPaused) return;

      // Intercept mode-switch commands in handleSubmit (keeps InputBar in sync)
      const { parseCommand } = await import('./hooks/use-agent.js');
      const cmd = parseCommand(value);

      if (cmd.type.startsWith('mode-')) {
        const newMode = cmd.type.replace('mode-', '') as ExecutionMode;
        setMode(newMode);
        return;
      }

      if (cmd.type === 'clear') {
        clearEntries();
        return;
      }

      setRunStatus('running');
      try {
        await sendMessage(value);
      } catch {
        setRunStatus('error');
      } finally {
        setRunStatus((prev) => {
          if (prev === 'error') return 'error';
          return 'idle';
        });
      }
    },
    [sendMessage, setMode, clearEntries, isPaused]
  );

  const model = config.llm?.model ?? 'unknown';
  const hasEntries = entries.length > 0;

  return (
    <Box flexDirection="column" height="100%">
      <Box flexGrow={1} flexDirection="column">
        {hasEntries ? (
          <TimelinePanel entries={entries} detailLevel={detailLevel} />
        ) : (
          <WelcomeScreen agentName={config.agent?.name} model={model} />
        )}
      </Box>
      <InputBar onSubmit={handleSubmit} mode={mode} isRunning={isRunning} isPaused={isPaused} />
      <HeaderBar
        model={model}
        status={isRunning ? 'running' : runStatus}
        skillState={state?.context?.skillState}
      />
    </Box>
  );
}

/**
 * Config guidance
 *
 * Shown when the config is invalid, prompting the user to edit the config file.
 */
function ConfigPrompt({ configPath }: { configPath?: string }) {
  const { exit } = useApp();

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color={theme.error}>
        AI Key Configuration Required
      </Text>
      <Box marginTop={1}>
        <Text>Please configure your LLM provider and API key.</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.dim}>Config file: {configPath ?? 'N/A'}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.dim}>Example:</Text>
      </Box>
      <Box marginLeft={2}>
        <Text color={theme.dim}>
          llm:{'\n'}
          {'  '}provider: openai{'\n'}
          {'  '}apiKey: sk-your-key-here{'\n'}
          {'  '}model: gpt-4o
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.dim}>Press Ctrl+C to exit</Text>
      </Box>
    </Box>
  );
}
