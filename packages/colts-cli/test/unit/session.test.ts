/**
 * session.ts 单元测试
 *
 * 覆盖 v1 格式（version/meta/state 包装）和旧格式（裸 AgentState）的向后兼容。
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
import { createAgentState, addUserMessage } from '@agentskillmania/colts';

describe('session', () => {
  const testDir = path.join(os.tmpdir(), `colts-test-session-${Date.now()}`);

  /** Create a test AgentState with messages */
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
      // Ignore cleanup errors
    }
  });

  describe('getSessionDir', () => {
    it('should return custom path when custom baseDir is provided', () => {
      const result = getSessionDir('/tmp/test-sessions');
      expect(result).toBe('/tmp/test-sessions');
    });

    it('should return default path when baseDir is not provided', () => {
      const result = getSessionDir();
      expect(result).toContain('.agentskillmania');
      expect(result).toContain('sessions');
    });
  });

  describe('saveSession', () => {
    it('should write v1 format with version, meta, state keys', async () => {
      const state = createTestState(['Hello world']);
      await saveSession(state, testDir);

      const filePath = path.join(testDir, `${state.id}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed).toHaveProperty('version', 1);
      expect(parsed).toHaveProperty('meta');
      expect(parsed).toHaveProperty('state');
    });

    it('should extract correct meta fields', async () => {
      const state = createTestState(['msg1', 'msg2', 'msg3']);
      await saveSession(state, testDir);

      const filePath = path.join(testDir, `${state.id}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.meta.id).toBe(state.id);
      expect(parsed.meta.messageCount).toBe(3);
      expect(parsed.meta.lastMessage).toBe('msg3');
      expect(parsed.meta.createdAt).toBeTypeOf('number');
      expect(parsed.meta.updatedAt).toBeTypeOf('number');
    });

    it('should truncate lastMessage to 50 characters in meta', async () => {
      const longContent = 'A'.repeat(100);
      const state = createTestState([longContent]);
      await saveSession(state, testDir);

      const filePath = path.join(testDir, `${state.id}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.meta.lastMessage).toHaveLength(50);
      expect(parsed.meta.lastMessage).toBe('A'.repeat(50));
    });

    it('should store empty string for lastMessage when no messages', async () => {
      const state = createTestState([]);
      await saveSession(state, testDir);

      const filePath = path.join(testDir, `${state.id}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.meta.lastMessage).toBe('');
      expect(parsed.meta.messageCount).toBe(0);
    });

    it('should update updatedAt on re-save', async () => {
      const state = createTestState(['first']);
      await saveSession(state, testDir);

      // Read first save's updatedAt
      const filePath = path.join(testDir, `${state.id}.json`);
      const first = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      const firstUpdatedAt = first.meta.updatedAt;

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const state2 = addUserMessage(state, 'second');
      await saveSession(state2, testDir);

      const second = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(second.meta.updatedAt).toBeGreaterThanOrEqual(firstUpdatedAt);
      expect(second.meta.messageCount).toBe(2);
    });

    it('should overwrite when saving the same session again', async () => {
      const state1 = createTestState(['first']);
      await saveSession(state1, testDir);

      const state2 = addUserMessage(state1, 'second');
      await saveSession(state2, testDir);

      const loaded = await loadSession(state1.id, testDir);
      expect(loaded.context.messages).toHaveLength(2);
      expect(loaded.context.messages[1].content).toBe('second');
    });
  });

  describe('loadSession', () => {
    it('should load state from v1 format', async () => {
      const state = createTestState(['Hello', 'World']);
      await saveSession(state, testDir);

      const loaded = await loadSession(state.id, testDir);
      expect(loaded.id).toBe(state.id);
      expect(loaded.context.messages).toHaveLength(2);
      expect(loaded.context.messages[0].content).toBe('Hello');
      expect(loaded.context.messages[1].content).toBe('World');
    });

    it('should throw when loading a non-existent session', async () => {
      await expect(loadSession('non-existent-id', testDir)).rejects.toThrow();
    });

    it('should load empty session with no messages', async () => {
      const state = createTestState([]);
      await saveSession(state, testDir);

      const loaded = await loadSession(state.id, testDir);
      expect(loaded.id).toBe(state.id);
      expect(loaded.context.messages).toHaveLength(0);
    });

    it('should load old format (bare AgentState) for backward compatibility', async () => {
      // Write old format: bare AgentState JSON without version/meta wrapper
      const state = createTestState(['legacy msg']);
      const legacyJson = JSON.stringify(state);
      const filePath = path.join(testDir, `${state.id}.json`);
      await fs.writeFile(filePath, legacyJson, 'utf-8');

      const loaded = await loadSession(state.id, testDir);
      expect(loaded.id).toBe(state.id);
      expect(loaded.context.messages).toHaveLength(1);
      expect(loaded.context.messages[0].content).toBe('legacy msg');
    });
  });

  describe('listSessions', () => {
    it('should return empty list for empty directory', async () => {
      const emptyDir = path.join(testDir, 'empty');
      await fs.mkdir(emptyDir, { recursive: true });

      const sessions = await listSessions(emptyDir);
      expect(sessions).toEqual([]);
    });

    it('should return empty list when directory does not exist', async () => {
      const nonExistent = path.join(testDir, 'does-not-exist');
      const sessions = await listSessions(nonExistent);
      expect(sessions).toEqual([]);
    });

    it('should correctly list metadata from v1 format', async () => {
      const state = createTestState(['Hello world']);
      await saveSession(state, testDir);

      const sessions = await listSessions(testDir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(state.id);
      expect(sessions[0].messageCount).toBe(1);
      expect(sessions[0].lastMessage).toBe('Hello world');
      expect(sessions[0].updatedAt).toBeTypeOf('number');
    });

    it('should count messages correctly', async () => {
      const state = createTestState(['msg1', 'msg2', 'msg3']);
      await saveSession(state, testDir);

      const sessions = await listSessions(testDir);
      expect(sessions[0].messageCount).toBe(3);
    });

    it('should truncate lastMessage preview to 50 characters', async () => {
      const longContent = 'A'.repeat(100);
      const state = createTestState([longContent]);
      await saveSession(state, testDir);

      const sessions = await listSessions(testDir);
      expect(sessions[0].lastMessage).toHaveLength(50);
    });

    it('should return empty string for lastMessage when no messages', async () => {
      const state = createTestState([]);
      await saveSession(state, testDir);

      const sessions = await listSessions(testDir);
      expect(sessions[0].lastMessage).toBe('');
    });

    it('should correctly list multiple sessions', async () => {
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

    it('should sort sessions by updatedAt descending', async () => {
      const state1 = createTestState(['first']);
      await saveSession(state1, testDir);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const state2 = createTestState(['second']);
      await saveSession(state2, testDir);

      const sessions = await listSessions(testDir);
      expect(sessions).toHaveLength(2);
      // Most recently saved should be first
      expect(sessions[0].id).toBe(state2.id);
      expect(sessions[1].id).toBe(state1.id);
    });

    it('should ignore corrupted JSON files', async () => {
      const state = createTestState(['valid']);
      await saveSession(state, testDir);

      const corruptPath = path.join(testDir, 'corrupt-session.json');
      await fs.writeFile(corruptPath, 'not valid json {{{', 'utf-8');

      const sessions = await listSessions(testDir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(state.id);
    });

    it('should ignore non-JSON files', async () => {
      const state = createTestState(['valid']);
      await saveSession(state, testDir);

      const txtPath = path.join(testDir, 'readme.txt');
      await fs.writeFile(txtPath, 'some text', 'utf-8');

      const sessions = await listSessions(testDir);
      expect(sessions).toHaveLength(1);
    });

    it('should handle old format (bare AgentState) files for backward compatibility', async () => {
      // Write old format manually
      const state = createTestState(['legacy message']);
      const legacyJson = JSON.stringify(state);
      const filePath = path.join(testDir, `${state.id}.json`);
      await fs.writeFile(filePath, legacyJson, 'utf-8');

      const sessions = await listSessions(testDir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(state.id);
      expect(sessions[0].messageCount).toBe(1);
      expect(sessions[0].lastMessage).toBe('legacy message');
    });

    it('should mix v1 and old format files correctly', async () => {
      // Save v1 format
      const v1State = createTestState(['v1 message']);
      await saveSession(v1State, testDir);

      // Write old format
      const oldState = createTestState(['old message']);
      const legacyJson = JSON.stringify(oldState);
      await fs.writeFile(path.join(testDir, `${oldState.id}.json`), legacyJson, 'utf-8');

      const sessions = await listSessions(testDir);
      expect(sessions).toHaveLength(2);

      const ids = sessions.map((s) => s.id);
      expect(ids).toContain(v1State.id);
      expect(ids).toContain(oldState.id);
    });

    it('should handle old format with missing context field', async () => {
      const malformed = JSON.stringify({ id: 'malformed-id' });
      await fs.writeFile(path.join(testDir, 'malformed.json'), malformed, 'utf-8');

      const sessions = await listSessions(testDir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('malformed-id');
      expect(sessions[0].messageCount).toBe(0);
      expect(sessions[0].lastMessage).toBe('');
    });
  });

  describe('deleteSession', () => {
    it('should delete a saved session', async () => {
      const state = createTestState(['to be deleted']);
      await saveSession(state, testDir);

      const filePath = path.join(testDir, `${state.id}.json`);
      await fs.access(filePath);

      await deleteSession(state.id, testDir);

      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it('should not throw when deleting a non-existent session', async () => {
      await expect(deleteSession('non-existent-id', testDir)).resolves.toBeUndefined();
    });

    it('should not include deleted session in listing', async () => {
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
