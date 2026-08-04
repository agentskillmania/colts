/**
 * @fileoverview Tool-Result Phase Handler
 *
 * Full logic for handling the tool-result phase, including:
 * - Skill signal processing (sole call site of applySkillSignal)
 * - Delegate tool detection
 * - Plain tool results
 *
 * Produces AdvanceResult with effects array; control flow is determined by phase + done:
 * - loaded → phase=idle, done=false (continue loop)
 * - same-skill/cyclic/plain → phase=tool-result, done=false
 * - not-found → phase=error, done=true
 */

import type { ExecutionState, AdvanceResult, ToolPostEffect } from '../../execution/index.js';
import { updateExecState } from '../../execution/index.js';
import { applySkillSignal, formatSkillToolResult } from '../../skills/signal-handler.js';
import { isSkillSignal, type SkillSignal } from '../../skills/types.js';
import type { AgentState } from '../../types.js';
import type { IPhaseHandler, PhaseHandlerContext } from '../types.js';

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
    let currentState = state;

    // 1. Skill signal processing — sole call site of applySkillSignal
    // Note: delegate start/end events are now emitted by the delegate tool itself
    // (via parentEmitter), not generated here as effects.
    if (isSkillSignal(result)) {
      const [newState, sigResult] = applySkillSignal(currentState, result as SkillSignal);
      currentState = newState;

      switch (sigResult.action) {
        case 'loaded': {
          // Skill loading event (for UI to show loading progress)
          effects.push({
            type: 'skill:loading',
            timestamp: Date.now(),
            name: sigResult.skillName,
          });
          const instructions =
            (result as SkillSignal & { instructions?: string }).instructions ?? '';
          const tokenCount = instructions.length > 0 ? Math.ceil(instructions.length / 4) : 0;
          effects.push({
            type: 'skill:loaded',
            timestamp: Date.now(),
            name: sigResult.skillName,
            tokenCount,
          });
          effects.push({
            type: 'skill:start',
            timestamp: Date.now(),
            name: sigResult.skillName,
            task: (result as SkillSignal & { task?: string }).task ?? '',
            state: currentState,
          });
          effects.push({
            type: 'tool:end',
            timestamp: Date.now(),
            result: formatSkillToolResult(result),
          });
          const nextExec = updateExecState(execState, (draft) => {
            draft.phase = { type: 'idle' };
          });
          return {
            state: currentState,
            execState: nextExec,
            phase: nextExec.phase,
            done: false,
            effects,
          };
        }

        case 'same-skill': {
          effects.push({
            type: 'tool:end',
            timestamp: Date.now(),
            result: `Skill '${sigResult.currentSkill}' is already active`,
          });
          return { state: currentState, execState, phase: execState.phase, done: false, effects };
        }

        case 'not-found': {
          effects.push({
            type: 'error',
            timestamp: Date.now(),
            error: sigResult.error,
            context: { step: 0 },
          });
          const nextExec = updateExecState(execState, (draft) => {
            draft.phase = { type: 'error', error: sigResult.error };
          });
          return {
            state: currentState,
            execState: nextExec,
            phase: nextExec.phase,
            done: true,
            effects,
          };
        }
      }
    }

    // 3. Plain tool result
    if (resultKeys.length <= 1) {
      effects.push({ type: 'tool:end', timestamp: Date.now(), result });
    } else {
      effects.push({ type: 'tools:end', timestamp: Date.now(), results });
    }

    return { state: currentState, execState, phase: execState.phase, done: false, effects };
  }
}
