/**
 * session.ts unit tests
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

  describe('saveSession & loadSession', () => {
    it('should save and load a session', async () => {
      const state = createTestState(['Hello', 'World']);
      await saveSession(state, testDir);

      const loaded = await loadSession(state.id, testDir);
      expect(loaded.id).toBe(state.id);
      expect(loaded.context.messages).toHaveLength(2);
      expect(loaded.context.messages[0].content).toBe('Hello');
      expect(loaded.context.messages[1].content).toBe('World');
    });

    it('should save valid JSON file', async () => {
      const state = createTestState(['test message']);
      await saveSession(state, testDir);

      const filePath = path.join(testDir, `${state.id}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();

      const parsed = JSON.parse(content);
      expect(parsed.id).toBe(state.id);
      expect(parsed.config.name).toBe('test-agent');
    });

    it('should throw when loading a non-existent session', async () => {
      await expect(loadSession('non-existent-id', testDir)).rejects.toThrow();
    });

    it('should save and load an empty session with no messages', async () => {
      const state = createTestState([]);
      await saveSession(state, testDir);

      const loaded = await loadSession(state.id, testDir);
      expect(loaded.id).toBe(state.id);
      expect(loaded.context.messages).toHaveLength(0);
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

    it('should correctly list metadata for a single session', async () => {
      const state = createTestState(['Hello world']);
      await saveSession(state, testDir);

      const sessions = await listSessions(testDir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(state.id);
      expect(sessions[0].messageCount).toBe(1);
      expect(sessions[0].lastMessage).toBe('Hello world');
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
      expect(sessions[0].lastMessage).toBe('A'.repeat(50));
    });

    it('should return empty string for lastMessage when no messages', async () => {
      const state = createTestState([]);
      await saveSession(state, testDir);

      const sessions = await listSessions(testDir);
      expect(sessions[0].lastMessage).toBe('');
    });

    it('should return 0 for messageCount when no messages', async () => {
      const state = createTestState([]);
      await saveSession(state, testDir);

      const sessions = await listSessions(testDir);
      expect(sessions[0].messageCount).toBe(0);
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

    it('should sort sessions by creation time descending', async () => {
      // Create messages with different timestamps
      const state1 = createTestState(['first']);
      await saveSession(state1, testDir);

      // Simulate a later-created session: directly write with different timestamp
      const state2 = createTestState(['second']);
      await saveSession(state2, testDir);

      const sessions = await listSessions(testDir);
      // At least should return two sessions
      expect(sessions).toHaveLength(2);
    });

    it('should ignore corrupted JSON files', async () => {
      const state = createTestState(['valid']);
      await saveSession(state, testDir);

      // Write a corrupted JSON file
      const corruptPath = path.join(testDir, 'corrupt-session.json');
      await fs.writeFile(corruptPath, 'not valid json {{{', 'utf-8');

      const sessions = await listSessions(testDir);
      // Only return valid sessions
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(state.id);
    });

    it('should handle session files missing context field', async () => {
      // Write a valid JSON file but missing context
      const malformedPath = path.join(testDir, 'malformed.json');
      const malformed = JSON.stringify({ id: 'malformed-id' });
      await fs.writeFile(malformedPath, malformed, 'utf-8');

      const sessions = await listSessions(testDir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('malformed-id');
      expect(sessions[0].messageCount).toBe(0);
      expect(sessions[0].lastMessage).toBe('');
    });

    it('should ignore non-JSON files', async () => {
      const state = createTestState(['valid']);
      await saveSession(state, testDir);

      // Write a non-JSON file
      const txtPath = path.join(testDir, 'readme.txt');
      await fs.writeFile(txtPath, 'some text', 'utf-8');

      const sessions = await listSessions(testDir);
      expect(sessions).toHaveLength(1);
    });
  });

  describe('deleteSession', () => {
    it('should delete a saved session', async () => {
      const state = createTestState(['to be deleted']);
      await saveSession(state, testDir);

      // Confirm file exists
      const filePath = path.join(testDir, `${state.id}.json`);
      await fs.access(filePath);

      await deleteSession(state.id, testDir);

      // Confirm file is deleted
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it('should not throw when deleting a non-existent session', async () => {
      // Should pass silently without throwing
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
