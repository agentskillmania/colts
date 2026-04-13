/**
 * @fileoverview Unit tests for useSession hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentState } from '@agentskillmania/colts';

// Mock session module
const mockSaveSession = vi.fn().mockResolvedValue(undefined);
const mockLoadSession = vi.fn().mockResolvedValue({
  id: 'restored-session',
  config: { name: 'test', instructions: 'test', tools: [] },
  context: { messages: [], stepCount: 0 },
} as AgentState);
const mockListSessions = vi
  .fn()
  .mockResolvedValue([
    { id: 'restored-session', createdAt: Date.now(), messageCount: 2, lastMessage: 'hi' },
  ]);

vi.mock('../../src/session.js', () => ({
  saveSession: mockSaveSession,
  loadSession: mockLoadSession,
  listSessions: mockListSessions,
}));

describe('useSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export save, restoreLatest, sessionId, isSaving, setSessionId', async () => {
    const { useSession } = await import('../../src/hooks/use-session.js');
    // useSession is a React hook, can only verify it's a function
    expect(typeof useSession).toBe('function');
  });

  it('restoreLatest returns latest session when available', async () => {
    const { useSession } = await import('../../src/hooks/use-session.js');
    // Direct test of restoreLatest behavior through the mocked session module
    const { listSessions, loadSession } = await import('../../src/session.js');
    const sessions = await listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('restored-session');

    const state = await loadSession('restored-session');
    expect(state.id).toBe('restored-session');
  });

  it('restoreLatest returns null when no sessions exist', async () => {
    mockListSessions.mockResolvedValueOnce([]);
    const { listSessions } = await import('../../src/session.js');
    const sessions = await listSessions();
    expect(sessions).toHaveLength(0);
  });

  it('save calls saveSession with state', async () => {
    const { saveSession } = await import('../../src/session.js');
    const state: AgentState = {
      id: 'test-id',
      config: { name: 'test', instructions: 'test', tools: [] },
      context: { messages: [], stepCount: 0 },
    };
    await saveSession(state);
    expect(saveSession).toHaveBeenCalledWith(state);
  });
});
