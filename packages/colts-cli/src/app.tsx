/**
 * @fileoverview 根组件 — 路由到主界面或配置引导
 */

import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { ThemeProvider } from '@inkjs/ui';
import { coltsTheme } from './theme/index.js';
import { HeaderBar } from './components/layout/header-bar.js';
import { SplitPane } from './components/layout/split-pane.js';
import { InputBar } from './components/input/input-bar.js';
import type { ExecutionMode } from './components/input/mode-badge.js';
import type { AppConfig } from './config.js';
import type { AgentRunner } from '@agentskillmania/colts';
import { theme } from './utils/theme.js';

/**
 * App props
 */
interface AppProps {
  /** 应用配置 */
  config: AppConfig;
  /** Agent Runner 实例（可能为 null，如果配置无效） */
  runner: AgentRunner | null;
}

/**
 * 根组件
 *
 * 根据配置有效性路由到 MainTUI 或配置引导提示。
 * 使用 ThemeProvider 包裹整个应用，统一 @inkjs/ui 组件风格。
 */
export function App({ config, runner }: AppProps) {
  return (
    <ThemeProvider theme={coltsTheme}>
      {config.hasValidConfig && runner ? (
        <MainTUI config={config} runner={runner} />
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
 * Step 1 只搭建框架，Step 2 会接入 useAgent 实现对话。
 */
function MainTUI({ config }: { config: AppConfig; runner: AgentRunner }) {
  const [status] = useState<'idle' | 'running' | 'error'>('idle');
  const [eventsVisible, setEventsVisible] = useState(true);
  const [mode] = useState<ExecutionMode>('run');
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
    }
    if (input === 'e' && key.ctrl) {
      setEventsVisible((v) => !v);
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSubmit = (_value: string) => {
    // Step 2 会接入 agent 对话
  };

  const model = config.llm?.model ?? 'unknown';

  return (
    <Box flexDirection="column" height="100%">
      <HeaderBar model={model} status={status} eventsVisible={eventsVisible} />
      <Box flexGrow={1}>
        <SplitPane
          leftTitle="Chat"
          rightTitle="Events"
          rightVisible={eventsVisible}
          left={
            <Box paddingX={1}>
              <Text color={theme.dim}>Ready. Type a message to start.</Text>
            </Box>
          }
          right={
            <Box paddingX={1}>
              <Text color={theme.dim}>No events yet.</Text>
            </Box>
          }
        />
      </Box>
      <InputBar onSubmit={handleSubmit} mode={mode} isRunning={status === 'running'} />
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
