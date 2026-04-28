/**
 * @fileoverview Agent Middleware — 拦截 AgentRunner 三级执行的插件接口
 *
 * 支持在 advance / step / run 三个级别插入 before/after 钩子。
 * 中间件可以观察状态、修改状态、或通过 stop 字段受控中断执行。
 */

import type { AgentState } from '../types.js';
import type {
  ExecutionState,
  Phase,
  AdvanceResult,
  StepResult,
  RunResult,
} from '../execution/index.js';

// ─── Return Types ────────────────────────────────────────────────

/**
 * Advance 级别钩子的返回值
 *
 * - void → 继续，不修改
 * - { state?, execState? } → 继续，用覆盖值替换 state/execState
 * - { stop: true, result? } → 受控中断，跳过 executeAdvance；
 *   有 result 则用 result，无则由 runner 生成默认中断结果
 */
export type AdvanceHookReturn =
  | void
  | { state?: AgentState; execState?: ExecutionState; stop?: false }
  | { stop: true; result?: AdvanceResult };

/**
 * Step 级别钩子的返回值
 *
 * - void → 继续
 * - { state? } → 继续，覆盖 state
 * - { stop: true } → 受控中断，runner 返回 error StepResult
 */
export type StepHookReturn = void | { state?: AgentState; stop?: false } | { stop: true };

/**
 * Run 级别钩子的返回值
 *
 * - void → 继续
 * - { state? } → 继续，覆盖 state
 * - { stop: true } → 受控中断，runner 返回 error RunResult
 */
export type RunHookReturn = void | { state?: AgentState; stop?: false } | { stop: true };

/**
 * afterRun 钩子的返回值（纯观察，无中断能力）
 */
export type AfterRunHookReturn = void;

// ─── Context Types ───────────────────────────────────────────────

/** beforeAdvance 的上下文 */
export interface BeforeAdvanceContext {
  /** 当前 agent state（只读） */
  readonly state: AgentState;
  /** 当前 execution state（只读） */
  readonly execState: ExecutionState;
  /** 即将离开的 phase */
  readonly fromPhase: Phase;
  /** 当前 step 序号（从 0 开始） */
  readonly stepNumber: number;
  /** run 级别的已执行 step 总数 */
  readonly runStepCount: number;
}

/** afterAdvance 的上下文 */
export interface AfterAdvanceContext {
  /** advance 后的 agent state（只读） */
  readonly state: AgentState;
  /** advance 后的 execution state（只读） */
  readonly execState: ExecutionState;
  /** advance 的完整返回结果 */
  readonly result: Readonly<AdvanceResult>;
  /** 当前 step 序号 */
  readonly stepNumber: number;
  /** run 级别的已执行 step 总数 */
  readonly runStepCount: number;
}

/** beforeStep 的上下文 */
export interface BeforeStepContext {
  /** 当前 agent state（只读） */
  readonly state: AgentState;
  /** 当前 step 序号 */
  readonly stepNumber: number;
}

/** afterStep 的上下文 */
export interface AfterStepContext {
  /** step 结束后的 agent state（只读） */
  readonly state: AgentState;
  /** step 的返回结果 */
  readonly result: Readonly<StepResult>;
  /** 当前 step 序号 */
  readonly stepNumber: number;
}

/** beforeRun 的上下文 */
export interface BeforeRunContext {
  /** 初始 agent state（只读） */
  readonly state: AgentState;
}

/** afterRun 的上下文 */
export interface AfterRunContext {
  /** 最终 agent state（只读） */
  readonly state: AgentState;
  /** run 的返回结果 */
  readonly result: Readonly<RunResult>;
}

// ─── Middleware Interface ────────────────────────────────────────

/**
 * Agent 中间件接口
 *
 * 所有方法均为 optional，只需实现关心的钩子。
 * before hooks 按注册顺序执行，after hooks 按注册逆序执行。
 */
export interface AgentMiddleware {
  /** 中间件名称，用于调试和错误信息 */
  readonly name: string;

  // ── Advance 级别（微步骤） ──

  /** advance() 执行前。可修改 state/execState 或受控中断 */
  beforeAdvance?(ctx: BeforeAdvanceContext): Promise<AdvanceHookReturn>;

  /** advance() 执行后。可观察结果、修改 state/execState */
  afterAdvance?(ctx: AfterAdvanceContext): Promise<AdvanceHookReturn>;

  // ── Step 级别（中步骤） ──

  /** step() 执行前。可修改 state 或受控中断 */
  beforeStep?(ctx: BeforeStepContext): Promise<StepHookReturn>;

  /** step() 执行后。可观察结果、修改 state */
  afterStep?(ctx: AfterStepContext): Promise<StepHookReturn>;

  // ── Run 级别（宏步骤） ──

  /** run() 执行前。可修改 state 或受控中断 */
  beforeRun?(ctx: BeforeRunContext): Promise<RunHookReturn>;

  /** run() 执行后。纯观察，无中断能力 */
  afterRun?(ctx: AfterRunContext): Promise<AfterRunHookReturn>;
}
