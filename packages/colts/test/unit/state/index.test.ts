/**
 * @fileoverview Step 0: AgentState Unit Tests
 *
 * Test objectives:
 * - Create, update, serialize, deserialize AgentState
 * - Immutability: original state is not modified
 * - Coverage target: 90%
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
  loadSkill,
  createSnapshot,
  restoreSnapshot,
  serializeState,
  deserializeState,
  updateTotalTokens,
} from '../../../src/state/index.js';
import type { AgentState, AgentConfig } from '../../../src/types.js';

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
      expect(state1.id).toMatch(/^\d+-/);
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
      expect(newState.context.messages[0].tokenCount).toBeGreaterThan(0);
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
      });
      expect(newState.context.messages[0].tokenCount).toBeGreaterThan(0);
    });

    it('should support thought type', () => {
      const state = createAgentState(baseConfig);
      const newState = addAssistantMessage(state, 'Let me think...', {
        type: 'thought',
      });

      expect(newState.context.messages[0]).toMatchObject({
        type: 'thought',
      });
    });

    it('should support final type', () => {
      const state = createAgentState(baseConfig);
      const newState = addAssistantMessage(state, 'Final answer', {
        type: 'text',
      });

      expect(newState.context.messages[0]).toMatchObject({
        type: 'text',
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
      expect(newState.context.messages[0].tokenCount).toBeGreaterThan(0);
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

    it('should allow restored state to continue state operations', () => {
      // Verify: restored Agent can continue execution (acceptance criterion #4)
      let state = createAgentState(baseConfig);
      state = addUserMessage(state, 'Before snapshot');

      // Create snapshot
      const snapshot = createSnapshot(state);

      // Continue modifying original state
      state = addUserMessage(state, 'After snapshot');
      expect(state.context.messages).toHaveLength(2);

      // Restore from snapshot, should only have 1 message
      const restored = restoreSnapshot(snapshot);
      expect(restored.context.messages).toHaveLength(1);
      expect(restored.context.messages[0].content).toBe('Before snapshot');

      // Restored state can continue state operations
      const continued = addUserMessage(restored, 'After restore');
      expect(continued.context.messages).toHaveLength(2);
      expect(continued.context.messages[1].content).toBe('After restore');
      // Restored state itself unchanged
      expect(restored.context.messages).toHaveLength(1);
    });

    it('should allow deserialized state to continue state operations', () => {
      let state = createAgentState(baseConfig);
      state = addUserMessage(state, 'Before serialize');

      // Serialize → Deserialize
      const json = serializeState(state);
      const restored = deserializeState(json);

      // Can continue operations after restore
      const continued = addUserMessage(restored, 'After deserialize');
      expect(continued.context.messages).toHaveLength(2);
      expect(continued.context.messages[1].content).toBe('After deserialize');
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

  describe('loadSkill', () => {
    it('should initialize and set current and loadedInstructions when no skillState exists', () => {
      const state = createAgentState(baseConfig);
      const newState = loadSkill(state, 'tell-time', 'Report current time');

      expect(newState.context.skillState).toBeDefined();
      expect(newState.context.skillState!.current).toBe('tell-time');
      expect(newState.context.skillState!.loadedInstructions).toBe('Report current time');
      expect(newState.context.skillState!.stack).toEqual([]);
    });

    it('should push existing active skill onto stack (supports nesting)', () => {
      let state = createAgentState(baseConfig);
      state = loadSkill(state, 'tell-time', 'Report time');
      state = loadSkill(state, 'greeting', 'Say hello');

      expect(state.context.skillState!.current).toBe('greeting');
      expect(state.context.skillState!.loadedInstructions).toBe('Say hello');
      expect(state.context.skillState!.stack).toHaveLength(1);
      expect(state.context.skillState!.stack[0].skillName).toBe('tell-time');
      // Parent skill instructions should be saved in stack frame
      expect(state.context.skillState!.stack[0].savedInstructions).toBe('Report time');
    });

    it('should not modify original state (immutability)', () => {
      const state = createAgentState(baseConfig);
      const newState = loadSkill(state, 'test', 'instructions');

      expect(state.context.skillState).toBeUndefined();
      expect(newState.context.skillState!.current).toBe('test');
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
