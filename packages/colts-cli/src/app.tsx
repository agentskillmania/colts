/**
 * @fileoverview 根组件 — 路由到主界面或配置引导
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
  /** 应用配置 */
  config: AppConfig;
  /** Agent Runner 实例（可能为 null，如果配置无效） */
  runner: AgentRunner | null;
  /** 初始 AgentState（可能为 null） */
  initialState?: AgentState | null;
}

/**
 * 根组件
 *
 * 根据配置有效性路由到 MainTUI 或配置引导提示。
 * 使用 ThemeProvider 包裹整个应用，统一 @inkjs/ui 组件风格。
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
 * 包含 HeaderBar + SplitPane（Chat + Events）+ InputBar。
 * 通过 useAgent 管理对话流，useEvents 管理事件面板。
 */
function MainTUI({ config, runner, initialState }: { config: AppConfig; runner: AgentRunner; initialState: AgentState | null }) {
  const [eventsVisible, setEventsVisible] = useState(true);
  const { exit } = useApp();

  // 事件面板
  const { events, addEvent, clearEvents } = useEvents();

  // Session 持久化
  const { sessionId, save, restoreLatest, setSessionId } = useSession();
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Agent 交互
  const { messages, mode, isRunning, state, sendMessage, setMode, clearMessages } = useAgent(
    runner,
    initialState,
    undefined,
    addEvent // 事件转发
  );

  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'error'>('idle');

  // 启动时恢复最近 session
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

  // state 变化自动保存
  useEffect(() => {
    if (!state || !isRunning) {
      // 只在非运行时保存（运行中 state 频繁变化）
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
      if (!value.trim()) return;

      // 解析模式切换命令
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
        // 检查是否有错误消息（最后一条是 error system 消息）
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
          right={
            <Box paddingX={1} flexDirection="column">
              {events.length === 0 ? (
                <Text color={theme.dim}>No events yet.</Text>
              ) : (
                events.slice(-50).map((e) => (
                  <Text key={e.id} color={theme.dim}>
                    {e.text}
                  </Text>
                ))
              )}
            </Box>
          }
        />
      </Box>
      <InputBar onSubmit={handleSubmit} mode={mode} isRunning={isRunning} />
    </Box>
  );
}

/**
 * 配置引导提示
 *
 * 配置无效时显示，提示用户编辑配置文件或使用向导。
 * Step 10 会实现完整的 SetupWizard 替换此组件。
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
