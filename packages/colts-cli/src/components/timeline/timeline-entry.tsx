/**
 * @fileoverview 单条 TimelineEntry 渲染器 — 根据 entry.type 选择布局和样式
 *
 * 每种 entry 类型有独立的图标和颜色，视觉扫描时可立即区分。
 * user/assistant/tool 使用自定义布局（streaming cursor、参数层级）。
 * step-start/step-end 使用分隔线样式。
 * run-complete/error 使用 Alert（带边框，醒目）。
 * 其余条目使用统一的图标 + 颜色行。
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Alert } from '@inkjs/ui';
import type { TimelineEntry, DetailLevel } from '../../types/timeline.js';
import {
  theme,
  ICONS,
  formatTimestamp,
  formatDuration,
  formatArgs,
  formatResult,
} from '../../utils/theme.js';

/**
 * TimelineEntry 组件 props
 */
export interface TimelineEntryProps {
  /** Timeline entry 数据 */
  entry: TimelineEntry;
  /** 显示级别，控制时间戳等额外信息的展示 */
  detailLevel?: DetailLevel;
}

/**
 * 单条 TimelineEntry 渲染器
 *
 * 根据 entry.type 选择渲染组件和样式。
 *
 * @param props - 组件 props
 * @returns 渲染的 TimelineEntry 或 null（未知类型）
 */
export function TimelineEntry({ entry, detailLevel = 'compact' }: TimelineEntryProps) {
  const showTimestamp = detailLevel !== 'compact';

  switch (entry.type) {
    case 'user':
      return <UserEntry entry={entry} showTimestamp={showTimestamp} />;
    case 'assistant':
      return <AssistantEntry entry={entry} showTimestamp={showTimestamp} />;
    case 'tool':
      return <ToolEntry entry={entry} showTimestamp={showTimestamp} />;
    case 'phase':
      return <PhaseEntry entry={entry} />;
    case 'thought':
      return <ThoughtEntry entry={entry} />;
    case 'step-start':
      return <StepStartEntry entry={entry} />;
    case 'step-end':
      return <StepEndEntry entry={entry} showTimestamp={showTimestamp} />;
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
    case 'llm-request':
      return <LlmRequestEntry entry={entry} />;
    case 'llm-response':
      return <LlmResponseEntry entry={entry} />;
    default:
      return null;
  }
}

// ── 时间戳工具 ──

/** 可选的时间戳前缀 */
function Timestamp({ ts }: { ts: number }) {
  return <Text color={theme.dim}>{formatTimestamp(ts)} </Text>;
}

// ── 自定义布局：user / assistant / tool ──

/** 用户消息 */
function UserEntry({
  entry,
  showTimestamp,
}: {
  entry: Extract<TimelineEntry, { type: 'user' }>;
  showTimestamp: boolean;
}) {
  return (
    <Box>
      {showTimestamp && <Timestamp ts={entry.timestamp} />}
      <Text color={theme.user} bold>
        {ICONS.user}{' '}
      </Text>
      <Text>{entry.content}</Text>
    </Box>
  );
}

/** Agent 回复 */
function AssistantEntry({
  entry,
  showTimestamp,
}: {
  entry: Extract<TimelineEntry, { type: 'assistant' }>;
  showTimestamp: boolean;
}) {
  const cursor = entry.isStreaming ? '▌' : '';
  return (
    <Box>
      {showTimestamp && <Timestamp ts={entry.timestamp} />}
      <Text color={theme.assistant} bold>
        {ICONS.assistant}{' '}
      </Text>
      <Text>
        {entry.content}
        {cursor}
      </Text>
    </Box>
  );
}

/** 工具调用 */
function ToolEntry({
  entry,
  showTimestamp,
}: {
  entry: Extract<TimelineEntry, { type: 'tool' }>;
  showTimestamp: boolean;
}) {
  if (entry.isRunning) {
    return (
      <Box marginLeft={2}>
        {showTimestamp && <Timestamp ts={entry.timestamp} />}
        <Text color={theme.warning}>
          {ICONS.toolRunning} {entry.tool}...
        </Text>
      </Box>
    );
  }

  // 完成：根据 result 判断成功或失败
  const hasError = typeof entry.result === 'string' && entry.result.startsWith('Error:');
  const icon = hasError ? ICONS.toolError : ICONS.toolDone;
  const color = hasError ? theme.error : theme.success;

  return (
    <Box marginLeft={2} flexDirection="column">
      <Box>
        {showTimestamp && <Timestamp ts={entry.timestamp} />}
        <Text color={color}>
          {icon} {entry.tool}
        </Text>
        {entry.duration !== undefined && (
          <Text color={theme.dim}> ({formatDuration(entry.duration)})</Text>
        )}
      </Box>
      {entry.args !== undefined && (
        <Box marginLeft={4}>
          <Text color={theme.dim}>{formatArgs(entry.args)}</Text>
        </Box>
      )}
      <Box marginLeft={4}>
        <Text color={theme.dim}>→ {formatResult(entry.result)}</Text>
      </Box>
    </Box>
  );
}

// ── 分隔线：step-start / step-end ──

/** Step 开始分隔线 */
function StepStartEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'step-start' }> }) {
  return (
    <Box>
      <Text color={theme.dim}>
        {ICONS.separator.repeat(3)} Step {entry.step} {ICONS.separator.repeat(3)}
      </Text>
    </Box>
  );
}

