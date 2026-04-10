/**
 * @fileoverview 语义颜色定义 — 使用 ANSI 前景色，跟随终端主题
 *
 * 不使用硬编码背景色，所有颜色为语义化命名。
 */

/**
 * 语义颜色映射
 *
 * 在终端中自动适配暗色/亮色主题。
 * 使用 chalk 的颜色名称，确保 ANSI 兼容。
 */
export const theme = {
  /** 成功 — 绿色 */
  success: 'green',
  /** 错误 — 红色 */
  error: 'red',
  /** 信息 — 青色 */
  info: 'cyan',
  /** 警告 — 黄色 */
  warning: 'yellow',
  /** 工具调用 — 灰色 */
  tool: 'gray',
  /** 次要/弱化文字 — 灰色 */
  dim: 'gray',
  /** 用户消息 — 蓝色 */
  user: 'blue',
  /** 助手消息 — 白色（默认色） */
  assistant: 'white',
  /** 强调 — 品红色 */
  accent: 'magenta',
} as const;

/**
 * 颜色类型
 */
export type ThemeColor = (typeof theme)[keyof typeof theme];
