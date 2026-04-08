/**
 * @fileoverview User Story: AgentState 生命周期管理
 *
 * 作为开发者
 * 我希望能够创建、更新、保存和恢复 Agent 状态
 * 以便在调试时能够快照状态、时间旅行和持久化
 *
 * 验收标准：
 * 1. 可以创建带有配置的初始状态
 * 2. 可以通过不可变更新添加消息
 * 3. 可以序列化状态到 JSON 并反序列化恢复
 * 4. 可以创建快照并在之后恢复
 * 5. 原状态在更新后保持不变
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

describe('User Story: AgentState 生命周期管理', () => {
  // 用户故事 1: 创建 Agent 并添加对话历史
  describe('场景 1: 创建 Agent 并积累对话历史', () => {
    it('应该能够创建 Agent 并模拟多轮对话', () => {
      // Given: 一个计算器 Agent 配置
      const config: AgentConfig = {
        name: 'calculator',
        instructions: 'You are a math calculator.',
        tools: [{ name: 'calculate', description: 'Calculate math expression' }],
      };

      // When: 创建初始状态
      let state = createAgentState(config);

      // Then: 初始状态正确
      expect(state.config.name).toBe('calculator');
      expect(state.context.messages).toHaveLength(0);
      expect(state.context.stepCount).toBe(0);

      // When: 用户询问
      state = addUserMessage(state, 'What is 2 + 2?');

      // Then: 消息已添加
      expect(state.context.messages).toHaveLength(1);
      expect(state.context.messages[0].role).toBe('user');

      // When: Agent 思考（内部，对用户不可见）
      state = addAssistantMessage(state, 'I need to calculate this.', {
        type: 'thought',
        visible: false,
      });

      // Then: 思考消息标记为不可见
      expect(state.context.messages[1].type).toBe('thought');
      expect(state.context.messages[1].visible).toBe(false);

      // When: Agent 调用工具
      state = addAssistantMessage(state, 'Action: calculate({"expr": "2+2"})', {
        type: 'action',
        visible: false,
      });
      state = addToolMessage(state, '4');
      state = setLastToolResult(state, 4);

      // When: Agent 给出最终答案
      state = addAssistantMessage(state, 'The answer is 4.', {
        type: 'final',
        visible: true,
      });
      state = incrementStepCount(state);

      // Then: 完整的对话历史
      expect(state.context.messages).toHaveLength(5);
      expect(state.context.stepCount).toBe(1);
      expect(state.context.lastToolResult).toBe(4);
    });

    it('应该在更新后保持原状态不变（不可变性）', () => {
      // Given: 初始状态
      const config: AgentConfig = {
        name: 'test',
        instructions: 'Test agent',
        tools: [],
      };
      const original = createAgentState(config);
      const originalId = original.id;
      const originalMessageCount = original.context.messages.length;

      // When: 多次更新
      const state1 = addUserMessage(original, 'Message 1');
      const state2 = addUserMessage(state1, 'Message 2');
      const state3 = incrementStepCount(state2);

      // Then: 原状态完全不变
      expect(original.id).toBe(originalId);
      expect(original.context.messages).toHaveLength(originalMessageCount);
      expect(original.context.stepCount).toBe(0);

      // And: 每个新状态都不同
      expect(state1).not.toBe(original);
      expect(state2).not.toBe(state1);
      expect(state3).not.toBe(state2);

      // And: 新状态有正确的累积
      expect(state3.context.messages).toHaveLength(2);
      expect(state3.context.stepCount).toBe(1);
    });
  });

  // 用户故事 2: 持久化和恢复状态
  describe('场景 2: 持久化状态到文件并恢复', () => {
    it('应该能够序列化状态到 JSON 并完整恢复', () => {
      // Given: 一个有多轮对话的状态
      const config: AgentConfig = {
        name: 'persistent-agent',
        instructions: 'I persist across sessions.',
        tools: [{ name: 'search', description: 'Search the web' }],
      };
      let state = createAgentState(config);
      state = addUserMessage(state, 'Hello');
      state = addAssistantMessage(state, 'Hi there!', { type: 'final' });
      state = incrementStepCount(state);

      // When: 序列化到 JSON（模拟保存到文件）
      const json = serializeState(state);

      // Then: JSON 字符串有效
      expect(typeof json).toBe('string');
      expect(JSON.parse(json)).toBeTruthy();

      // When: 从 JSON 恢复（模拟从文件加载）
      const restored = deserializeState(json);

      // Then: 完全恢复所有数据
      expect(restored.id).toBe(state.id);
      expect(restored.config).toEqual(state.config);
      expect(restored.context.messages).toHaveLength(2);
      expect(restored.context.stepCount).toBe(1);

      // And: 恢复的状态可以继续使用
      const continued = addUserMessage(restored, 'New message after restore');
      expect(continued.context.messages).toHaveLength(3);
    });

    it('应该支持复杂数据类型的序列化', () => {
      // Given: 带有复杂工具结果的状态
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

      // When: 序列化和反序列化
      const json = serializeState(state);
      const restored = deserializeState(json);

      // Then: 复杂数据完整保留
      expect(restored.context.lastToolResult).toEqual(complexResult);
    });
  });

  // 用户故事 3: 快照和时间旅行
  describe('场景 3: 创建快照实现时间旅行', () => {
    it('应该能够在任意时刻创建快照并恢复', () => {
      // Given: 执行中的 Agent
      let state = createAgentState({
        name: 'time-traveler',
        instructions: 'I can go back in time.',
        tools: [],
      });

      // When: 执行几步后创建快照
      state = addUserMessage(state, 'Step 1');
      state = incrementStepCount(state);
      const snapshot1 = createSnapshot(state);

      // 继续执行
      state = addUserMessage(state, 'Step 2');
      state = addAssistantMessage(state, 'Response 2', { type: 'final' });
      state = incrementStepCount(state);
      const snapshot2 = createSnapshot(state);

      // 再继续
      state = addUserMessage(state, 'Step 3');
      const finalState = state;

      // Then: 快照记录了不同时间点的状态
      expect(snapshot1.state.context.stepCount).toBe(1);
      expect(snapshot2.state.context.stepCount).toBe(2);
      expect(finalState.context.stepCount).toBe(2); // 还没 increment

      // When: 从 snapshot1 恢复（时间旅行）
      const restoredFrom1 = restoreSnapshot(snapshot1);

      // Then: 恢复到之前的状态
      expect(restoredFrom1.context.stepCount).toBe(1);
      expect(restoredFrom1.context.messages).toHaveLength(1);

      // When: 从恢复的点继续执行不同分支
      const alternative = addUserMessage(restoredFrom1, 'Different path');

      // Then: 形成了不同的时间线
      expect(alternative.context.messages).toHaveLength(2);
      expect(alternative.context.messages[1].content).toBe('Different path');
    });

    it('应该检测快照数据损坏', () => {
      // Given: 有效快照
      let state = createAgentState({
        name: 'integrity-check',
        instructions: 'Check data integrity.',
        tools: [],
      });
      state = addUserMessage(state, 'Important data');
      const snapshot = createSnapshot(state);

      // When: 模拟数据损坏（修改后没有重新计算 checksum）
      snapshot.state.config.name = 'tampered';

      // Then: 恢复时应该抛出错误
      expect(() => restoreSnapshot(snapshot)).toThrow('checksum mismatch');
    });

    it('快照应该是深拷贝，与原状态隔离', () => {
      // Given: 创建快照
      let state = createAgentState({
        name: 'isolated',
        instructions: 'I am isolated.',
        tools: [],
      });
      const snapshot = createSnapshot(state);
      const originalName = state.config.name;

      // When: 修改原状态
      state = addUserMessage(state, 'New message');

      // Then: 快照中的状态不受影响
      expect(snapshot.state.config.name).toBe(originalName);
      expect(snapshot.state.context.messages).toHaveLength(0);
    });
  });

  // 用户故事 4: 调试场景 - 对比状态变化
  describe('场景 4: 调试时对比状态变化', () => {
    it('应该能够追踪状态变化历史', () => {
      // Given: 记录所有历史状态
      const history: ReturnType<typeof createSnapshot>[] = [];

      let state = createAgentState({
        name: 'debug-agent',
        instructions: 'Track my changes.',
        tools: [],
      });

      // When: 每步操作后记录快照
      history.push(createSnapshot(state));
      state = addUserMessage(state, 'Q1');
      history.push(createSnapshot(state));
      state = addAssistantMessage(state, 'A1', { type: 'final' });
      history.push(createSnapshot(state));
      state = incrementStepCount(state);
      history.push(createSnapshot(state));

      // Then: 可以回溯查看每一步的变化
      expect(history).toHaveLength(4);
      expect(history[0].state.context.messages).toHaveLength(0);
      expect(history[1].state.context.messages).toHaveLength(1);
      expect(history[2].state.context.messages).toHaveLength(2);
      expect(history[3].state.context.stepCount).toBe(1);

      // And: 可以对比任意两个时间点的差异
      const before = history[1].state;
      const after = history[3].state;
      expect(after.context.messages.length - before.context.messages.length).toBe(1);
    });
  });
});
