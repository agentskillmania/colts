/**
 * 会话持久化集成测试
 *
 * User Story: Session Persistence
 * 作为调试 agent 的开发者，我希望对话能在会话间持久化，
 * 以便下次能从上次中断的地方继续。
 *
 * 测试会话的保存、加载、列表、删除等完整生命周期。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { saveSession, loadSession, listSessions, deleteSession } from '../../src/session.js';
import { createAgentState, addUserMessage, serializeState } from '@agentskillmania/colts';
import type { AgentState } from '@agentskillmania/colts';

describe('会话持久化', () => {
  const testDir = path.join(os.tmpdir(), `colts-intg-session-${Date.now()}`);

  /** 创建一个带消息的测试用 AgentState */
  function createTestState(messageContents: string[] = []): AgentState {
    const config = {
      name: 'test-agent',
      instructions: 'You are a test assistant.',
      tools: [],
    };
    let state = createAgentState(config);
    for (const content of messageContents) {
      state = addUserMessage(state, content);
    }
    return state;
  }

  beforeEach(async () => {
    // 每个用例前创建隔离的临时目录
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // 清理测试目录
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  /**
   * 场景 1: saveSession 在会话目录中创建 JSON 文件
   */
  it('saveSession 在会话目录中创建 JSON 文件', async () => {
    const state = createTestState(['Hello']);
    await saveSession(state, testDir);

    // 验证 JSON 文件存在
    const filePath = path.join(testDir, `${state.id}.json`);
    const content = await fs.readFile(filePath, 'utf-8');

    // 验证是合法 JSON 且包含正确的 id
    const parsed = JSON.parse(content);
    expect(parsed.id).toBe(state.id);
  });

  /**
   * 场景 2: loadSession 读回相同状态（比较序列化形式）
   */
  it('loadSession 读回相同状态（序列化形式一致）', async () => {
    const state = createTestState(['第一条消息', '第二条消息', '第三条消息']);
    await saveSession(state, testDir);

    const loaded = await loadSession(state.id, testDir);

    // 比较序列化形式
    const originalJson = serializeState(state);
    const loadedJson = serializeState(loaded);
    expect(loadedJson).toBe(originalJson);

    // 基本字段验证
    expect(loaded.id).toBe(state.id);
    expect(loaded.context.messages).toHaveLength(3);
    expect(loaded.context.messages[0].content).toBe('第一条消息');
  });

  /**
   * 场景 3: listSessions 返回保存会话的元数据
   */
  it('listSessions 返回保存会话的元数据', async () => {
    const state = createTestState(['测试消息']);
    await saveSession(state, testDir);

    const sessions = await listSessions(testDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(state.id);
    expect(sessions[0].messageCount).toBe(1);
    expect(sessions[0].lastMessage).toBe('测试消息');
  });

  /**
   * 场景 4: listSessions 在无会话时返回空数组
   */
  it('listSessions 在无会话时返回空数组', async () => {
    // 空目录
    const emptyDir = path.join(testDir, 'empty');
    await fs.mkdir(emptyDir, { recursive: true });

    const sessions = await listSessions(emptyDir);
    expect(sessions).toEqual([]);
  });

  /**
   * 场景 5: listSessions 按 createdAt 降序排列
   */
  it('listSessions 按 createdAt 降序排列', async () => {
    // 创建三个会话，带不同的时间戳
    const now = Date.now();

    // 第一个会话：1000ms 前
    const state1 = createTestState(['old message']);
    // 手动修改时间戳以确保排序可测试
    const state1Modified: AgentState = {
      ...state1,
      context: {
        ...state1.context,
        messages: state1.context.messages.map((m) => ({
          ...m,
          timestamp: now - 2000,
        })),
      },
    };

    // 第二个会话：当前时间
    const state2 = createTestState(['newer message']);
    const state2Modified: AgentState = {
      ...state2,
      context: {
        ...state2.context,
        messages: state2.context.messages.map((m) => ({
          ...m,
          timestamp: now - 1000,
        })),
      },
    };

    // 第三个会话：最新
    const state3 = createTestState(['newest message']);
    const state3Modified: AgentState = {
      ...state3,
      context: {
        ...state3.context,
        messages: state3.context.messages.map((m) => ({
          ...m,
          timestamp: now,
        })),
      },
    };

    await saveSession(state1Modified, testDir);
    await saveSession(state2Modified, testDir);
    await saveSession(state3Modified, testDir);

    const sessions = await listSessions(testDir);
    expect(sessions).toHaveLength(3);

    // 最新的排在最前
    expect(sessions[0].id).toBe(state3Modified.id);
    expect(sessions[0].createdAt).toBe(now);
    expect(sessions[1].id).toBe(state2Modified.id);
    expect(sessions[1].createdAt).toBe(now - 1000);
    expect(sessions[2].id).toBe(state1Modified.id);
    expect(sessions[2].createdAt).toBe(now - 2000);
  });

  /**
   * 场景 6: deleteSession 删除文件
   */
  it('deleteSession 删除会话文件', async () => {
    const state = createTestState(['to be deleted']);
    await saveSession(state, testDir);

    // 确认文件存在
    const filePath = path.join(testDir, `${state.id}.json`);
    await fs.access(filePath);

    // 删除会话
    await deleteSession(state.id, testDir);

    // 确认文件已删除
    await expect(fs.access(filePath)).rejects.toThrow();

    // listSessions 不再返回该会话
    const sessions = await listSessions(testDir);
    expect(sessions).toHaveLength(0);
  });

  /**
   * 场景 7: deleteSession 忽略不存在的会话
   */
  it('deleteSession 忽略不存在的会话（不抛出错误）', async () => {
    // 应该静默通过，不抛出异常
    await expect(deleteSession('non-existent-session-id', testDir)).resolves.toBeUndefined();
  });

  /**
   * 场景 8: saveSession 在目录不存在时创建它
   */
  it('saveSession 在目录不存在时自动创建', async () => {
    // 使用嵌套的不存在的目录
    const nestedDir = path.join(testDir, 'nested', 'deep', 'sessions');

    // 确认目录不存在
    await expect(fs.access(nestedDir)).rejects.toThrow();

    const state = createTestState(['nested message']);
    await saveSession(state, nestedDir);

    // 验证目录被创建且文件存在
    const filePath = path.join(nestedDir, `${state.id}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.id).toBe(state.id);
  });

  /**
   * 场景 9: 多个会话，listSessions 返回所有
   */
  it('多个会话 listSessions 返回全部', async () => {
    const states: AgentState[] = [];
    for (let i = 0; i < 5; i++) {
      const state = createTestState([`会话 ${i + 1} 的消息`]);
      states.push(state);
      await saveSession(state, testDir);
    }

    const sessions = await listSessions(testDir);
    expect(sessions).toHaveLength(5);

    // 验证所有会话 ID 都在列表中
    const ids = sessions.map((s) => s.id);
    for (const state of states) {
      expect(ids).toContain(state.id);
    }
  });

  /**
   * 场景 10: 会话含大量消息，预览截断至 50 字符
   */
  it('会话含大量消息时预览截断至 50 字符', async () => {
    // 创建一条超过 50 字符的消息
    const longContent =
      '这是一条很长的消息，用于测试预览截断功能是否正常工作，超过五十个字符的部分应该被截断。';
    const state = createTestState(['short', longContent]);
    await saveSession(state, testDir);

    const sessions = await listSessions(testDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].messageCount).toBe(2);

    // lastMessage 是最后一条消息的截断预览，不超过 50 字符
    expect(sessions[0].lastMessage.length).toBeLessThanOrEqual(50);
    // 确认是截断后的内容
    expect(sessions[0].lastMessage).toBe(longContent.slice(0, 50));
  });
});
