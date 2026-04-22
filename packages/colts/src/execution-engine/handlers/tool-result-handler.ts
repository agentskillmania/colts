/**
 * @fileoverview Tool-Result Phase Handler
 *
 * Full logic for handling the tool-result phase, including:
 * - Skill signal processing (sole call site of applySkillSignal)
 * - Delegate tool detection
 * - Plain tool results
 *
 * Produces AdvanceResult with effects array; control flow is determined by phase + done:
 * - loaded/returned → phase=idle, done=false (continue loop)
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
    // Use first result for skill signal detection and backward compatibility
    const result = resultKeys.length > 0 ? results[resultKeys[0]] : undefined;
    const action = execState.action;
    let currentState = state;

    // 1. Delegate detection — search allActions, fallback to single action
    const delegateAction =
      execState.allActions?.find((a) => a.tool === 'delegate') ??
      (action?.tool === 'delegate' ? action : undefined);
    if (delegateAction) {
      const agentName = String(delegateAction.arguments.agent ?? '');
      const taskDesc = String(delegateAction.arguments.task ?? '');
      effects.push({ type: 'subagent:start', name: agentName, task: taskDesc });
    }

    // 2. Skill signal processing — sole call site of applySkillSignal
    if (isSkillSignal(result)) {
      const [newState, sigResult] = applySkillSignal(currentState, result as SkillSignal);
      currentState = newState;

      switch (sigResult.action) {
        case 'loaded': {
          // Skill loading event (for UI to show loading progress)
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
          // Delegate post-processing: subagent:end
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
          // Top-level skill return does not end directly; let LLM output results to user
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

    // 3. Plain tool result
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
