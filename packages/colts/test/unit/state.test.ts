/**
 * @fileoverview Step 0: AgentState 单元测试
 *
 * 测试目标：
 * - 创建、更新、序列化、反序列化 AgentState
 * - 不可变性：原状态不被修改
 * - 覆盖率目标：90%
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createAgentState,
  updateState,
  addUserMessage,
  addAssistantMessage,
  addToolMessage,
  incrementStepCount,
  setLastToolResult,
  createSnapshot,
  restoreSnapshot,
  serializeState,
  deserializeState,
} from '../../src/state.js';
import type { AgentState, AgentConfig } from '../../src/types.js';

describe('Step 0: AgentState', () => {
  let baseConfig: AgentConfig;

  beforeEach(() => {
    baseConfig = {
      name: 'test-agent',
      instructions: 'You are a helpful assistant.',
      tools: [],
    };
  });

  describe('createAgentState', () => {
    it('should create initial state with correct structure', () => {
      const state = createAgentState(baseConfig);

      expect(state).toHaveProperty('id');
      expect(state).toHaveProperty('config', baseConfig);
      expect(state).toHaveProperty('context');
      expect(state.context.messages).toEqual([]);
      expect(state.context.stepCount).toBe(0);
      expect(state.context.lastToolResult).toBeUndefined();
    });

    it('should generate unique IDs for different states', () => {
      const state1 = createAgentState(baseConfig);
      const state2 = createAgentState(baseConfig);

      expect(state1.id).not.toBe(state2.id);
      expect(state1.id).toMatch(/^agent-\d+-/);
    });
  });

  describe('updateState (Immer)', () => {
    it('should return new state without modifying original', () => {
      const original = createAgentState(baseConfig);
      const modified = updateState(original, (draft) => {
        draft.context.stepCount = 5;
      });

      // Original unchanged
      expect(original.context.stepCount).toBe(0);
      // New state has changes
      expect(modified.context.stepCount).toBe(5);
      // Different references
      expect(original).not.toBe(modified);
    });

    it('should handle multiple updates correctly', () => {
      let state = createAgentState(baseConfig);

      state = updateState(state, (draft) => {
        draft.context.stepCount = 1;
      });
      state = updateState(state, (draft) => {
        draft.context.stepCount = 2;
      });

      expect(state.context.stepCount).toBe(2);
    });
  });

  describe('addUserMessage', () => {
    it('should add user message to empty state', () => {
      const state = createAgentState(baseConfig);
      const newState = addUserMessage(state, 'Hello');

      expect(newState.context.messages).toHaveLength(1);
      expect(newState.context.messages[0]).toMatchObject({
        role: 'user',
        content: 'Hello',
      });
      expect(newState.context.messages[0].timestamp).toBeDefined();
    });

    it('should preserve original state', () => {
      const state = createAgentState(baseConfig);
      const newState = addUserMessage(state, 'Hello');

      expect(state.context.messages).toHaveLength(0);
      expect(newState.context.messages).toHaveLength(1);
    });

    it('should append to existing messages', () => {
      let state = createAgentState(baseConfig);
      state = addUserMessage(state, 'First');
      state = addUserMessage(state, 'Second');

      expect(state.context.messages).toHaveLength(2);
      expect(state.context.messages[0].content).toBe('First');
      expect(state.context.messages[1].content).toBe('Second');
    });
  });

  describe('addAssistantMessage', () => {
    it('should add assistant message with defaults', () => {
      const state = createAgentState(baseConfig);
      const newState = addAssistantMessage(state, 'Hi there');

      expect(newState.context.messages[0]).toMatchObject({
        role: 'assistant',
        content: 'Hi there',
        type: 'text',
        visible: true,
      });
    });

    it('should support thought type (invisible)', () => {
      const state = createAgentState(baseConfig);
      const newState = addAssistantMessage(state, 'Let me think...', {
        type: 'thought',
        visible: false,
      });

      expect(newState.context.messages[0]).toMatchObject({
        type: 'thought',
        visible: false,
      });
    });

    it('should support final type (visible)', () => {
      const state = createAgentState(baseConfig);
      const newState = addAssistantMessage(state, 'Final answer', {
        type: 'final',
        visible: true,
      });

      expect(newState.context.messages[0]).toMatchObject({
        type: 'final',
        visible: true,
      });
    });
  });

  describe('addToolMessage', () => {
    it('should add tool result message', () => {
      const state = createAgentState(baseConfig);
      const newState = addToolMessage(state, '{"result": 42}');

      expect(newState.context.messages[0]).toMatchObject({
        role: 'tool',
        content: '{"result": 42}',
        type: 'tool-result',
      });
    });
  });

  describe('incrementStepCount', () => {
    it('should increment step count', () => {
      let state = createAgentState(baseConfig);
      state = incrementStepCount(state);

      expect(state.context.stepCount).toBe(1);

      state = incrementStepCount(state);
      expect(state.context.stepCount).toBe(2);
    });

    it('should not affect original state', () => {
      const state = createAgentState(baseConfig);
      const newState = incrementStepCount(state);

      expect(state.context.stepCount).toBe(0);
      expect(newState.context.stepCount).toBe(1);
    });
  });

  describe('setLastToolResult', () => {
    it('should set tool result', () => {
      const state = createAgentState(baseConfig);
      const result = { data: 'test', value: 123 };
      const newState = setLastToolResult(state, result);

      expect(newState.context.lastToolResult).toEqual(result);
    });

    it('should allow null/undefined results', () => {
      const state = createAgentState(baseConfig);
      const newState = setLastToolResult(state, null);

      expect(newState.context.lastToolResult).toBeNull();
    });
  });

  describe('Snapshot (create/restore)', () => {
    it('should create snapshot with correct structure', () => {
      const state = createAgentState(baseConfig);
      const snapshot = createSnapshot(state);

      expect(snapshot).toHaveProperty('version', '1.0.0');
      expect(snapshot).toHaveProperty('timestamp');
      expect(snapshot).toHaveProperty('state');
      expect(snapshot).toHaveProperty('checksum');
      expect(snapshot.state).toEqual(state);
    });

    it('should restore state from snapshot', () => {
      let state = createAgentState(baseConfig);
      state = addUserMessage(state, 'Test');

      const snapshot = createSnapshot(state);
      const restored = restoreSnapshot(snapshot);

      expect(restored).toEqual(state);
      expect(restored).not.toBe(state); // Different reference
    });

    it('should detect corrupted snapshot', () => {
      const state = createAgentState(baseConfig);
      const snapshot = createSnapshot(state);

      // Corrupt the snapshot
      snapshot.state.config.name = 'corrupted';

      expect(() => restoreSnapshot(snapshot)).toThrow('checksum mismatch');
    });

    it('should create isolated deep copy', () => {
      const state = createAgentState(baseConfig);
      const snapshot = createSnapshot(state);

      // Modify original after snapshot
      state.config.name = 'modified';

      expect(snapshot.state.config.name).toBe('test-agent');
    });
  });

  describe('Serialization (serialize/deserialize)', () => {
    it('should serialize to JSON string', () => {
      const state = createAgentState(baseConfig);
      const json = serializeState(state);

      expect(typeof json).toBe('string');
      expect(JSON.parse(json)).toEqual(state);
    });

    it('should deserialize from JSON string', () => {
      let state = createAgentState(baseConfig);
      state = addUserMessage(state, 'Hello');

      const json = serializeState(state);
      const restored = deserializeState(json);

      expect(restored).toEqual(state);
    });

    it('should handle complex nested data', () => {
      const state = createAgentState({
        name: 'complex-agent',
        instructions: 'Test',
        tools: [{ name: 'tool1', description: 'A tool' }],
      });

      const json = serializeState(state);
      const restored = deserializeState(json);

      expect(restored.config.tools[0].name).toBe('tool1');
    });
  });

  describe('Immutability guarantees', () => {
    it('should not allow direct mutation of state', () => {
      const state = createAgentState(baseConfig);

      // This should not compile in strict mode, but runtime test:
      const newState = addUserMessage(state, 'Test');

      // Original is untouched
      expect(state.context.messages).toHaveLength(0);
      expect(newState.context.messages).toHaveLength(1);
    });

    it('should preserve config reference if unchanged', () => {
      const state = createAgentState(baseConfig);
      const newState = addUserMessage(state, 'Test');

      // Config should be the same reference (Immer optimization)
      expect(newState.config).toBe(state.config);
    });

    it('should create new context when modified', () => {
      const state = createAgentState(baseConfig);
      const newState = addUserMessage(state, 'Test');

      // Context should be different reference
      expect(newState.context).not.toBe(state.context);
    });
  });
});
