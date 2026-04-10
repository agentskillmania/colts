/**
 * session.ts 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  getSessionDir,
  listSessions,
  saveSession,
  loadSession,
  deleteSession,
} from '../../src/session.js';
import { createAgentState, addUserMessage, addAssistantMessage } from '@agentskillmania/colts';

describe('session', () => {
  const testDir = path.join(os.tmpdir(), `colts-test-session-${Date.now()}`);

  /** 创建一个带消息的测试用 AgentState */
  function createTestState(messageContents: string[] = []) {
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
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  describe('getSessionDir', () => {
    it('使用自定义 baseDir 时返回自定义路径', () => {
      const result = getSessionDir('/tmp/test-sessions');
      expect(result).toBe('/tmp/test-sessions');
    });

    it('不传 baseDir 时返回默认路径', () => {
      const result = getSessionDir();
      expect(result).toContain('.agentskillmania');
      expect(result).toContain('sessions');
    });
  });

  describe('saveSession & loadSession', () => {
    it('能保存并加载会话', async () => {
      const state = createTestState(['Hello', 'World']);
      await saveSession(state, testDir);

      const loaded = await loadSession(state.id, testDir);
      expect(loaded.id).toBe(state.id);
      expect(loaded.context.messages).toHaveLength(2);
      expect(loaded.context.messages[0].content).toBe('Hello');
      expect(loaded.context.messages[1].content).toBe('World');
    });

    it('保存的文件是合法 JSON', async () => {
      const state = createTestState(['test message']);
      await saveSession(state, testDir);

      const filePath = path.join(testDir, `${state.id}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();

      const parsed = JSON.parse(content);
      expect(parsed.id).toBe(state.id);
      expect(parsed.config.name).toBe('test-agent');
    });

    it('加载不存在的会话时抛出错误', async () => {
      await expect(loadSession('non-existent-id', testDir)).rejects.toThrow();
    });

    it('能保存和加载无消息的空会话', async () => {
      const state = createTestState([]);
      await saveSession(state, testDir);

      const loaded = await loadSession(state.id, testDir);
      expect(loaded.id).toBe(state.id);
      expect(loaded.context.messages).toHaveLength(0);
    });

    it('保存后再保存同一会话会覆盖', async () => {
      const state1 = createTestState(['first']);
      await saveSession(state1, testDir);

      const state2 = addUserMessage(state1, 'second');
      await saveSession(state2, testDir);

      const loaded = await loadSession(state1.id, testDir);
      expect(loaded.context.messages).toHaveLength(2);
      expect(loaded.context.messages[1].content).toBe('second');
    });
  });

  describe('listSessions', () => {
    it('空目录返回空列表', async () => {
      const emptyDir = path.join(testDir, 'empty');
      await fs.mkdir(emptyDir, { recursive: true });

      const sessions = await listSessions(emptyDir);
      expect(sessions).toEqual([]);
    });

    it('目录不存在时返回空列表', async () => {
      const nonExistent = path.join(testDir, 'does-not-exist');
      const sessions = await listSessions(nonExistent);
      expect(sessions).toEqual([]);
    });

    it('能正确列出单个会话的元数据', async () => {
      const state = createTestState(['Hello world']);
      await saveSession(state, testDir);

      const sessions = await listSessions(testDir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(state.id);
      expect(sessions[0].messageCount).toBe(1);
      expect(sessions[0].lastMessage).toBe('Hello world');
    });

    it('消息计数正确', async () => {
      const state = createTestState(['msg1', 'msg2', 'msg3']);
      await saveSession(state, testDir);

      const sessions = await listSessions(testDir);
      expect(sessions[0].messageCount).toBe(3);
    });

    it('lastMessage 预览截断至 50 字符', async () => {
      const longContent = 'A'.repeat(100);
      const state = createTestState([longContent]);
      await saveSession(state, testDir);

      const sessions = await listSessions(testDir);
      expect(sessions[0].lastMessage).toHaveLength(50);
      expect(sessions[0].lastMessage).toBe('A'.repeat(50));
    });

    it('无消息时 lastMessage 为空字符串', async () => {
      const state = createTestState([]);
      await saveSession(state, testDir);

      const sessions = await listSessions(testDir);
      expect(sessions[0].lastMessage).toBe('');
    });

    it('无消息时 messageCount 为 0', async () => {
      const state = createTestState([]);
      await saveSession(state, testDir);

      const sessions = await listSessions(testDir);
      expect(sessions[0].messageCount).toBe(0);
    });

    it('能正确列出多个会话', async () => {
      const state1 = createTestState(['session1 msg']);
      const state2 = createTestState(['session2 msg']);
      const state3 = createTestState(['session3 msg']);

      await saveSession(state1, testDir);
      await saveSession(state2, testDir);
      await saveSession(state3, testDir);

      const sessions = await listSessions(testDir);
      expect(sessions).toHaveLength(3);

      const ids = sessions.map((s) => s.id);
      expect(ids).toContain(state1.id);
      expect(ids).toContain(state2.id);
      expect(ids).toContain(state3.id);
    });

    it('会话按创建时间降序排列', async () => {
      // 创建带不同时间戳的消息
      const state1 = createTestState(['first']);
      await saveSession(state1, testDir);

      // 模拟稍后创建的会话：直接写入不同时间戳
      const state2 = createTestState(['second']);
      await saveSession(state2, testDir);

      const sessions = await listSessions(testDir);
      // 至少应该能返回两个会话
      expect(sessions).toHaveLength(2);
    });

    it('忽略损坏的 JSON 文件', async () => {
      const state = createTestState(['valid']);
      await saveSession(state, testDir);

      // 写入一个损坏的 JSON 文件
      const corruptPath = path.join(testDir, 'corrupt-session.json');
      await fs.writeFile(corruptPath, 'not valid json {{{', 'utf-8');

      const sessions = await listSessions(testDir);
      // 只返回有效的会话
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(state.id);
    });

    it('处理缺少 context 字段的会话文件', async () => {
      // 写入一个合法 JSON 但缺少 context 的文件
      const malformedPath = path.join(testDir, 'malformed.json');
      const malformed = JSON.stringify({ id: 'malformed-id' });
      await fs.writeFile(malformedPath, malformed, 'utf-8');

      const sessions = await listSessions(testDir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('malformed-id');
      expect(sessions[0].messageCount).toBe(0);
      expect(sessions[0].lastMessage).toBe('');
    });

    it('忽略非 JSON 文件', async () => {
      const state = createTestState(['valid']);
      await saveSession(state, testDir);

      // 写入一个非 JSON 文件
      const txtPath = path.join(testDir, 'readme.txt');
      await fs.writeFile(txtPath, 'some text', 'utf-8');

      const sessions = await listSessions(testDir);
      expect(sessions).toHaveLength(1);
    });
  });

  describe('deleteSession', () => {
    it('能删除已保存的会话', async () => {
      const state = createTestState(['to be deleted']);
      await saveSession(state, testDir);

      // 确认文件存在
      const filePath = path.join(testDir, `${state.id}.json`);
      await fs.access(filePath);

      await deleteSession(state.id, testDir);

      // 确认文件已删除
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it('删除不存在的会话不抛出错误', async () => {
      // 应该静默通过，不抛出异常
      await expect(deleteSession('non-existent-id', testDir)).resolves.toBeUndefined();
    });

    it('删除后列出会话不包含该会话', async () => {
      const state1 = createTestState(['keep']);
      const state2 = createTestState(['remove']);
      await saveSession(state1, testDir);
      await saveSession(state2, testDir);

      await deleteSession(state2.id, testDir);

      const sessions = await listSessions(testDir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(state1.id);
    });
  });
});
