/**
 * @fileoverview User Story: AgentState Lifecycle Management
 *
 * As a developer
 * I want to create, update, save, and restore Agent state
 * So that I can snapshot states, time travel, and persist data for debugging
 *
 * Acceptance Criteria:
 * 1. Can create initial state with configuration
 * 2. Can add messages through immutable updates
 * 3. Can serialize state to JSON and deserialize back
 * 4. Can create snapshots and restore later
 * 5. Original state remains unchanged after updates
 */

import { describe, it, expect } from 'vitest';
import {
  createAgentState,
  addUserMessage,
  addAssistantMessage,
  addToolMessage,
  incrementStepCount,
  setLastToolResult,
  serializeState,
  deserializeState,
  createSnapshot,
  restoreSnapshot,
} from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';

describe('User Story: AgentState Lifecycle Management', () => {
  // Scenario 1: Create Agent and accumulate conversation history
  describe('Scenario 1: Create Agent and Accumulate Conversation History', () => {
    it('should create Agent and simulate multi-turn conversation', () => {
      // Given: A calculator Agent configuration
      const config: AgentConfig = {
        name: 'calculator',
        instructions: 'You are a math calculator.',
        tools: [{ name: 'calculate', description: 'Calculate math expression' }],
      };

      // When: Create initial state
      let state = createAgentState(config);

      // Then: Initial state is correct
      expect(state.config.name).toBe('calculator');
      expect(state.context.messages).toHaveLength(0);
      expect(state.context.stepCount).toBe(0);

      // When: User asks a question
      state = addUserMessage(state, 'What is 2 + 2?');

      // Then: Message is added
      expect(state.context.messages).toHaveLength(1);
      expect(state.context.messages[0].role).toBe('user');

      // When: Agent thinks (internal, invisible to user)
      state = addAssistantMessage(state, 'I need to calculate this.', {
        type: 'thought',
        visible: false,
      });

      // Then: Thought message is marked invisible
      expect(state.context.messages[1].type).toBe('thought');
      expect(state.context.messages[1].visible).toBe(false);

      // When: Agent calls tool
      state = addAssistantMessage(state, 'Action: calculate({"expr": "2+2"})', {
        type: 'action',
        visible: false,
      });
      state = addToolMessage(state, '4');
      state = setLastToolResult(state, 4);

      // When: Agent gives final answer
      state = addAssistantMessage(state, 'The answer is 4.', {
        type: 'final',
        visible: true,
      });
      state = incrementStepCount(state);

      // Then: Complete conversation history
      expect(state.context.messages).toHaveLength(5);
      expect(state.context.stepCount).toBe(1);
      expect(state.context.lastToolResult).toBe(4);
    });

    it('should keep original state unchanged after updates (immutability)', () => {
      // Given: Initial state
      const config: AgentConfig = {
        name: 'test',
        instructions: 'Test agent',
        tools: [],
      };
      const original = createAgentState(config);
      const originalId = original.id;
      const originalMessageCount = original.context.messages.length;

      // When: Multiple updates
      const state1 = addUserMessage(original, 'Message 1');
      const state2 = addUserMessage(state1, 'Message 2');
      const state3 = incrementStepCount(state2);

      // Then: Original state completely unchanged
      expect(original.id).toBe(originalId);
      expect(original.context.messages).toHaveLength(originalMessageCount);
      expect(original.context.stepCount).toBe(0);

      // And: Each new state is different
      expect(state1).not.toBe(original);
      expect(state2).not.toBe(state1);
      expect(state3).not.toBe(state2);

      // And: New states have correct accumulation
      expect(state3.context.messages).toHaveLength(2);
      expect(state3.context.stepCount).toBe(1);
    });
  });

  // Scenario 2: Persist and restore state
  describe('Scenario 2: Persist State to File and Restore', () => {
    it('should serialize state to JSON and fully restore', () => {
      // Given: A state with multi-turn conversation
      const config: AgentConfig = {
        name: 'persistent-agent',
        instructions: 'I persist across sessions.',
        tools: [{ name: 'search', description: 'Search the web' }],
      };
      let state = createAgentState(config);
      state = addUserMessage(state, 'Hello');
      state = addAssistantMessage(state, 'Hi there!', { type: 'final' });
      state = incrementStepCount(state);

      // When: Serialize to JSON (simulate saving to file)
      const json = serializeState(state);

      // Then: JSON string is valid
      expect(typeof json).toBe('string');
      expect(JSON.parse(json)).toBeTruthy();

      // When: Restore from JSON (simulate loading from file)
      const restored = deserializeState(json);

      // Then: All data fully restored
      expect(restored.id).toBe(state.id);
      expect(restored.config).toEqual(state.config);
      expect(restored.context.messages).toHaveLength(2);
      expect(restored.context.stepCount).toBe(1);

      // And: Restored state can continue to be used
      const continued = addUserMessage(restored, 'New message after restore');
      expect(continued.context.messages).toHaveLength(3);
    });

    it('should support serialization of complex data types', () => {
      // Given: State with complex tool result
      let state = createAgentState({
        name: 'complex-agent',
        instructions: 'Handle complex data',
        tools: [],
      });

      const complexResult = {
        users: [
          { id: 1, name: 'Alice', tags: ['admin', 'active'] },
          { id: 2, name: 'Bob', tags: ['user'] },
        ],
        metadata: {
          count: 2,
          timestamp: Date.now(),
        },
      };

      state = setLastToolResult(state, complexResult);

      // When: Serialize and deserialize
      const json = serializeState(state);
      const restored = deserializeState(json);

      // Then: Complex data fully preserved
      expect(restored.context.lastToolResult).toEqual(complexResult);
    });
  });

  // Scenario 3: Snapshot and time travel
  describe('Scenario 3: Create Snapshots for Time Travel', () => {
    it('should create snapshot at any moment and restore', () => {
      // Given: Executing Agent
      let state = createAgentState({
        name: 'time-traveler',
        instructions: 'I can go back in time.',
        tools: [],
      });

      // When: Create snapshot after some steps
      state = addUserMessage(state, 'Step 1');
      state = incrementStepCount(state);
      const snapshot1 = createSnapshot(state);

      // Continue execution
      state = addUserMessage(state, 'Step 2');
      state = addAssistantMessage(state, 'Response 2', { type: 'final' });
      state = incrementStepCount(state);
      const snapshot2 = createSnapshot(state);

      // Continue further
      state = addUserMessage(state, 'Step 3');
      const finalState = state;

      // Then: Snapshots record states at different time points
      expect(snapshot1.state.context.stepCount).toBe(1);
      expect(snapshot2.state.context.stepCount).toBe(2);
      expect(finalState.context.stepCount).toBe(2); // Not incremented yet

      // When: Restore from snapshot1 (time travel)
      const restoredFrom1 = restoreSnapshot(snapshot1);

      // Then: Restored to previous state
      expect(restoredFrom1.context.stepCount).toBe(1);
      expect(restoredFrom1.context.messages).toHaveLength(1);

      // When: Continue from restored point with different branch
      const alternative = addUserMessage(restoredFrom1, 'Different path');

      // Then: Formed a different timeline
      expect(alternative.context.messages).toHaveLength(2);
      expect(alternative.context.messages[1].content).toBe('Different path');
    });

    it('should detect corrupted snapshot data', () => {
      // Given: Valid snapshot
      let state = createAgentState({
        name: 'integrity-check',
        instructions: 'Check data integrity.',
        tools: [],
      });
      state = addUserMessage(state, 'Important data');
      const snapshot = createSnapshot(state);

      // When: Simulate data corruption (modified without recalculating checksum)
      snapshot.state.config.name = 'tampered';

      // Then: Should throw error when restoring
      expect(() => restoreSnapshot(snapshot)).toThrow('checksum mismatch');
    });

    it('snapshot should be deep copy, isolated from original state', () => {
      // Given: Create snapshot
      let state = createAgentState({
        name: 'isolated',
        instructions: 'I am isolated.',
        tools: [],
      });
      const snapshot = createSnapshot(state);
      const originalName = state.config.name;

      // When: Modify original state
      state = addUserMessage(state, 'New message');

      // Then: State in snapshot unaffected
      expect(snapshot.state.config.name).toBe(originalName);
      expect(snapshot.state.context.messages).toHaveLength(0);
    });
  });

  // Scenario 4: Debugging - compare state changes
  describe('Scenario 4: Compare State Changes During Debugging', () => {
    it('should track history of state changes', () => {
      // Given: Record all historical states
      const history: ReturnType<typeof createSnapshot>[] = [];

      let state = createAgentState({
        name: 'debug-agent',
        instructions: 'Track my changes.',
        tools: [],
      });

      // When: Record snapshot after each operation
      history.push(createSnapshot(state));
      state = addUserMessage(state, 'Q1');
      history.push(createSnapshot(state));
      state = addAssistantMessage(state, 'A1', { type: 'final' });
      history.push(createSnapshot(state));
      state = incrementStepCount(state);
      history.push(createSnapshot(state));

      // Then: Can trace back and view changes at each step
      expect(history).toHaveLength(4);
      expect(history[0].state.context.messages).toHaveLength(0);
      expect(history[1].state.context.messages).toHaveLength(1);
      expect(history[2].state.context.messages).toHaveLength(2);
      expect(history[3].state.context.stepCount).toBe(1);

      // And: Can compare differences between any two time points
      const before = history[1].state;
      const after = history[3].state;
      expect(after.context.messages.length - before.context.messages.length).toBe(1);
    });
  });
});
