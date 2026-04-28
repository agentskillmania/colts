/**
 * @fileoverview RunnerOptions — AgentRunner 配置类型定义
 *
 * 独立于 runner/index.ts，避免 middleware/types.ts 的循环依赖。
 */

import type {
  ILLMProvider,
  IToolRegistry,
  IContextCompressor,
  CompressionConfig,
  LLMQuickInit,
} from '../types.js';
import type { Tool as ColtsTool } from '../tools/registry.js';
import type { ISkillProvider } from '../skills/types.js';
import type { SubAgentConfig, ISubAgentFactory } from '../subagent/types.js';
import type { IToolSchemaFormatter } from '../tools/schema-formatter.js';
import type { IExecutionPolicy } from '../policy/types.js';
import type { AgentMiddleware } from '../middleware/types.js';

/**
 * AgentRunner 配置选项
 *
 * 支持注入和快速初始化两种模式
 */
export interface RunnerOptions {
  /** LLM 调用使用的模型标识 */
  model: string;

  // --- LLM: 注入或快速初始化（互斥） ---
  /** LLM provider 实例（注入模式） */
  llmClient?: ILLMProvider;
  /** LLM 快速初始化配置 */
  llm?: LLMQuickInit;

  // --- 工具: 注入或快速初始化（可合并） ---
  /** 工具注册表实例（注入模式） */
  toolRegistry?: IToolRegistry;
  /** 工具数组（快速初始化） */
  tools?: ColtsTool[];

  /** 系统提示词（可选，与 AgentConfig.instructions 合并） */
  systemPrompt?: string;

  /** 请求超时（毫秒） */
  requestTimeout?: number;

  /** run() 的默认最大步数（默认 10） */
  maxSteps?: number;

  /** 上下文压缩器：传 CompressionConfig 使用内置，传 IContextCompressor 使用自定义 */
  compressor?: CompressionConfig | IContextCompressor;

  // --- Skills: 注入或快速初始化 ---
  /** Skill provider 实例（注入模式） */
  skillProvider?: ISkillProvider;
  /** Skill 目录列表（快速初始化，内部创建 FilesystemSkillProvider） */
  skillDirectories?: string[];

  // --- SubAgents ---
  /** Sub-agent 配置列表，提供时自动注册 delegate 工具 */
  subAgents?: SubAgentConfig[];

  // --- 扩展 ---
  /** 工具 schema 格式化器（默认 DefaultToolSchemaFormatter） */
  toolSchemaFormatter?: IToolSchemaFormatter;
  /** Sub-agent 工厂（默认 DefaultSubAgentFactory） */
  subAgentFactory?: ISubAgentFactory;
  /** 执行策略，控制停止条件和错误处理（默认 DefaultExecutionPolicy） */
  executionPolicy?: IExecutionPolicy;

  /** middleware 链，拦截 advance/step/run 执行 */
  middleware?: AgentMiddleware[];

  /** 启用 thinking/推理模式（原生 thinking） */
  thinkingEnabled?: boolean;

  /** 启用 prompt 级 thinking 引导（不支持原生 thinking 的模型） */
  enablePromptThinking?: boolean;
}
