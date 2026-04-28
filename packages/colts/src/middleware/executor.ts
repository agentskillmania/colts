/**
 * @fileoverview MiddlewareExecutor — 中间件链执行器
 *
 * 负责 before hooks（按注册顺序）和 after hooks（按注册逆序）的执行，
 * 以及 override 合并和 stop 信号处理。
 */

import type { AgentState } from '../types.js';
import type { ExecutionState, AdvanceResult } from '../execution/index.js';
import type {
  AgentMiddleware,
  AdvanceHookReturn,
  StepHookReturn,
  RunHookReturn,
  BeforeAdvanceContext,
  AfterAdvanceContext,
  BeforeStepContext,
  AfterStepContext,
  BeforeRunContext,
  AfterRunContext,
} from './types.js';

// ─── Internal result types ───────────────────────────────────────

/** advance 级别 hook 链的执行结果 */
export interface AdvanceChainResult {
  /** 某个 middleware 请求受控中断，附带可选的自定义 result */
  stopResult?: AdvanceResult;
  /** 合并后的 state override */
  state?: AgentState;
  /** 合并后的 execState override */
  execState?: ExecutionState;
}

/** step 级别 hook 链的执行结果 */
export interface StepChainResult {
  /** 某个 middleware 请求受控中断 */
  stopped: boolean;
  /** 合并后的 state override */
  state?: AgentState;
}

/** run 级别 hook 链的执行结果 */
export interface RunChainResult {
  /** 某个 middleware 请求受控中断 */
  stopped: boolean;
  /** 合并后的 state override */
  state?: AgentState;
}

// ─── Executor ────────────────────────────────────────────────────

/**
 * 中间件链执行器
 *
 * 按注册顺序执行 before hooks，按注册逆序执行 after hooks。
 * 支持 override 合并和 stop 信号。
 */
export class MiddlewareExecutor {
  private readonly middlewares: AgentMiddleware[];

  constructor(middlewares: AgentMiddleware[]) {
    this.middlewares = middlewares;
  }

  /** 是否有中间件注册 */
  get isEmpty(): boolean {
    return this.middlewares.length === 0;
  }

  /** 获取中间件列表（只读） */
  get list(): readonly AgentMiddleware[] {
    return this.middlewares;
  }

  // ── Advance Hooks ──

  /**
   * 执行 beforeAdvance 链
   *
   * 按注册顺序执行，合并 override。遇到 stop 则立即返回。
   */
  async runBeforeAdvance(ctx: BeforeAdvanceContext): Promise<AdvanceChainResult> {
    let state: AgentState | undefined;
    let execState: ExecutionState | undefined;

    for (const mw of this.middlewares) {
      if (!mw.beforeAdvance) continue;
      const ret: AdvanceHookReturn = await mw.beforeAdvance(ctx);

      if (ret && typeof ret === 'object') {
        if ('stop' in ret && ret.stop) {
          return { stopResult: ret.result, state, execState };
        }
        if (ret.state) state = ret.state;
        if ('execState' in ret && ret.execState) execState = ret.execState;
      }
    }

    return { state, execState };
  }

  /**
   * 执行 afterAdvance 链
   *
   * 按注册逆序执行，合并 override。遇到 stop 则立即返回。
   */
  async runAfterAdvance(ctx: AfterAdvanceContext): Promise<AdvanceChainResult> {
    let state: AgentState | undefined;
    let execState: ExecutionState | undefined;

    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const mw = this.middlewares[i]!;
      if (!mw.afterAdvance) continue;
      const ret: AdvanceHookReturn = await mw.afterAdvance(ctx);

      if (ret && typeof ret === 'object') {
        if ('stop' in ret && ret.stop) {
          return { stopResult: ret.result, state, execState };
        }
        if (ret.state) state = ret.state;
        if ('execState' in ret && ret.execState) execState = ret.execState;
      }
    }

    return { state, execState };
  }

  // ── Step Hooks ──

  /** 执行 beforeStep 链（按注册顺序） */
  async runBeforeStep(ctx: BeforeStepContext): Promise<StepChainResult> {
    let state: AgentState | undefined;

    for (const mw of this.middlewares) {
      if (!mw.beforeStep) continue;
      const ret: StepHookReturn = await mw.beforeStep(ctx);

      if (ret && typeof ret === 'object') {
        if ('stop' in ret && ret.stop) {
          return { stopped: true, state };
        }
        if (ret.state) state = ret.state;
      }
    }

    return { stopped: false, state };
  }

  /** 执行 afterStep 链（按注册逆序） */
  async runAfterStep(ctx: AfterStepContext): Promise<StepChainResult> {
    let state: AgentState | undefined;

    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const mw = this.middlewares[i]!;
      if (!mw.afterStep) continue;
      const ret: StepHookReturn = await mw.afterStep(ctx);

      if (ret && typeof ret === 'object') {
        if ('stop' in ret && ret.stop) {
          return { stopped: true, state };
        }
        if (ret.state) state = ret.state;
      }
    }

    return { stopped: false, state };
  }

  // ── Run Hooks ──

  /** 执行 beforeRun 链（按注册顺序） */
  async runBeforeRun(ctx: BeforeRunContext): Promise<RunChainResult> {
    let state: AgentState | undefined;

    for (const mw of this.middlewares) {
      if (!mw.beforeRun) continue;
      const ret: RunHookReturn = await mw.beforeRun(ctx);

      if (ret && typeof ret === 'object') {
        if ('stop' in ret && ret.stop) {
          return { stopped: true, state };
        }
        if (ret.state) state = ret.state;
      }
    }

    return { stopped: false, state };
  }

  /** 执行 afterRun 链（按注册逆序，纯观察） */
  async runAfterRun(ctx: AfterRunContext): Promise<void> {
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const mw = this.middlewares[i]!;
      if (!mw.afterRun) continue;
      await mw.afterRun(ctx);
    }
  }
}
