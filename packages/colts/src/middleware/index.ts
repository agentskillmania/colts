/**
 * @fileoverview Middleware module exports
 */

export type {
  AgentMiddleware,
  AdvanceHookReturn,
  StepHookReturn,
  RunHookReturn,
  AfterRunHookReturn,
  BeforeAdvanceContext,
  AfterAdvanceContext,
  BeforeStepContext,
  AfterStepContext,
  BeforeRunContext,
  AfterRunContext,
} from './types.js';

export { MiddlewareExecutor } from './executor.js';
// 意图构造器（R2P-109，对齐 Rust 216f9c5）：钩子层声明意图，内核落成引擎结构。
export { completeFromCommand, waitHuman, runComplete } from './intents.js';
export type { AdvanceChainResult, StepChainResult, RunChainResult } from './executor.js';
