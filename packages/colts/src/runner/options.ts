/**
 * @fileoverview RunnerOptions — AgentRunner 配置类型定义
 *
 * 独立于 runner/index.ts，避免 middleware/types.ts 的循环依赖。
 */

import type { IMessageAssembler } from '../message-assembler/types.js';
import type { AgentMiddleware } from '../middleware/types.js';
import type { IExecutionPolicy } from '../policy/types.js';
import type { ISkillProvider } from '../skills/types.js';
import type { Tool as ColtsTool } from '../tools/registry.js';
import type { IToolSchemaFormatter } from '../tools/schema-formatter.js';
import type {
  ILLMProvider,
  IToolRegistry,
  IContextCompressor,
  CompressionConfig,
} from '../types.js';

/**
 * AgentRunner 配置选项
 *
 * 支持注入和快速初始化两种模式
 */
export interface RunnerOptions {
  /** LLM 调用使用的模型标识 */
  model: string;

  // --- LLM: 注入或快速初始化（互斥） ---
  /** LLM provider 实例（注入模式）——引擎不内置 LLM 创建；
   *  需要内置便捷请用 `LLMClient.quickInit()`（@agentskillmania/colts/llm） */
  llmClient?: ILLMProvider;

  // --- 工具: 注入或快速初始化（可合并） ---
  /** 工具注册表实例（注入模式） */
  toolRegistry?: IToolRegistry;
  /** 工具数组（快速初始化） */
  tools?: ColtsTool[];

  /**
   * `file:` 附件引用的锚定目录（= 会话目录，与会话存储同源派生）。
   * 无会话持久化时留空——收到 `file:` 引用会在 wire 物化时报错。
   * （R2P-107，对齐 Rust RunnerOptions.attachment_dir。）
   */
  attachmentDir?: string;

  /** 系统提示词（可选，与 AgentConfig.instructions 合并） */
  systemPrompt?: string;

  /** 请求超时（毫秒） */
  requestTimeout?: number;

  /** run() 的默认最大步数（默认 500） */
  maxSteps?: number;

  /**
   * 内部测试用：覆盖 run() / runStream() 的硬步数上限安全网。
   * @internal
   */
  runHardLimit?: number;

  /** 上下文压缩器：传 CompressionConfig 使用内置，传 IContextCompressor 使用自定义 */
  compressor?: CompressionConfig | IContextCompressor;

  // --- Skills: 注入或快速初始化 ---
  /** Skill provider 实例（注入模式） */
  skillProvider?: ISkillProvider;
  /** Skill 目录列表（快速初始化，内部创建 FilesystemSkillProvider） */
  skillDirs?: string[];

  // --- 扩展 ---
  /** 工具 schema 格式化器（默认 DefaultToolSchemaFormatter） */
  toolSchemaFormatter?: IToolSchemaFormatter;
  /** 执行策略，控制停止条件和错误处理（默认 DefaultExecutionPolicy） */
  executionPolicy?: IExecutionPolicy;

  /** middleware 链，拦截 advance/step/run 执行 */
  middleware?: AgentMiddleware[];

  /** 启用 thinking/推理模式（原生 thinking） */
  thinkingEnabled?: boolean;

  /** 启用 prompt 级 thinking 引导（不支持原生 thinking 的模型） */
  enablePromptThinking?: boolean;

  /** 采样温度（运行时默认，可被 PerRequestOptions.temperature 覆盖） */
  temperature?: number;

  /** 自定义消息组装器（默认 DefaultMessageAssembler） */
  messageAssembler?: IMessageAssembler;
}

/**
 * Options that can vary per-request across all runner methods.
 * Shared by step/run/advance — any field here can be overridden
 * on each call without recreating the runner.
 */
export interface PerRequestOptions {
  /** Enable thinking/reasoning for this specific request (overrides runner default) */
  thinkingEnabled?: boolean;
  /** Override the model for this specific request (overrides runner default) */
  model?: string;
  /** Sampling temperature for this specific request (overrides runner default) */
  temperature?: number;
  /** AbortSignal to cancel execution */
  signal?: AbortSignal;
}

/** Options for step/stepStream */
export type StepOptions = PerRequestOptions;

/** Options for run/runStream */
export interface RunOptions extends PerRequestOptions {
  /** Maximum number of steps (overrides runner default) */
  maxSteps?: number;
}
