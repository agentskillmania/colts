/**
 * @fileoverview 单条时间线渲染组件 — 根据 TimelineEntry type 选择样式
 *
 * user / assistant / tool 使用自定义布局（流式光标、参数层级）。
 * 其余条目使用 @inkjs/ui 的 Alert（醒目事件）或 StatusMessage（行内状态）。
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Alert, StatusMessage } from '@inkjs/ui';
import type { TimelineEntry } from '../../types/timeline.js';
import { theme } from '../../utils/theme.js';

/**
 * TimelineEntry 组件 props
 */
export interface TimelineEntryProps {
  /** 时间线条目数据 */
  entry: TimelineEntry;
}

/**
 * 单条时间线渲染
 *
 * 根据 entry.type 选择组件和格式。
 */
export function TimelineEntry({ entry }: TimelineEntryProps) {
  switch (entry.type) {
    case 'user':
      return <UserEntry entry={entry} />;
    case 'assistant':
      return <AssistantEntry entry={entry} />;
    case 'tool':
      return <ToolEntry entry={entry} />;
    case 'phase':
      return <PhaseEntry entry={entry} />;
    case 'thought':
      return <ThoughtEntry entry={entry} />;
    case 'step-start':
      return <StepStartEntry entry={entry} />;
    case 'step-end':
      return <StepEndEntry entry={entry} />;
    case 'run-complete':
      return <RunCompleteEntry entry={entry} />;
    case 'compress':
      return <CompressEntry entry={entry} />;
    case 'skill':
      return <SkillEntry entry={entry} />;
    case 'subagent':
      return <SubagentEntry entry={entry} />;
    case 'system':
      return <SystemEntry entry={entry} />;
    case 'error':
      return <ErrorEntry entry={entry} />;
    default:
      return null;
  }
}

// ──────────────────────────────────────────────────────────────
// 自定义布局：user / assistant / tool
// ──────────────────────────────────────────────────────────────

/** 用户消息 */
function UserEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'user' }> }) {
  return (
    <Box>
      <Text color={theme.user} bold>You: </Text>
      <Text>{entry.content}</Text>
    </Box>
  );
}

/** 助手回复 */
function AssistantEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'assistant' }> }) {
  const cursor = entry.isStreaming ? '▌' : '';
  return (
    <Box>
      <Text color={theme.assistant} bold>Agent: </Text>
      <Text>{entry.content}{cursor}</Text>
    </Box>
  );
}

/** 工具调用 */
function ToolEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'tool' }> }) {
  if (entry.isRunning) {
    return (
      <Box marginLeft={2}>
        <Text color={theme.tool}>  ⚙ {entry.tool}...</Text>
      </Box>
    );
  }

  const resultSummary = formatResult(entry.result);
  return (
    <Box marginLeft={2} flexDirection="column">
      <Text color={theme.tool}>  ⚙ {entry.tool}</Text>
      {entry.args !== undefined && (
        <Box marginLeft={4}>
          <Text color={theme.dim}>{formatArgs(entry.args)}</Text>
        </Box>
      )}
      <Box marginLeft={4}>
        <Text color={theme.dim}>→ {resultSummary}</Text>
      </Box>
    </Box>
  );
}

// ──────────────────────────────────────────────────────────────
// @inkjs/ui 组件：Alert（醒目）+ StatusMessage（行内）
// ──────────────────────────────────────────────────────────────

/** Phase 变化 */
function PhaseEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'phase' }> }) {
  return (
    <Box marginLeft={1}>
      <StatusMessage variant="info">{entry.from} → {entry.to}</StatusMessage>
    </Box>
  );
}

/** Thought */
function ThoughtEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'thought' }> }) {
  return (
    <Box marginLeft={1}>
      <StatusMessage variant="info">thought: {entry.content}</StatusMessage>
    </Box>
  );
}

/** Step 开始 */
function StepStartEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'step-start' }> }) {
  return (
    <Box marginLeft={1}>
      <StatusMessage variant="info">Step {entry.step}</StatusMessage>
    </Box>
  );
}

/** Step 结束 */
function StepEndEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'step-end' }> }) {
  const variant = entry.result.type === 'done' ? 'success' : 'info';
  const label = entry.result.type === 'done' ? 'done (final)' : 'done (continue)';
  return (
    <Box marginLeft={1}>
      <StatusMessage variant={variant}>Step {entry.step} {label}</StatusMessage>
    </Box>
  );
}

/** Run 完成 — Alert（带边框，醒目） */
function RunCompleteEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'run-complete' }> }) {
  const r = entry.result;
  if (r.type === 'success') {
    return <Alert variant="success">Completed ({r.totalSteps} steps)</Alert>;
  }
  if (r.type === 'max_steps') {
    return <Alert variant="warning">Max steps reached ({r.totalSteps})</Alert>;
  }
  return <Alert variant="error">Run error: {r.error.message}</Alert>;
}

/** 压缩 */
function CompressEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'compress' }> }) {
  if (entry.status === 'compressing') {
    return (
      <Box marginLeft={1}>
        <StatusMessage variant="info">Compressing context...</StatusMessage>
      </Box>
    );
  }
  return (
    <Box marginLeft={1}>
      <StatusMessage variant="success">Compressed: {entry.removedCount} messages removed</StatusMessage>
    </Box>
  );
}

/** Skill */
function SkillEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'skill' }> }) {
  if (entry.status === 'loading') {
    return (
      <Box marginLeft={1}>
        <StatusMessage variant="info">Loading skill: {entry.name}...</StatusMessage>
      </Box>
    );
  }
  return (
    <Box marginLeft={1}>
      <StatusMessage variant="success">Skill loaded: {entry.name} ({entry.tokenCount} chars)</StatusMessage>
    </Box>
  );
}

/** SubAgent */
function SubagentEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'subagent' }> }) {
  if (entry.status === 'start') {
    return (
      <Box marginLeft={1}>
        <StatusMessage variant="info">[{entry.name}] Starting: {entry.task}</StatusMessage>
      </Box>
    );
  }
  return (
    <Box marginLeft={1}>
      <StatusMessage variant="success">[{entry.name}] Done</StatusMessage>
    </Box>
  );
}

/** 系统消息 */
function SystemEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'system' }> }) {
  return (
    <Box marginLeft={1}>
      <StatusMessage variant="info">{entry.content}</StatusMessage>
    </Box>
  );
}

/** 错误 — Alert（带边框，醒目） */
function ErrorEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'error' }> }) {
  return <Alert variant="error">{entry.message}</Alert>;
}

// ──────────────────────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────────────────────

/** 格式化工具参数为可读字符串 */
function formatArgs(args: unknown): string {
  if (typeof args === 'object' && args !== null) {
    const entries = Object.entries(args as Record<string, unknown>);
    return entries.map(([k, v]) => `${k}: ${truncate(String(v), 60)}`).join('\n     ');
  }
  return truncate(String(args), 80);
}

/** 格式化工具结果为可读字符串 */
function formatResult(result: unknown): string {
  if (result === undefined) return '';
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  return truncate(str, 80);
}

/** 截断字符串 */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '...';
}
