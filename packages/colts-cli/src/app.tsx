/**
 * @fileoverview 根组件 — 路由到主 TUI、交互对话框或配置向导
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, useApp, useInput } from 'ink';
import { ThemeProvider } from '@inkjs/ui';
import { coltsTheme } from './theme/index.js';
import { HeaderBar } from './components/layout/header-bar.js';
import { InputBar } from './components/input/input-bar.js';
import { TimelinePanel } from './components/timeline/index.js';
import { WelcomeScreen } from './components/screens/welcome-screen.js';
import { AskHumanDialog } from './components/interactive/ask-human-dialog.js';
import { ConfirmDialog } from './components/interactive/confirm-dialog.js';
import { SetupWizard } from './components/setup/setup-wizard.js';
import { useAgent } from './hooks/use-agent.js';
import { useSession } from './hooks/use-session.js';
import type { ExecutionMode } from './components/input/mode-badge.js';
import type { AppConfig } from './config.js';
import type { AgentRunner, AgentState } from '@agentskillmania/colts';
import type { InteractionState } from './types/interaction.js';
import { interactionCallbacks } from './index.js';

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
 * Routes to the main TUI, setup wizard, or config guidance.
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
        <SetupWizard
          onComplete={async (setup) => {
            // 动态导入避免循环依赖
            const { saveSetup } = await import('./config.js');
            await saveSetup(setup);
          }}
        />
      )}
    </ThemeProvider>
  );
}

/**
 * Main TUI
 *
 * Single-canvas layout: HeaderBar + TimelinePanel + InputBar.
 * Supports interaction modes (AskHuman, Confirm).
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

  // 交互状态（AskHuman / Confirm 对话框）
  const [interaction, setInteraction] = useState<InteractionState>({ type: 'none' });

  // 延迟绑定交互 handler：挂载时填入闭包持有 setInteraction 的 handler
  useEffect(() => {
    interactionCallbacks.askHuman = async ({ questions, context }) => {
      return new Promise((resolve) => {
        setInteraction({ type: 'ask-human', questions, context, resolve });
      });
    };
    interactionCallbacks.confirm = async (toolName, args) => {
      return new Promise((resolve) => {
        setInteraction({ type: 'confirm', toolName, args, resolve });
      });
    };
    return () => {
      interactionCallbacks.askHuman = null;
      interactionCallbacks.confirm = null;
    };
  }, []);

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
  const isInteracting = interaction.type !== 'none';

  return (
    <Box flexDirection="column" height="100%">
      <Box flexGrow={1} flexDirection="column">
        {isInteracting ? (
          interaction.type === 'ask-human' ? (
            <AskHumanDialog
              questions={interaction.questions}
              context={interaction.context}
              onAnswer={(response) => {
                interaction.resolve(response);
                setInteraction({ type: 'none' });
              }}
            />
          ) : (
            <ConfirmDialog
              toolName={interaction.toolName}
              args={interaction.args}
              onResult={(approved) => {
                interaction.resolve(approved);
                setInteraction({ type: 'none' });
              }}
            />
          )
        ) : hasEntries ? (
          <TimelinePanel entries={entries} detailLevel={detailLevel} />
        ) : (
          <WelcomeScreen agentName={config.agent?.name} model={model} />
        )}
      </Box>
      {!isInteracting && (
        <InputBar onSubmit={handleSubmit} mode={mode} isRunning={isRunning} isPaused={isPaused} />
      )}
      <HeaderBar
        model={model}
        status={isRunning ? 'running' : runStatus}
        skillState={state?.context?.skillState}
      />
    </Box>
  );
}
