/**
 * @fileoverview Session persistence hook — auto-save and restore AgentState
 *
 * Wraps saveSession/loadSession with React state management.
 * Supports auto-save (on state change) and restoring the most recent session.
 */

import { useState, useCallback } from 'react';
import type { AgentState } from '@agentskillmania/colts';
import { saveSession, loadSession, listSessions } from '../session.js';

/**
 * useSession hook return value
 */
export interface UseSessionReturn {
  /** Current session ID */
  sessionId: string | null;
  /** Whether a save is in progress */
  isSaving: boolean;
  /** Save current state */
  save: (state: AgentState) => Promise<void>;
  /** Restore the most recent session */
  restoreLatest: () => Promise<AgentState | null>;
  /** Set session ID (called after state restoration) */
  setSessionId: (id: string | null) => void;
}

/**
 * Session persistence hook
 *
 * @param baseDir - Optional custom storage directory (for testing)
 * @returns Session management interface
 *
 * @example
 * ```tsx
 * const { save, restoreLatest, sessionId } = useSession();
 *
 * // Restore the most recent session
 * const state = await restoreLatest();
 *
 * // Save current state
 * await save(agentState);
 * ```
 */
export function useSession(baseDir?: string): UseSessionReturn {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * Save AgentState to file
   *
   * @param state - Current AgentState
   */
  const save = useCallback(
    async (state: AgentState) => {
      setIsSaving(true);
      try {
        await saveSession(state, baseDir);
        setSessionId(state.id);
      } catch {
        // Silently ignore save failures to avoid disrupting interaction
      } finally {
        setIsSaving(false);
      }
    },
    [baseDir]
  );

  /**
   * Restore the most recent session
   *
   * Selects the latest session from the session list and loads it.
   *
   * @returns AgentState or null (when no sessions exist)
   */
  const restoreLatest = useCallback(async (): Promise<AgentState | null> => {
    try {
      const sessions = await listSessions(baseDir);
      if (sessions.length === 0) return null;

      const latest = sessions[0]; // Already sorted by time descending
      const state = await loadSession(latest.id, baseDir);
      setSessionId(state.id);
      return state;
    } catch {
      return null;
    }
  }, [baseDir]);

  return { sessionId, isSaving, save, restoreLatest, setSessionId };
}
