/**
 * @fileoverview Centralized Skill Signal Handler
 *
 * Single entry point for all skillState mutations triggered by SkillSignal.
 * Ensures consistent guards (auto-create, same-skill) and structured
 * results so the caller only decides which events to yield.
 *
 * Note: RETURN_SKILL handling was removed. Skill instructions now persist
 * as the load_skill tool result content in conversation history, so there
 * is no explicit return path.
 */

import type { AgentState } from '../types.js';
import type { SkillSignal } from './types.js';
import { isSkillSignal } from './types.js';
import { updateState } from '../state/index.js';

/**
 * Result of processing a SkillSignal
 *
 * Each action maps to a specific state transition scenario:
 * - loaded:     skill was activated (current updated)
 * - same-skill: target skill is already active (ignore)
 * - cyclic:     target skill is already the current (legacy alias of same-skill guard)
 * - not-found:  requested skill does not exist
 *
 * Note: `parentPushed` is always `false` now — the skill stack was removed.
 * It remains in the type for backward-compat with callers that read it.
 */
export type SkillSignalResult =
  | { action: 'loaded'; skillName: string; parentPushed: boolean }
  | { action: 'same-skill'; currentSkill: string }
  | { action: 'cyclic'; currentSkill: string }
  | { action: 'not-found'; error: Error };

/**
 * Apply a SkillSignal to the agent state
 *
 * All skillState mutations must go through this function. It:
 * 1. Auto-creates skillState if missing
 * 2. Validates transitions (prevents self-reference)
 * 3. Executes state changes (set current)
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
 * - Sets the new current skill
 *
 * Note: the skill stack was removed, so there is no parent-push and no
 * cyclic-across-stack guard. `parentPushed` is always `false`.
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
      draft.context.skillState = { current: null };
    });
  }

  const skillState = currentState.context.skillState!;

  // Guard: same-skill — target is already the current skill
  if (skillState.current === targetName) {
    return [currentState, { action: 'same-skill', currentSkill: targetName }];
  }

  const newState = updateState(currentState, (draft) => {
    draft.context.skillState!.current = targetName;
  });

  return [newState, { action: 'loaded', skillName: targetName, parentPushed: false }];
}

/**
 * Convert a SkillSignal to a tool result string
 *
 * For SWITCH_SKILL, the instructions become the tool result content so the
 * skill text persists in conversation history (the redesigned persistence
 * model). Non-string instructions are JSON-stringified.
 *
 * @param result - Raw tool result (may or may not be a SkillSignal)
 * @returns String representation suitable as a tool result
 */
export function formatSkillToolResult(result: unknown): string {
  if (!isSkillSignal(result)) {
    return typeof result === 'string' ? result : JSON.stringify(result);
  }
  const sig = result as SkillSignal;
  switch (sig.type) {
    case 'SWITCH_SKILL':
      // Instructions become the tool result content, persisting in history.
      return typeof sig.instructions === 'string'
        ? sig.instructions
        : JSON.stringify(sig.instructions);
    case 'SKILL_NOT_FOUND':
      return `Skill '${sig.requested}' not found`;
  }
}
