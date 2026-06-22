/**
 * @fileoverview New ToolResultHandler unit tests
 *
 * Covers all scenarios migrated from processToolResult().
 * Handler produces AdvanceResult (with effects); control flow is determined by phase + done.
 */

import { describe, it, expect } from 'vitest';
import { ToolResultHandler } from '../../../src/execution-engine/handlers/tool-result-handler.js';
import type { PhaseHandlerContext } from '../../../src/execution-engine/types.js';
import type { AgentState } from '../../../src/types.js';
import type { ExecutionState } from '../../../src/execution/index.js';
import { createExecutionState } from '../../../src/execution/index.js';
import { createAgentState, updateState } from '../../../src/state/index.js';
import type { AgentConfig } from '../../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultConfig: AgentConfig = {
  name: 'test-agent',
  instructions: 'You are a test assistant.',
  tools: [],
};

/** Create minimal mock PhaseHandlerContext (handler does not directly use ctx) */
function createMockCtx(): PhaseHandlerContext {
  return {
    llmProvider: {} as any,
    toolRegistry: {} as any,
    messageAssembler: {} as any,
    toolSchemaFormatter: {} as any,
    executionPolicy: {} as any,
    options: { model: 'test-model' },
  };
}

/** Create ExecutionState for tool-result phase */
function createToolResultExecState(
  results: Record<string, unknown>,
  opts?: {
    action?: ExecutionState['action'];
    allActions?: ExecutionState['allActions'];
  }
): ExecutionState {
  const execState = createExecutionState();
  execState.phase = { type: 'tool-result', results };
  if (opts?.action) execState.action = opts.action;
  if (opts?.allActions) execState.allActions = opts.allActions;
  return execState;
}

const handler = new ToolResultHandler();

// ---------------------------------------------------------------------------
// Plain tool results
// ---------------------------------------------------------------------------

describe('ToolResultHandler — plain tool results', () => {
  it('should produce tool:end effect and keep phase=tool-result for single result', async () => {
    const state = createAgentState(defaultConfig);
    const execState = createToolResultExecState(
      { tc1: '42' },
      {
        action: { id: 'tc1', tool: 'calculator', arguments: { expr: '6*7' } },
      }
    );

    const result = await handler.execute(createMockCtx(), state, execState);

    expect(result.done).toBe(false);
    expect(result.phase.type).toBe('tool-result');
    expect(result.effects).toHaveLength(1);
    expect(result.effects![0]).toMatchObject({ type: 'tool:end', result: '42' });
  });

  it('should produce tools:end effect for multiple results', async () => {
    const state = createAgentState(defaultConfig);
    const multiResults = {
      'tc-1': 'Beijing: 25°C',
      'tc-2': 'Shanghai: 28°C',
    };
    const execState = createToolResultExecState(multiResults, {
      action: { id: 'tc-1', tool: 'weather', arguments: { city: 'Beijing' } },
    });

    const result = await handler.execute(createMockCtx(), state, execState);

    expect(result.done).toBe(false);
    expect(result.phase.type).toBe('tool-result');
    expect(result.effects).toHaveLength(1);
    expect(result.effects![0]).toMatchObject({ type: 'tools:end', results: multiResults });
  });
});

// ---------------------------------------------------------------------------
// SWITCH_SKILL
// ---------------------------------------------------------------------------

