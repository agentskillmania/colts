/**
 * @fileoverview 根组件 — 路由到主界面或配置引导
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
  /** 应用配置 */
  config: AppConfig;
  /** AgentRunner 实例（配置无效时可能为 null） */
  runner: AgentRunner | null;
  /** 初始 AgentState（可能为 null） */
  initialState?: AgentState | null;
}

/**
 * 根组件
 *
 * 根据配置有效性路由到主界面或配置引导。
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
 * 主界面
 *
 * 单画布布局：HeaderBar + TimelinePanel + InputBar。
 */
function MainTUI({ config, runner, initialState }: { config: AppConfig; runner: AgentRunner; initialState: AgentState | null }) {
  const { exit } = useApp();

  // Session 持久化
  const { save, restoreLatest, setSessionId } = useSession();
  const lastSavedRef = useRef<AgentState | null>(null);

  // Agent 交互
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
  } = useAgent(runner, initialState);

  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'error'>('idle');

  // 启动时恢复最近的 session
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

  // state 变化时自动保存（运行中不保存，避免频繁 IO）
  useEffect(() => {
    if (!state || isRunning) return;
    if (state === lastSavedRef.current) return;
    save(state);
    lastSavedRef.current = state;
  }, [state, isRunning, save]);

  // Ctrl+C: 运行中 → 中断，否则退出
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
      // 暂停时空输入 = 继续
      if (!value.trim() && !isPaused) return;

      // 模式切换命令在 handleSubmit 中拦截（保持与 InputBar 的联动）
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
      <HeaderBar model={model} status={isRunning ? 'running' : runStatus} />
      <Box flexGrow={1} flexDirection="column">
        {hasEntries ? (
          <TimelinePanel entries={entries} detailLevel={detailLevel} />
        ) : (
          <WelcomeScreen agentName={config.agent?.name} model={model} />
        )}
      </Box>
      <InputBar onSubmit={handleSubmit} mode={mode} isRunning={isRunning} isPaused={isPaused} />
    </Box>
  );
}

/**
 * 配置引导
 *
 * 配置无效时显示，提示用户编辑配置文件。
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
