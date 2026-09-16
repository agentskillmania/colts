/**
 * @fileoverview HITL respond() — transform state with human response
 *
 * Adds the appropriate messages/markers to AgentState so the next run()
 * can continue from where it left off.
 */

import { produce } from 'immer';

import type { AgentState } from '../types.js';
import type { HumanRequest, HumanResponse } from './types.js';
import { estimateTokens } from '../utils/tokens.js';

/**
 * Provide human response to a waiting-human request.
 *
 * For question responses: adds a tool-role message with the answers.
 * For tool-confirm approved: marks the tool call as approved (middleware lets it through next run).
 * For tool-confirm rejected: adds a tool-role message with rejection error.
 *
 * @param state - AgentState at the point of waiting-human
 * @param request - The original HumanRequest from the run result
 * @param response - The human's response
 * @returns New AgentState ready for the next run()
 * @throws Error when the response type does not match the request type
 */
export function respond(
  state: AgentState,
  request: HumanRequest,
  response: HumanResponse
): AgentState {
  if (response.type === 'question') {
    assertMatchingType(request, response);
    return respondToQuestion(state, request, response);
  }

  if (response.type === 'tool-confirm') {
    assertMatchingType(request, response);
    if (response.approved) {
      return approveTool(state, request);
    }
    return rejectTool(state, request);
  }

  // Unknown response type: tolerated no-op (nothing is consumed).
  return state;
}

/**
 * A response may only answer a request of the same kind.
 *
 * Both branches key their produced rows off `request.toolCallId`, so a
 * mismatched answer is attached to the wrong tool call. A tool-confirm
 * approval landing on a question request, for instance, would put the
 * ask_human call's id into hitlApprovals — run()'s resume guard treats
 * approved ids as accounted for, the call itself stays unanswered, and the
 * provider rejects the next request with 400. Fail loud instead.
 */
function assertMatchingType(
  request: HumanRequest,
  response: { type: HumanResponse['type'] }
): void {
  if (request.type !== response.type) {
    throw new Error(
      `HumanResponse type '${response.type}' cannot answer HumanRequest type '${request.type}': ` +
        `the response would be paired with tool call '${request.toolCallId}' as the wrong kind ` +
        `(provider 400 on resume).`
    );
  }
}

function respondToQuestion(
  state: AgentState,
  request: HumanRequest,
  response: Extract<HumanResponse, { type: 'question' }>
): AgentState {
  const toolCallId = request.toolCallId;
  const content = JSON.stringify(response.answers);

  return produce(state, (draft) => {
    draft.context.messages.push({
      id: globalThis.crypto.randomUUID(),
      role: 'tool',
      content,
      toolCallId,
      toolName: 'ask_human',
      type: 'tool-result',
      timestamp: Date.now(),
      tokenCount: estimateTokens(content),
    });
    draft.context.updatedAt = Date.now();
  });
}

function approveTool(state: AgentState, request: HumanRequest): AgentState {
  return produce(state, (draft) => {
    draft.context.hitlApprovals = [...(draft.context.hitlApprovals ?? []), request.toolCallId];
    draft.context.updatedAt = Date.now();
  });
}

function rejectTool(state: AgentState, request: HumanRequest): AgentState {
  const toolCallId = request.toolCallId;
  const toolName = request.type === 'tool-confirm' ? request.toolName : 'unknown';
  const content = `Tool execution rejected by human: ${toolName}`;

  return produce(state, (draft) => {
    draft.context.messages.push({
      id: globalThis.crypto.randomUUID(),
      role: 'tool',
      content,
      toolCallId,
      toolName,
      type: 'tool-result',
      isError: true, // ERR2: flag rejection so LLM can tell it apart from success
      timestamp: Date.now(),
      tokenCount: estimateTokens(content),
    });
    draft.context.updatedAt = Date.now();
  });
}
