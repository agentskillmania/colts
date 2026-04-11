/**
 * @fileoverview Session persistence hook — auto-save and restore AgentState
 *
 * Wraps saveSession/loadSession with React state management.
 * Supports auto-save (on state change) and restoring the most recent session.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentState } from '@agentskillmania/colts';
import { saveSession, loadSession, listSessions } from '../session.js';

/**
 * Auto-save delay in milliseconds
 *
 * Waits 500ms after state changes before saving to avoid high-frequency writes.
 */
const AUTOSAVE_DELAY_MS = 500;

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
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

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

/**
 * Delayed auto-save
 *
 * Saves state after a delay to avoid high-frequency writes.
 *
 * @param state - Current AgentState
 * @param sessionId - Current session ID
 * @param saveFn - Save function
 * @param timerRef - Timer ref
 */
export function scheduleAutoSave(
  state: AgentState | null,
  sessionId: string | null,
  saveFn: (state: AgentState) => Promise<void>,
  timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
): void {
  if (!state) return;
  // Mismatched session ID indicates a new state or unsaved state
  if (state.id === sessionId) return;

  if (timerRef.current) {
    clearTimeout(timerRef.current);
  }

  timerRef.current = setTimeout(() => {
    saveFn(state);
    timerRef.current = null;
  }, AUTOSAVE_DELAY_MS);
}
