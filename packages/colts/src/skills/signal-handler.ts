/**
 * @fileoverview Centralized Skill Signal Handler
 *
 * Single entry point for all skillState mutations triggered by SkillSignal.
 * Ensures consistent guards (auto-create, same-skill, cyclic) and structured
 * results so the caller only decides which events to yield.
 */

import type { AgentState } from '../types.js';
import type { SkillSignal } from './types.js';
import { isSkillSignal } from './types.js';
import { updateState } from '../state.js';

/**
 * Result of processing a SkillSignal
 *
 * Each action maps to a specific state transition scenario:
 * - loaded:           first load or nested load (parentPushed distinguishes)
 * - returned:         sub-skill finished, returned to parent
 * - top-level-return: top-level skill finished (skillName for skill:end event)
 * - same-skill:       target skill is already active (ignore)
 * - cyclic:           target skill is already in the stack (prevent loops)
 * - not-found:        requested skill does not exist
 */
export type SkillSignalResult =
  | { action: 'loaded'; skillName: string; parentPushed: boolean }
  | { action: 'returned'; completedSkill: string; parentName: string }
  | { action: 'top-level-return'; skillName: string }
  | { action: 'same-skill'; currentSkill: string }
  | { action: 'cyclic'; currentSkill: string }
  | { action: 'not-found'; error: Error };

/**
 * Apply a SkillSignal to the agent state
 *
 * All skillState mutations must go through this function. It:
 * 1. Auto-creates skillState if missing
 * 2. Validates transitions (prevents self-reference and cycles)
 * 3. Executes state changes (push/pop stack, set current)
 * 4. Returns a structured result (caller decides which events to yield)
 *
 * @param state - Current AgentState
 * @param signal - SkillSignal to process
 * @returns Tuple of [new AgentState, SkillSignalResult]
 */
export function applySkillSignal(
  state: AgentState,
  signal: SkillSignal
): [AgentState, SkillSignalResult] {
  // SKILL_NOT_FOUND is a read-only signal — no state mutation needed
  if (signal.type === 'SKILL_NOT_FOUND') {
    return [
      state,
      {
        action: 'not-found',
        error: new Error(
          `Skill '${signal.requested}' not found. Available: ${signal.available.join(', ')}`
        ),
      },
    ];
  }

  if (signal.type === 'SWITCH_SKILL') {
    return applySwitchSkill(state, signal);
  }

  if (signal.type === 'RETURN_SKILL') {
    return applyReturnSkill(state, signal);
  }

  // Exhaustive check — should never reach here
  return [
    state,
    {
      action: 'not-found',
      error: new Error(`Unknown signal type: ${(signal as { type: string }).type}`),
    },
  ];
}

/**
 * Handle SWITCH_SKILL signal
 *
 * - Auto-creates skillState if missing
 * - Prevents self-reference (target === current)
 * - Prevents cyclic loading (target already in stack)
 * - First load: sets current without pushing parent
 * - Nested load: pushes current onto stack, then sets new current
 */
function applySwitchSkill(
  state: AgentState,
  signal: SkillSignal & { type: 'SWITCH_SKILL' }
): [AgentState, SkillSignalResult] {
  const targetName = signal.to;

  // Auto-create skillState if missing
  let currentState = state;
  if (!currentState.context.skillState) {
    currentState = updateState(currentState, (draft) => {
      draft.context.skillState = { stack: [], current: null };
    });
  }

  const skillState = currentState.context.skillState!;

  // Guard: same-skill — target is already the current skill
  if (skillState.current === targetName) {
    return [currentState, { action: 'same-skill', currentSkill: targetName }];
  }

  // Guard: cyclic — target is already in the stack
  if (skillState.stack.some((frame) => frame.skillName === targetName)) {
    return [currentState, { action: 'cyclic', currentSkill: targetName }];
  }

  // Determine whether to push current onto stack
  const hasCurrent = skillState.current !== null;

  const newState = updateState(currentState, (draft) => {
    const ss = draft.context.skillState!;
    if (hasCurrent) {
      // Nested load: push current onto stack with saved instructions
      ss.stack.push({
        skillName: ss.current!,
        loadedAt: Date.now(),
        savedInstructions: ss.loadedInstructions,
      });
    }
    ss.current = targetName;
    ss.loadedInstructions = signal.instructions;
  });

  return [newState, { action: 'loaded', skillName: targetName, parentPushed: hasCurrent }];
}

/**
 * Handle RETURN_SKILL signal
 *
 * - Empty stack + current skill: top-level return (step should end)
 * - Non-empty stack: pop parent, restore instructions, continue
 */
function applyReturnSkill(
  state: AgentState,
  _signal: SkillSignal & { type: 'RETURN_SKILL' }
): [AgentState, SkillSignalResult] {
  const skillState = state.context.skillState;

  // No skillState at all — treat as top-level return with no active skill
  if (!skillState || !skillState.current) {
    return [state, { action: 'top-level-return', skillName: skillState?.current ?? '' }];
  }

  // Empty stack: top-level skill is returning
  if (skillState.stack.length === 0) {
    // Clear current skill but keep skillState for potential future loads
    const newState = updateState(state, (draft) => {
      const ss = draft.context.skillState!;
      ss.current = null;
      ss.loadedInstructions = undefined;
    });
    return [newState, { action: 'top-level-return', skillName: skillState.current }];
  }

  // Non-empty stack: pop parent and restore
  const completedSkill = skillState.current;
  let parentSkillName: string;
  const newState = updateState(state, (draft) => {
    const ss = draft.context.skillState!;
    const parent = ss.stack.pop()!;
    parentSkillName = parent.skillName;
    ss.current = parentSkillName;
    ss.loadedInstructions = parent.savedInstructions;
  });

  return [newState, { action: 'returned', completedSkill, parentName: parentSkillName! }];
}

/**
 * Convert a SkillSignal to a CLI-friendly tool result string
 *
 * tool:end events should never carry internal protocol objects.
 *
 * @param result - Raw tool result (may or may not be a SkillSignal)
 * @returns Human-readable string representation
 */
export function formatSkillToolResult(result: unknown): string {
  if (!isSkillSignal(result)) {
    return typeof result === 'string' ? result : JSON.stringify(result);
  }
  const sig = result as SkillSignal;
  switch (sig.type) {
    case 'SWITCH_SKILL':
      return `Skill '${sig.to}' loaded`;
    case 'RETURN_SKILL':
      return typeof sig.result === 'string' ? sig.result : JSON.stringify(sig.result);
    case 'SKILL_NOT_FOUND':
      return `Skill '${sig.requested}' not found`;
  }
}

/**
 * Extract final answer text from a RETURN_SKILL signal
 *
 * Used when a top-level skill finishes via return_skill.
 *
 * @param result - Tool result expected to be a RETURN_SKILL signal
 * @returns Answer string for the StepResult
 */
export function formatSkillAnswer(result: unknown): string {
  const sig = result as { result?: unknown };
  return typeof sig.result === 'string' ? sig.result : JSON.stringify(sig.result);
}
