/**
 * @fileoverview Root component — routes to main UI or configuration setup
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { ThemeProvider } from '@inkjs/ui';
import { coltsTheme } from './theme/index.js';
import { HeaderBar } from './components/layout/header-bar.js';
import { SplitPane } from './components/layout/split-pane.js';
import { InputBar } from './components/input/input-bar.js';
import { ChatPanel } from './components/chat/chat-panel.js';
import { WelcomeScreen } from './components/screens/welcome-screen.js';
import { EventsPanel } from './components/events/events-panel.js';
import { useAgent } from './hooks/use-agent.js';
import { useEvents } from './hooks/use-events.js';
import { useSession } from './hooks/use-session.js';
import type { ExecutionMode } from './components/input/mode-badge.js';
import type { AppConfig } from './config.js';
import type { AgentRunner, AgentState } from '@agentskillmania/colts';
import { theme } from './utils/theme.js';

/**
 * App props
 */
interface AppProps {
  /** Application configuration */
  config: AppConfig;
  /** AgentRunner instance (may be null if configuration is invalid) */
  runner: AgentRunner | null;
  /** Initial AgentState (may be null) */
  initialState?: AgentState | null;
}

/**
 * Root component
 *
 * Routes to MainTUI or configuration setup prompt based on config validity.
 * Wraps the entire app with ThemeProvider for consistent @inkjs/ui component styling.
 */
export function App({ config, runner, initialState }: AppProps) {
  return (
    <ThemeProvider theme={coltsTheme}>
      {config.hasValidConfig && runner ? (
        <MainTUI config={config} runner={runner} initialState={initialState ?? null} />
      ) : (
        <ConfigPrompt configPath={config.configPath} />
      )}
    </ThemeProvider>
  );
}

/**
 * Main UI
 *
 * Contains HeaderBar + SplitPane (Chat + Events) + InputBar.
 * Uses useAgent for conversation flow and useEvents for the events panel.
 */
function MainTUI({ config, runner, initialState }: { config: AppConfig; runner: AgentRunner; initialState: AgentState | null }) {
  const [eventsVisible, setEventsVisible] = useState(true);
  const { exit } = useApp();

  // Events panel
  const { events, addEvent, clearEvents } = useEvents();

  // Session persistence
  const { sessionId, save, restoreLatest, setSessionId } = useSession();
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Agent interaction
  const { messages, mode, isRunning, isPaused, state, sendMessage, setMode, clearMessages } = useAgent(
    runner,
    initialState,
    undefined,
    addEvent // Event forwarding
  );

  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'error'>('idle');

  // Restore most recent session on startup
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

  // Auto-save on state changes
  useEffect(() => {
    if (!state || !isRunning) {
      // Only save when not running (state changes frequently during execution)
      if (state && state.id !== sessionId) {
        save(state);
      }
    }
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [state, isRunning, sessionId, save]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
    }
    if (input === 'e' && key.ctrl) {
      setEventsVisible((v) => !v);
    }
  });

  const handleSubmit = useCallback(
    async (value: string) => {
      // Allow empty input when paused (user presses Enter to continue)
      if (!value.trim() && !isPaused) return;

      // Parse mode switch commands
      const { parseCommand } = await import('./hooks/use-agent.js');
      const cmd = parseCommand(value);

      if (cmd.type.startsWith('mode-')) {
        const newMode = cmd.type.replace('mode-', '') as ExecutionMode;
        setMode(newMode);
        return;
      }

      if (cmd.type === 'clear') {
        clearMessages();
        clearEvents();
        return;
      }

      setRunStatus('running');
      try {
        await sendMessage(value);
      } catch {
        setRunStatus('error');
      } finally {
        // Check for error messages (last message is an error system message)
        setRunStatus((prev) => {
          if (prev === 'error') return 'error';
          return 'idle';
        });
      }
    },
    [sendMessage, setMode, clearMessages, clearEvents]
  );

  const model = config.llm?.model ?? 'unknown';
  const hasMessages = messages.length > 0;

  return (
    <Box flexDirection="column" height="100%">
      <HeaderBar model={model} status={isRunning ? 'running' : runStatus} eventsVisible={eventsVisible} />
      <Box flexGrow={1}>
        <SplitPane
          leftTitle="Chat"
          rightTitle="Events"
          rightVisible={eventsVisible}
          left={hasMessages ? <ChatPanel messages={messages} /> : (
            <WelcomeScreen agentName={config.agent?.name} model={model} />
          )}
          right={<EventsPanel events={events} />}
        />
      </Box>
      <InputBar onSubmit={handleSubmit} mode={mode} isRunning={isRunning} isPaused={isPaused} />
    </Box>
  );
}

/**
 * Configuration setup prompt
 *
 * Displayed when configuration is invalid, prompting the user to edit the config file or use the wizard.
 * Step 10 will implement a full SetupWizard to replace this component.
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
        <Text>
          Please configure your LLM provider and API key.
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.dim}>
          Config file: {configPath ?? 'N/A'}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.dim}>
          Example:
        </Text>
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