describe('ToolResultHandler — SWITCH_SKILL', () => {
  it('should produce skill:start + tool:end and phase=idle for first load', async () => {
    const state = createAgentState(defaultConfig);
    const switchSignal = {
      type: 'SWITCH_SKILL',
      to: 'research',
      instructions: 'Research thoroughly',
      task: 'Find sources about X',
    };
    const execState = createToolResultExecState(
      { tc1: switchSignal },
      {
        action: {
          id: 'tc1',
          tool: 'load_skill',
          arguments: { name: 'research', task: 'Find sources about X' },
        },
      }
    );

    const result = await handler.execute(createMockCtx(), state, execState);

    expect(result.done).toBe(false);
    expect(result.phase.type).toBe('idle');
    expect(result.effects!.map((e) => e.type)).toEqual([
      'skill:loading',
      'skill:loaded',
      'skill:start',
      'tool:end',
    ]);

    const skillStart = result.effects![2] as {
      type: 'skill:start';
      name: string;
      task: string;
      state: AgentState;
    };
    expect(skillStart.name).toBe('research');
    expect(skillStart.task).toBe('Find sources about X');
    expect(skillStart.state.context.skillState?.current).toBe('research');

    const toolEnd = result.effects![3] as { type: 'tool:end'; result: unknown };
    expect(toolEnd.result).toBe('Research thoroughly');

    // skill:loaded should include token count
    const skillLoaded = result.effects![1] as {
      type: 'skill:loaded';
      name: string;
      tokenCount: number;
    };
    expect(skillLoaded.name).toBe('research');
    expect(skillLoaded.tokenCount).toBeGreaterThan(0);

    // result.execState.phase should be reset to idle
    expect(result.execState.phase.type).toBe('idle');
  });

  it('should produce skill:start with current updated for a second load', async () => {
    let state = createAgentState(defaultConfig);
    state = updateState(state, (draft) => {
      draft.context.skillState = {
        current: 'writer',
      };
    });

    const switchSignal = {
      type: 'SWITCH_SKILL',
      to: 'editor',
      instructions: 'Edit carefully',
      task: 'Review the draft',
    };
    const execState = createToolResultExecState(
      { tc2: switchSignal },
      {
        action: {
          id: 'tc2',
          tool: 'load_skill',
          arguments: { name: 'editor', task: 'Review the draft' },
        },
      }
    );

    const result = await handler.execute(createMockCtx(), state, execState);

    expect(result.phase.type).toBe('idle');
    const skillStart = result.effects![2] as {
      type: 'skill:start';
      name: string;
      state: AgentState;
    };
    expect(skillStart.name).toBe('editor');
    // The skill stack was removed; loading a second skill just replaces current.
    expect(skillStart.state.context.skillState?.current).toBe('editor');
  });

  it('should produce tool:end + keep phase=tool-result for same-skill', async () => {
    let state = createAgentState(defaultConfig);
    state = updateState(state, (draft) => {
      draft.context.skillState = {
        current: 'research',
      };
    });

    const switchSignal = {
      type: 'SWITCH_SKILL',
      to: 'research', // same as current
      instructions: 'Research thoroughly',
      task: 'Do it again',
    };
    const execState = createToolResultExecState(
      { tc3: switchSignal },
      {
        action: {
          id: 'tc3',
          tool: 'load_skill',
          arguments: { name: 'research', task: 'Do it again' },
        },
      }
    );

    const result = await handler.execute(createMockCtx(), state, execState);

    expect(result.done).toBe(false);
    expect(result.phase.type).toBe('tool-result');
    expect(result.effects!.map((e) => e.type)).toEqual(['tool:end']);

    const toolEnd = result.effects![0] as { type: 'tool:end'; result: unknown };
    expect(toolEnd.result).toBe("Skill 'research' is already active");
  });

  // Note: the cyclic-load case was removed together with the skill stack.
  // With only `current`, there is no call-stack to detect cycles against.
});

// ---------------------------------------------------------------------------
// SKILL_NOT_FOUND
// ---------------------------------------------------------------------------

describe('ToolResultHandler — SKILL_NOT_FOUND', () => {
  it('should produce error effect + phase=error + done=true', async () => {
    const state = createAgentState(defaultConfig);
    const notFoundSignal = {
      type: 'SKILL_NOT_FOUND',
      requested: 'nonexistent',
      available: ['research', 'writer'],
    };
    const execState = createToolResultExecState(
      { tc7: notFoundSignal },
      {
        action: {
          id: 'tc7',
          tool: 'load_skill',
          arguments: { name: 'nonexistent' },
        },
      }
    );

    const result = await handler.execute(createMockCtx(), state, execState);

    expect(result.done).toBe(true);
    expect(result.phase.type).toBe('error');
    expect(result.effects!.map((e) => e.type)).toEqual(['error']);

    const errorEffect = result.effects![0] as {
      type: 'error';
      error: Error;
      context: { step: number };
    };
    expect(errorEffect.error.message).toContain("Skill 'nonexistent' not found");
  });
});

// ---------------------------------------------------------------------------
// Delegate tools
// ---------------------------------------------------------------------------

