/**
 * @fileoverview CLI 视觉设计规范 — 颜色、图标、格式化工具
 *
 * 所有视觉相关的常量和工具函数集中于此文件。
 * 组件只引用此文件的常量，不硬编码颜色或图标。
 */

// ── 颜色 ──

/**
 * 语义颜色映射
 *
 * 自动适配 dark/light 终端主题。
 * 使用 chalk 颜色名保证 ANSI 兼容性。
 *
 * 使用规则：
 * - accent (magenta): skill 相关状态
 * - info (cyan): 信息性事件（compress、subagent start、system）
 * - success (green): 完成事件（tool done、skill loaded/completed、step end done）
 * - warning (yellow): 进行中（tool running、skill loading）
 * - error (red): 错误和失败
 * - dim (gray): 次要信息（时间戳、args、phase、duration）
 * - user (blue): 用户输入
 * - assistant (white): Agent 回复
 * - tool (gray): 保留，优先用 warning/success 区分运行/完成
 */
export const theme = {
  success: 'green',
  error: 'red',
  info: 'cyan',
  warning: 'yellow',
  tool: 'gray',
  dim: 'gray',
  user: 'blue',
  assistant: 'white',
  accent: 'magenta',
} as const;

/**
 * 颜色类型
 */
export type ThemeColor = (typeof theme)[keyof typeof theme];

// ── 图标 ──

/**
 * 各 TimelineEntry 类型对应的图标
 *
 * 选取广泛支持的 Unicode 字符，避免终端兼容性问题。
 */
export const ICONS = {
  /** 用户消息 */
  user: '❯',
  /** Agent 回复 */
  assistant: '◀',
  /** 工具运行中 */
  toolRunning: '⚙',
  /** 工具完成 */
  toolDone: '✓',
  /** 工具失败 */
  toolError: '✗',
  /** Phase 变化 */
  phase: '·',
  /** 思考 */
  thought: '◉',
  /** 压缩 */
  compress: '»',
  /** Skill */
  skill: '◆',
  /** SubAgent */
  subagent: '⇢',
  /** 系统消息 */
  system: 'ℹ',
  /** 分隔线 */
  separator: '─',
} as const;

// ── 格式化工具 ──

/**
 * 格式化时间戳为 HH:MM:SS 格式
 *
 * 使用固定格式，不依赖 locale，保证跨系统一致性。
 *
 * @param ts - 毫秒级时间戳
 * @returns HH:MM:SS 格式的时间字符串
 */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * 格式化持续时间
 *
 * @param ms - 毫秒数
 * @returns 人类可读的持续时间字符串，如 "1.2s" 或 "350ms"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 截断字符串到最大长度
 *
 * @param s - 输入字符串
 * @param max - 最大长度
 * @returns 截断后的字符串，超出部分用 "..." 替代
 */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '...';
}

/**
 * 格式化工具参数为可读字符串
 *
 * @param args - 工具参数对象或原始值
 * @returns 格式化后的字符串
 */
export function formatArgs(args: unknown): string {
  if (typeof args === 'object' && args !== null) {
    const entries = Object.entries(args as Record<string, unknown>);
    return entries.map(([k, v]) => `${k}: ${truncate(String(v), 60)}`).join('\n     ');
  }
  return truncate(String(args), 80);
}

/**
 * 格式化工具结果为可读字符串
 *
 * @param result - 工具结果值
 * @returns 格式化后的字符串
 */
export function formatResult(result: unknown): string {
  if (result === undefined) return '';
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  return truncate(str, 80);
}
