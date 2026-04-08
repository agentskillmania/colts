/**
 * @fileoverview colts 核心类型定义
 *
 * Step 0: AgentState 数据结构
 * - 纯数据、可序列化、不可变
 * - 使用 Immer 进行不可变更新
 */

/**
 * 消息角色
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * 消息类型
 */
export type MessageType = 'text' | 'thought' | 'action' | 'tool-result' | 'final';

/**
 * 对话消息
 */
export interface Message {
  /** 角色 */
  role: MessageRole;
  /** 内容 */
  content: string;
  /** 消息类型 */
  type?: MessageType;
  /** 是否对外可见（thought 默认 false） */
  visible?: boolean;
  /** 时间戳 */
  timestamp?: number;
}

/**
 * 工具定义
 */
export interface ToolDefinition {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 参数 JSON Schema */
  parameters?: Record<string, unknown>;
}

/**
 * Agent 配置
 */
export interface AgentConfig {
  /** Agent 名称 */
  name: string;
  /** 系统提示词/人设 */
  instructions: string;
  /** 可用工具列表 */
  tools: ToolDefinition[];
}

/**
 * Agent 状态上下文
 */
export interface AgentContext {
  /** 对话历史 */
  messages: Message[];
  /** 当前执行步数 */
  stepCount: number;
  /** 上一步工具执行结果（如果有） */
  lastToolResult?: unknown;
}

/**
 * Agent 状态（纯数据，不可变）
 *
 * 设计原则：
 * 1. 纯数据：无方法，只有字段
 * 2. 可序列化：可 JSON.stringify/parse
 * 3. 不可变：使用 Immer 更新，原对象保持不变
 */
export interface AgentState {
  /** 唯一标识 */
  id: string;
  /** 配置（不可变） */
  config: AgentConfig;
  /** 执行上下文 */
  context: AgentContext;
}

/**
 * 状态快照
 */
export interface Snapshot {
  /** 版本号 */
  version: string;
  /** 创建时间戳 */
  timestamp: number;
  /** 状态数据 */
  state: AgentState;
  /** 校验和 */
  checksum: string;
}
