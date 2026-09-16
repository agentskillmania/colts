/**
 * @fileoverview HITL interrupt-list operations (terminal-state persistence)
 *
 * Pure state transforms for `context.pendingInterrupts` — the list of
 * unanswered human requests that survives across runs (aligned with Rust
 * a2d508d / ca8276f):
 *
 * - {@link retargetToolCallId} — anchor a suspended request to the LLM's
 *   action.id so the answered tool-result message pairs with the assistant
 *   row's toolCalls (id mismatch is rejected by OpenAI-compat endpoints
 *   with 400 "tool_call_ids did not have response messages").
 * - {@link upsertPendingInterrupt} — dedupe-by-toolCallId insert, used when
 *   a run suspends (waiting-human).
 * - {@link removePendingInterrupt} — consume an entry after the answer is
 *   injected; an emptied list clears to `undefined` (absent on the wire).
 */

import { produce } from 'immer';

import type { AgentState } from '../types.js';
import type { HumanRequest } from './types.js';

/**
 * Rewrite a suspended request's toolCallId to the real tool-call id (the
 * LLM-generated action.id).
 *
 * Host bridges constructing the request cannot know the action id and must
 * invent one (`human-<uuid>`, only fit as a frontend requestId), while the
 * responder's (`respond`) tool-result message must carry the LLM's
 * tool_call id. The executing-tool handler rewrites it here, uniformly,
 * before persisting.
 */
export function retargetToolCallId(request: HumanRequest, id: string): HumanRequest {
  // Both HumanRequest variants carry toolCallId — a single spread-override
  // rewrites it, whatever the variant (Rust spells this as a per-variant
  // match; TS's structural union needs no case analysis).
  return { ...request, toolCallId: id };
}

/**
 * Insert the request into `context.pendingInterrupts`, deduped by
 * toolCallId (idempotent — the run loop re-upserts resumed requests).
 */
export function upsertPendingInterrupt(state: AgentState, request: HumanRequest): AgentState {
  return produce(state, (draft) => {
    const list = draft.context.pendingInterrupts ?? [];
    if (!list.some((p) => p.request.toolCallId === request.toolCallId)) {
      list.push({ request, createdAt: Date.now() });
    }
    draft.context.pendingInterrupts = list;
    draft.context.updatedAt = Date.now();
  });
}

/**
 * Remove the entry for `requestId` (= the request's toolCallId) after the
 * answer is injected. No-op when the id is unknown or the list is absent;
 * an emptied list clears to `undefined`.
 */
export function removePendingInterrupt(state: AgentState, requestId: string): AgentState {
  return produce(state, (draft) => {
    const list = draft.context.pendingInterrupts;
    if (!list || !list.some((p) => p.request.toolCallId === requestId)) {
      return;
    }
    const filtered = list.filter((p) => p.request.toolCallId !== requestId);
    draft.context.pendingInterrupts = filtered.length > 0 ? filtered : undefined;
    draft.context.updatedAt = Date.now();
  });
}
