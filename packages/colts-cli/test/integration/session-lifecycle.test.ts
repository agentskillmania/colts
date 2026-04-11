/**
 * Session persistence integration tests
 *
 * User Story: Session Persistence
 * As a developer debugging agents, I want conversations to persist across sessions,
 * so I can continue from where I left off next time.
 *
 * Tests the full lifecycle of session save, load, list, and delete.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { saveSession, loadSession, listSessions, deleteSession } from '../../src/session.js';
import { createAgentState, addUserMessage, serializeState } from '@agentskillmania/colts';
import type { AgentState } from '@agentskillmania/colts';

describe('Session persistence', () => {
  const testDir = path.join(os.tmpdir(), `colts-intg-session-${Date.now()}`);

  /** Create a test AgentState with messages */
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
    // Create isolated temp directory before each test
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Scenario 1: saveSession creates a JSON file in the session directory
   */
  it('saveSession creates a JSON file in the session directory', async () => {
    const state = createTestState(['Hello']);
    await saveSession(state, testDir);

    // Verify JSON file exists
    const filePath = path.join(testDir, `${state.id}.json`);
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify it is valid JSON with correct id
    const parsed = JSON.parse(content);
    expect(parsed.id).toBe(state.id);
  });

  /**
   * Scenario 2: loadSession reads back the same state (compare serialized form)
   */
  it('loadSession reads back the same state (serialized form matches)', async () => {
    const state = createTestState(['First message', 'Second message', 'Third message']);
    await saveSession(state, testDir);

    const loaded = await loadSession(state.id, testDir);

    // Compare serialized forms
    const originalJson = serializeState(state);
    const loadedJson = serializeState(loaded);
    expect(loadedJson).toBe(originalJson);

    // Basic field verification
    expect(loaded.id).toBe(state.id);
    expect(loaded.context.messages).toHaveLength(3);
    expect(loaded.context.messages[0].content).toBe('First message');
  });

  /**
   * Scenario 3: listSessions returns metadata for saved sessions
   */
  it('listSessions returns metadata for saved sessions', async () => {
    const state = createTestState(['Test message']);
    await saveSession(state, testDir);

    const sessions = await listSessions(testDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(state.id);
    expect(sessions[0].messageCount).toBe(1);
    expect(sessions[0].lastMessage).toBe('Test message');
  });

  /**
   * Scenario 4: listSessions returns empty array when no sessions exist
   */
  it('listSessions returns empty array when no sessions exist', async () => {
    // Empty directory
    const emptyDir = path.join(testDir, 'empty');
    await fs.mkdir(emptyDir, { recursive: true });

    const sessions = await listSessions(emptyDir);
    expect(sessions).toEqual([]);
  });

  /**
   * Scenario 5: listSessions sorts by createdAt descending
   */
  it('listSessions sorts by createdAt descending', async () => {
    // Create three sessions with different timestamps
    const now = Date.now();

    // First session: 2000ms ago
    const state1 = createTestState(['old message']);
    // Manually modify timestamps to ensure sorting is testable
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

    // Second session: 1000ms ago
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

    // Third session: most recent
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

    // Most recent first
    expect(sessions[0].id).toBe(state3Modified.id);
    expect(sessions[0].createdAt).toBe(now);
    expect(sessions[1].id).toBe(state2Modified.id);
    expect(sessions[1].createdAt).toBe(now - 1000);
    expect(sessions[2].id).toBe(state1Modified.id);
    expect(sessions[2].createdAt).toBe(now - 2000);
  });

  /**
   * Scenario 6: deleteSession removes the file
   */
  it('deleteSession removes the session file', async () => {
    const state = createTestState(['to be deleted']);
    await saveSession(state, testDir);

    // Confirm file exists
    const filePath = path.join(testDir, `${state.id}.json`);
    await fs.access(filePath);

    // Delete session
    await deleteSession(state.id, testDir);

    // Confirm file is deleted
    await expect(fs.access(filePath)).rejects.toThrow();

    // listSessions no longer returns the session
    const sessions = await listSessions(testDir);
    expect(sessions).toHaveLength(0);
  });

  /**
   * Scenario 7: deleteSession ignores non-existent sessions
   */
  it('deleteSession ignores non-existent sessions (no error thrown)', async () => {
    // Should pass silently without throwing
    await expect(deleteSession('non-existent-session-id', testDir)).resolves.toBeUndefined();
  });

  /**
   * Scenario 8: saveSession creates directory when it does not exist
   */
  it('saveSession creates directory when it does not exist', async () => {
    // Use a nested non-existent directory
    const nestedDir = path.join(testDir, 'nested', 'deep', 'sessions');

    // Confirm directory does not exist
    await expect(fs.access(nestedDir)).rejects.toThrow();

    const state = createTestState(['nested message']);
    await saveSession(state, nestedDir);

    // Verify directory was created and file exists
    const filePath = path.join(nestedDir, `${state.id}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.id).toBe(state.id);
  });

  /**
   * Scenario 9: Multiple sessions, listSessions returns all
   */
  it('listSessions returns all sessions when multiple exist', async () => {
    const states: AgentState[] = [];
    for (let i = 0; i < 5; i++) {
      const state = createTestState([`Session ${i + 1} message`]);
      states.push(state);
      await saveSession(state, testDir);
    }

    const sessions = await listSessions(testDir);
    expect(sessions).toHaveLength(5);

    // Verify all session IDs are in the list
    const ids = sessions.map((s) => s.id);
    for (const state of states) {
      expect(ids).toContain(state.id);
    }
  });

  /**
   * Scenario 10: Session with long messages, preview truncated to 50 characters
   */
  it('Preview is truncated to 50 characters for sessions with long messages', async () => {
    // Create a message longer than 50 characters
    const longContent =
      'This is a very long message used to test whether the preview truncation feature works correctly, characters beyond fifty should be truncated.';
    const state = createTestState(['short', longContent]);
    await saveSession(state, testDir);

    const sessions = await listSessions(testDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].messageCount).toBe(2);

    // lastMessage is the truncated preview of the last message, no more than 50 characters
    expect(sessions[0].lastMessage.length).toBeLessThanOrEqual(50);
    // Confirm it is the truncated content
    expect(sessions[0].lastMessage).toBe(longContent.slice(0, 50));
  });
});