describe('ToolResultHandler — delegate tools', () => {
  it('should produce subagent:start/end + tool:end for delegate + plain result', async () => {
    const state = createAgentState(defaultConfig);
    const execState = createToolResultExecState(
      { tc8: 'delegated task completed' },
      {
        action: {
          id: 'tc8',
          tool: 'delegate',
          arguments: { agent: 'sub-agent', task: 'do something' },
        },
      }
    );

    const result = await handler.execute(createMockCtx(), state, execState);

    expect(result.phase.type).toBe('tool-result');
    expect(result.effects!.map((e) => e.type)).toEqual([
      'subagent:start',
      'tool:end',
      'subagent:end',
    ]);

    const subStart = result.effects![0] as {
      type: 'subagent:start';
      name: string;
      task: string;
    };
    expect(subStart.name).toBe('sub-agent');
    expect(subStart.task).toBe('do something');

    const subEnd = result.effects![2] as {
      type: 'subagent:end';
      name: string;
      result: unknown;
    };
    expect(subEnd.name).toBe('sub-agent');
    expect(subEnd.result).toBe('delegated task completed');
  });

  it('should produce subagent:start + skill:start + tool:end + subagent:end for delegate + SWITCH_SKILL', async () => {
    const state = createAgentState(defaultConfig);
    const switchSignal = {
      type: 'SWITCH_SKILL',
      to: 'research',
      instructions: 'Research thoroughly',
      task: 'Find sources',
    };
    const execState = createToolResultExecState(
      { tc9: switchSignal },
      {
        action: {
          id: 'tc9',
          tool: 'delegate',
          arguments: { agent: 'research-agent', task: 'Find sources' },
        },
      }
    );

    const result = await handler.execute(createMockCtx(), state, execState);

    expect(result.effects!.map((e) => e.type)).toEqual([
      'subagent:start',
      'skill:loading',
      'skill:loaded',
      'skill:start',
      'tool:end',
      'subagent:end',
    ]);

    const subStart = result.effects![0] as { type: 'subagent:start'; name: string };
    expect(subStart.name).toBe('research-agent');

    const skillStart = result.effects![3] as { type: 'skill:start'; name: string };
    expect(skillStart.name).toBe('research');

    const subEnd = result.effects![5] as { type: 'subagent:end'; name: string };
    expect(subEnd.name).toBe('research-agent');
  });

  it('should produce subagent:start/end for delegate + same-skill', async () => {
    let state = createAgentState(defaultConfig);
    state = updateState(state, (draft) => {
      draft.context.skillState = {
        current: 'research',
      };
    });

    const switchSignal = {
      type: 'SWITCH_SKILL',
      to: 'research', // same as current
      instructions: 'Research thoroughly',
      task: 'Do it again',
    };
    const execState = createToolResultExecState(
      { tc10: switchSignal },
      {
        action: {
          id: 'tc10',
          tool: 'delegate',
          arguments: { agent: 'sub-agent', task: 'Do it again' },
        },
      }
    );

    const result = await handler.execute(createMockCtx(), state, execState);

    expect(result.phase.type).toBe('tool-result');
    expect(result.effects!.map((e) => e.type)).toEqual([
      'subagent:start',
      'tool:end',
      'subagent:end',
    ]);
  });

  // Note: the delegate + cyclic-load and delegate + RETURN_SKILL cases were
  // removed together with the skill stack and the RETURN_SKILL signal.

  it('should produce subagent:start/end for delegate + SKILL_NOT_FOUND', async () => {
    const state = createAgentState(defaultConfig);
    const notFoundSignal = {
      type: 'SKILL_NOT_FOUND',
      requested: 'nonexistent',
      available: ['research', 'writer'],
    };
    const execState = createToolResultExecState(
      { tc12: notFoundSignal },
      {
        action: {
          id: 'tc12',
          tool: 'delegate',
          arguments: { agent: 'bad-agent', task: 'Load nonexistent skill' },
        },
      }
    );

    const result = await handler.execute(createMockCtx(), state, execState);

    expect(result.done).toBe(true);
    expect(result.phase.type).toBe('error');
    expect(result.effects!.map((e) => e.type)).toEqual(['subagent:start', 'error', 'subagent:end']);
  });

  it('should detect delegate tool in allActions when action points elsewhere', async () => {
    const state = createAgentState(defaultConfig);
    const execState = createToolResultExecState(
      { 'tc-1': '42', 'tc-2': 'delegated' },
      {
        action: { id: 'tc-1', tool: 'calculator', arguments: { expr: '6*7' } },
        allActions: [
          { id: 'tc-1', tool: 'calculator', arguments: { expr: '6*7' } },
          {
            id: 'tc-2',
            tool: 'delegate',
            arguments: { agent: 'sub-expert', task: 'analyze data' },
          },
        ],
      }
    );

    const result = await handler.execute(createMockCtx(), state, execState);

    const types = result.effects!.map((e) => e.type);
    expect(types).toContain('subagent:start');
    expect(types).toContain('subagent:end');

    const subStart = result.effects!.find((e) => e.type === 'subagent:start') as {
      type: 'subagent:start';
      name: string;
      task: string;
    };
    expect(subStart.name).toBe('sub-expert');
    expect(subStart.task).toBe('analyze data');
  });
});

// ---------------------------------------------------------------------------
// canHandle
// ---------------------------------------------------------------------------

describe('ToolResultHandler — canHandle', () => {
  it('should handle tool-result phase', () => {
    expect(handler.canHandle('tool-result')).toBe(true);
  });

  it('should not handle other phases', () => {
    expect(handler.canHandle('idle')).toBe(false);
    expect(handler.canHandle('completed')).toBe(false);
    expect(handler.canHandle('executing-tool')).toBe(false);
  });
});