/** Step 结束分隔线 */
function StepEndEntry({
  entry,
  showTimestamp,
}: {
  entry: Extract<TimelineEntry, { type: 'step-end' }>;
  showTimestamp: boolean;
}) {
  const isDone = entry.result.type === 'done';
  const color = isDone ? theme.success : theme.info;
  const label = isDone ? 'done' : 'continue';

  // 如果 step done 有 answer，显示预览
  let answerPreview = '';
  if (isDone && entry.result.type === 'done') {
    const answer = entry.result.answer;
    answerPreview = answer.length > 60 ? answer.slice(0, 60) + '...' : answer;
  }

  return (
    <Box flexDirection="column">
      <Box>
        {showTimestamp && <Timestamp ts={entry.timestamp} />}
        <Text color={color}>
          {ICONS.separator.repeat(3)} Step {entry.step} {label} {ICONS.separator.repeat(3)}
        </Text>
      </Box>
      {answerPreview && (
        <Box marginLeft={4}>
          <Text color={theme.dim}>{answerPreview}</Text>
        </Box>
      )}
    </Box>
  );
}

// ── Alert：run-complete / error ──

/** Run 完成 */
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

/** 错误 */
function ErrorEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'error' }> }) {
  return <Alert variant="error">{entry.message}</Alert>;
}

// ── 统一行样式：phase / thought / compress / skill / subagent / system ──

/** Phase 变化（verbose only） */
function PhaseEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'phase' }> }) {
  return (
    <Box marginLeft={1}>
      <Text color={theme.dim}>
        {ICONS.phase} {entry.from} → {entry.to}
      </Text>
    </Box>
  );
}

/** 思考（verbose only） */
function ThoughtEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'thought' }> }) {
  return (
    <Box marginLeft={1}>
      <Text color={theme.dim}>
        {ICONS.thought} {entry.content}
      </Text>
    </Box>
  );
}

/** 压缩 */
function CompressEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'compress' }> }) {
  if (entry.status === 'compressing') {
    return (
      <Box marginLeft={1}>
        <Text color={theme.warning}>{ICONS.compress} Compressing context...</Text>
      </Box>
    );
  }
  return (
    <Box marginLeft={1}>
      <Text color={theme.success}>
        {ICONS.compress} Compressed: {entry.removedCount} messages removed
      </Text>
      {entry.summary && <Text color={theme.dim}> {entry.summary}</Text>}
    </Box>
  );
}

/** Skill 状态 */
function SkillEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'skill' }> }) {
  const statusConfig: Record<typeof entry.status, { color: string; label: string }> = {
    loading: { color: theme.warning, label: 'Loading' },
    loaded: { color: theme.success, label: 'Loaded' },
    active: { color: theme.accent, label: 'Activated' },
    completed: { color: theme.success, label: 'Completed' },
  };

  const cfg = statusConfig[entry.status];
  return (
    <Box marginLeft={1}>
      <Text color={cfg.color}>
        {ICONS.skill} {cfg.label}: {entry.name}
      </Text>
      {entry.status === 'loaded' && entry.tokenCount !== undefined && (
        <Text color={theme.dim}> ({entry.tokenCount} chars)</Text>
      )}
      {entry.status === 'completed' && entry.result && (
        <Text color={theme.dim}>
          {' '}
          → {entry.result.length > 60 ? entry.result.slice(0, 60) + '...' : entry.result}
        </Text>
      )}
    </Box>
  );
}

/** SubAgent 状态 */
function SubagentEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'subagent' }> }) {
  if (entry.status === 'start') {
    return (
      <Box marginLeft={1}>
        <Text color={theme.info}>
          {ICONS.subagent} {entry.name}
        </Text>
        {entry.task && <Text color={theme.dim}>: {entry.task}</Text>}
      </Box>
    );
  }
  // status === 'end'
  const resultStr = entry.result !== undefined ? String(entry.result).slice(0, 80) : '';
  return (
    <Box marginLeft={1}>
      <Text color={theme.success}>
        {ICONS.subagent} {entry.name} done
      </Text>
      {resultStr && <Text color={theme.dim}> → {resultStr}</Text>}
    </Box>
  );
}

/** 系统消息 */
function SystemEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'system' }> }) {
  return (
    <Box marginLeft={1}>
      <Text color={theme.info}>
        {ICONS.system} {entry.content}
      </Text>
    </Box>
  );
}

// ── verbose only：LLM request / response ──

/** LLM 请求概要（verbose only） */
function LlmRequestEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'llm-request' }> }) {
  return (
    <Box marginLeft={1} flexDirection="column">
      <Box>
        <Text color={theme.dim}>↑ LLM request: {entry.messageCount} messages</Text>
      </Box>
      {entry.tools.length > 0 && (
        <Box marginLeft={2}>
          <Text color={theme.dim}>tools: {entry.tools.join(', ')}</Text>
        </Box>
      )}
      {entry.skill?.current && (
        <Box marginLeft={2}>
          <Text color={theme.dim}>skill: {entry.skill.current}</Text>
        </Box>
      )}
    </Box>
  );
}

/** LLM 响应概要（verbose only） */
function LlmResponseEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'llm-response' }> }) {
  return (
    <Box marginLeft={1} flexDirection="column">
      <Box>
        <Text color={theme.dim}>↓ LLM response: {entry.textLength} chars</Text>
      </Box>
      {entry.toolCalls && entry.toolCalls.length > 0 && (
        <Box marginLeft={2}>
          <Text color={theme.dim}>
            tool calls: {entry.toolCalls.map((tc) => tc.name).join(', ')}
          </Text>
        </Box>
      )}
    </Box>
  );
}
