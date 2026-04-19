/**
 * @fileoverview Tool-Result Phase Handler
 *
 * 处理 tool-result phase 的完整逻辑，包括：
 * - Skill signal 处理（applySkillSignal 唯一调用点）
 * - Delegate tool 检测
 * - 普通 tool 结果
 *
 * 产出 AdvanceResult 含 effects 数组，控制流由 phase + done 决定：
 * - loaded/returned → phase=idle, done=false（继续循环）
 * - top-level return → phase=completed, done=true
 * - same-skill/cyclic/plain → phase=tool-result, done=false
 * - not-found → phase=error, done=true
 */

import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';
import type { AgentState } from '../../types.js';
import type { ExecutionState, AdvanceResult, ToolPostEffect } from '../../execution.js';
import { isSkillSignal, type SkillSignal } from '../../skills/types.js';
import { applySkillSignal, formatSkillToolResult } from '../../skills/signal-handler.js';

export class ToolResultHandler implements IPhaseHandler {
  canHandle(phaseType: string): boolean {
    return phaseType === 'tool-result';
  }

  execute(_ctx: PhaseHandlerContext, state: AgentState, execState: ExecutionState): AdvanceResult {
    const phase = execState.phase;
    if (phase.type !== 'tool-result') {
      throw new Error('ToolResultHandler expects phase type "tool-result"');
    }

    const effects: ToolPostEffect[] = [];
    const results = phase.results;
    const resultKeys = Object.keys(results);
    // 取第一个结果用于 skill signal 检测和向后兼容
    const result = resultKeys.length > 0 ? results[resultKeys[0]] : undefined;
    const action = execState.action;
    let currentState = state;

    // 1. Delegate 检测 — 搜索 allActions，fallback 到 single action
    const delegateAction =
      execState.allActions?.find((a) => a.tool === 'delegate') ??
      (action?.tool === 'delegate' ? action : undefined);
    if (delegateAction) {
      const agentName = String(delegateAction.arguments.agent ?? '');
      const taskDesc = String(delegateAction.arguments.task ?? '');
      effects.push({ type: 'subagent:start', name: agentName, task: taskDesc });
    }

    // 2. Skill signal 处理 — applySkillSignal 唯一调用点
    if (isSkillSignal(result)) {
      const [newState, sigResult] = applySkillSignal(currentState, result as SkillSignal);
      currentState = newState;

      switch (sigResult.action) {
        case 'loaded': {
          // 技能加载事件（用于 UI 展示加载进度）
          effects.push({
            type: 'skill:loading',
            name: sigResult.skillName,
          });
          const instructions =
            (result as SkillSignal & { instructions?: string }).instructions ?? '';
          const tokenCount = instructions.length > 0 ? Math.ceil(instructions.length / 4) : 0;
          effects.push({
            type: 'skill:loaded',
            name: sigResult.skillName,
            tokenCount,
          });
          effects.push({
            type: 'skill:start',
            name: sigResult.skillName,
            task: (result as SkillSignal & { task?: string }).task ?? '',
            state: currentState,
          });
          effects.push({ type: 'tool:end', result: formatSkillToolResult(result) });
          // delegate 后置 subagent:end
          if (delegateAction) {
            effects.push({
              type: 'subagent:end',
              name: String(delegateAction.arguments.agent ?? ''),
              result,
            });
          }
          execState.phase = { type: 'idle' };
          return { state: currentState, phase: execState.phase, done: false, effects };
        }

        case 'returned': {
          effects.push({
            type: 'skill:end',
            name: sigResult.completedSkill,
            result: (result as SkillSignal & { result: string }).result,
            state: currentState,
          });
          effects.push({ type: 'tool:end', result: formatSkillToolResult(result) });
          if (delegateAction) {
            effects.push({
              type: 'subagent:end',
              name: String(delegateAction.arguments.agent ?? ''),
              result,
            });
          }
          execState.phase = { type: 'idle' };
          return { state: currentState, phase: execState.phase, done: false, effects };
        }

        case 'top-level-return': {
          effects.push({
            type: 'skill:end',
            name: sigResult.skillName,
            result: (result as SkillSignal & { result: string }).result,
            state: currentState,
          });
          effects.push({ type: 'tool:end', result: formatSkillToolResult(result) });
          if (delegateAction) {
            effects.push({
              type: 'subagent:end',
              name: String(delegateAction.arguments.agent ?? ''),
              result,
            });
          }
          // 顶级 skill return 后不直接结束，让 LLM 有机会向用户输出结果
          execState.phase = { type: 'idle' };
          return { state: currentState, phase: execState.phase, done: false, effects };
        }

        case 'same-skill': {
          effects.push({
            type: 'tool:end',
            result: `Skill '${sigResult.currentSkill}' is already active`,
          });
          if (delegateAction) {
            effects.push({
              type: 'subagent:end',
              name: String(delegateAction.arguments.agent ?? ''),
              result,
            });
          }
          return { state: currentState, phase: execState.phase, done: false, effects };
        }

        case 'cyclic': {
          effects.push({
            type: 'tool:end',
            result: `Cannot load Skill '${sigResult.currentSkill}': already in the call stack`,
          });
          if (delegateAction) {
            effects.push({
              type: 'subagent:end',
              name: String(delegateAction.arguments.agent ?? ''),
              result,
            });
          }
          return { state: currentState, phase: execState.phase, done: false, effects };
        }

        case 'not-found': {
          effects.push({ type: 'error', error: sigResult.error, context: { step: 0 } });
          if (delegateAction) {
            effects.push({
              type: 'subagent:end',
              name: String(delegateAction.arguments.agent ?? ''),
              result,
            });
          }
          execState.phase = { type: 'error', error: sigResult.error };
          return { state: currentState, phase: execState.phase, done: true, effects };
        }
      }
    }

    // 3. 普通 tool 结果
    if (resultKeys.length <= 1) {
      effects.push({ type: 'tool:end', result });
    } else {
      effects.push({ type: 'tools:end', results });
    }

    if (delegateAction) {
      effects.push({
        type: 'subagent:end',
        name: String(delegateAction.arguments.agent ?? ''),
        result,
      });
    }

    return { state: currentState, phase: execState.phase, done: false, effects };
  }
}
