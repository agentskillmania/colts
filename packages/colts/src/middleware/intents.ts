/**
 * @fileoverview 意图构造器（R2P-109，对齐 Rust 216f9c5 的
 * AdvanceHookReturn/RunHookReturn 关联构造器）。
 *
 * 钩子层只声明意图（"答完收工"/"停下来问人"/"run 就此完结"），引擎
 * 结构由内核落成——middleware 层不再手搓 AdvanceResult/RunResult 的
 * 字段拼装。TS 的钩子返回值本就是普通对象，故这里的"构造器"是
 * 工厂函数；产物与旧手搓形态逐字段等价（基线测试钉死）。
 */

import type { AdvanceHookReturn, RunHookReturn } from './types.js';
import type { ExecutionState, Phase, RunResult } from '../execution/index.js';
import type { HumanRequest } from '../hitl/types.js';
import type { AgentState, TokenStats } from '../types.js';

/**
 * 意图："这轮已被我答完，请就此收工"（命令拦截等场景）。
 *
 * 引擎结构由内核落成：Completed 相位（带 `fromCommand` 标记，答案没
 * 走过 token 流，消费方据此补发）、`done`、无 token 结算。
 */
export function completeFromCommand(
  state: AgentState,
  execState: ExecutionState,
  answer: string
): AdvanceHookReturn {
  return {
    stop: true,
    result: {
      state,
      execState,
      phase: { type: 'completed', answer, fromCommand: true },
      done: true,
    },
  };
}

/**
 * 意图："这里要停下来问人"（工具确认类挂起）。
 *
 * 引擎结构由内核落成：WaitingHuman 相位、`done`、token 结算透传当前
 * exec 状态的值。execState 的相位被改写为 WaitingHuman 并在钩子层与
 * result 各带一份，供链合并与引擎消费。TS 的相位形态同时携带
 * `request` 与全量 `requests`（request === requests[0]）；单请求调用
 * 只传 request，requests 缺省为 [request]。
 */
export function waitHuman(
  state: AgentState,
  execState: ExecutionState,
  request: HumanRequest,
  requests?: HumanRequest[]
): AdvanceHookReturn {
  const allRequests = requests ?? [request];
  const waitingPhase: Phase = {
    type: 'waiting-human',
    request,
    requests: allRequests,
  };
  const execWithPhase: ExecutionState = { ...execState, phase: waitingPhase };
  return {
    state,
    execState: execWithPhase,
    stop: true,
    result: {
      state,
      execState: execWithPhase,
      phase: waitingPhase,
      done: true,
      tokens: execState.tokens,
    },
  };
}

/**
 * 意图："这轮已被我答完，run 就此完结"（命令拦截在 `run()` 路径上的
 * 形态）。
 *
 * 引擎结构由内核落成：Success 终态、零步、零用量（答案没经过 LLM）。
 */
export function runComplete(state: AgentState | undefined, answer: string): RunHookReturn {
  const zeroTokens: TokenStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const result: RunResult = {
    type: 'success',
    answer,
    totalSteps: 0,
    tokens: zeroTokens,
    duration: 0,
  };
  return state ? { state, stop: true, result } : { stop: true, result };
}
