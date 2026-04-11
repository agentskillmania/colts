/**
 * @fileoverview Unit tests for useSession hook and scheduleAutoSave
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scheduleAutoSave } from '../../src/hooks/use-session.js';
import type { AgentState } from '@agentskillmania/colts';

// Mock session module
vi.mock('../../src/session.js', () => ({
  saveSession: vi.fn().mockResolvedValue(undefined),
  loadSession: vi.fn().mockResolvedValue({
    id: 'restored-session',
    config: { name: 'test', instructions: 'test', tools: [] },
    context: { messages: [], stepCount: 0 },
  }),
  listSessions: vi
    .fn()
    .mockResolvedValue([
      { id: 'restored-session', createdAt: Date.now(), messageCount: 2, lastMessage: 'hi' },
    ]),
}));

describe('scheduleAutoSave', () => {
  let timerRef: { current: ReturnType<typeof setTimeout> | null };
  let saveFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    timerRef = { current: null };
    saveFn = vi.fn().mockResolvedValue(undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not save when state is null', () => {
    scheduleAutoSave(null, null, saveFn, timerRef);
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('should not save when state.id equals sessionId', () => {
    const state = { id: 'same-id' } as AgentState;
    scheduleAutoSave(state, 'same-id', saveFn, timerRef);
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('should save with delay when state.id differs from sessionId', () => {
    const state = { id: 'new-id' } as AgentState;
    scheduleAutoSave(state, 'old-id', saveFn, timerRef);
    expect(saveFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(saveFn).toHaveBeenCalledWith(state);
  });

  it('should cancel previous save on consecutive calls', () => {
    const state1 = { id: 'id-1' } as AgentState;
    const state2 = { id: 'id-2' } as AgentState;

    scheduleAutoSave(state1, null, saveFn, timerRef);
    scheduleAutoSave(state2, null, saveFn, timerRef);

    vi.advanceTimersByTime(500);
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith(state2);
  });
});
