/**
 * @fileoverview Single TimelineEntry renderer — chooses layout and style based on entry.type
 *
 * Each entry type has its own icon and color for instant visual distinction.
 * user/assistant/tool use custom layouts (streaming cursor, parameter hierarchy).
 * step-start/step-end use divider styles.
 * run-complete/error use Alert (bordered, prominent).
 * Other entries use unified icon + color row.
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
 * TimelineEntry component props
 */
export interface TimelineEntryProps {
  /** Timeline entry data */
  entry: TimelineEntry;
  /** Display level, controls visibility of extra info like timestamps */
  detailLevel?: DetailLevel;
}

/**
 * Single TimelineEntry renderer
 *
 * Chooses rendering component and style based on entry.type.
 *
 * @param props - Component props
 * @returns Rendered TimelineEntry or null (unknown type)
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

// ── Timestamp utilities ──

/** Optional timestamp prefix */
function Timestamp({ ts }: { ts: number }) {
  return <Text color={theme.dim}>{formatTimestamp(ts)} </Text>;
}

// ── Custom layouts: user / assistant / tool ──

/** User message */
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

/** Agent reply */
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

/** Tool call */
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

  // Completion: determine success or failure based on result
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

// ── Dividers: step-start / step-end ──

/** Step start divider */
function StepStartEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'step-start' }> }) {
  return (
    <Box>
      <Text color={theme.dim}>
        {ICONS.separator.repeat(3)} Step {entry.step} {ICONS.separator.repeat(3)}
      </Text>
    </Box>
  );
}

/** Step end divider */
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

  // If step done has answer, show preview
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

/** Run complete */
function RunCompleteEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'run-complete' }> }) {
  const r = entry.result;
  if (r.type === 'success') {
    return <Alert variant="success">Completed ({r.totalSteps} steps)</Alert>;
  }
  if (r.type === 'max_steps') {
    return <Alert variant="warning">Max steps reached ({r.totalSteps})</Alert>;
  }
  if (r.type === 'abort') {
    return <Alert variant="warning">Aborted ({r.totalSteps} steps)</Alert>;
  }
  return <Alert variant="error">Run error: {r.error.message}</Alert>;
}

/** Error */
function ErrorEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'error' }> }) {
  return <Alert variant="error">{entry.message}</Alert>;
}

// ── Unified row styles: phase / thought / compress / skill / subagent / system ──

/** Phase change (verbose only) */
function PhaseEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'phase' }> }) {
  return (
    <Box marginLeft={1}>
      <Text color={theme.dim}>
        {ICONS.phase} {entry.from} → {entry.to}
      </Text>
    </Box>
  );
}

/** Thought (verbose only) */
function ThoughtEntry({ entry }: { entry: Extract<TimelineEntry, { type: 'thought' }> }) {
  return (
    <Box marginLeft={1}>
      <Text color={theme.dim}>
        {ICONS.thought} {entry.content}
      </Text>
    </Box>
  );
}

/** Compress */
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

/** Skill status */
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

/** SubAgent status */
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

/** System message */
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

/** LLM request summary (verbose only) */
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

/** LLM response summary (verbose only) */
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
