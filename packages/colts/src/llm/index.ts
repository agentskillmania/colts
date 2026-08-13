/**
 * @agentskillmania/colts/llm —— 内置 LLM 便捷入口。
 *
 * 主入口（@agentskillmania/colts）不依赖 llm-client 运行时——引擎只认
 * llmClient 注入。需要「内置 LLM」的宿主从本入口引入，这里才会解析
 * llm-client（及其 pi-ai 适配器）。
 *
 * @example
 * ```typescript
 * import { LLMClient } from '@agentskillmania/colts/llm';
 * const runner = new AgentRunner({
 *   llmClient: LLMClient.quickInit({ providers: [...] }),
 *   model: 'gpt-4o',
 * });
 * ```
 */

export { LLMClient } from '@agentskillmania/llm-client';
export type {
  LLMQuickInit,
  LLMProviderEntry,
  ModelEntry,
  LLMClientOptions,
} from '@agentskillmania/llm-client';
