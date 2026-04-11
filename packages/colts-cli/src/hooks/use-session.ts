/**
 * @fileoverview Session 持久化 hook — 自动保存、恢复 AgentState
 *
 * 封装 saveSession/loadSession，提供 React 状态管理。
 * 支持自动保存（state 变化时）和恢复最近 session。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentState } from '@agentskillmania/colts';
import { saveSession, loadSession, listSessions } from '../session.js';

/**
 * 自动保存延迟（毫秒）
 *
 * state 变化后等待 500ms 再保存，避免高频保存。
 */
const AUTOSAVE_DELAY_MS = 500;

/**
 * useSession hook 返回值
 */
export interface UseSessionReturn {
  /** 当前 session ID */
  sessionId: string | null;
  /** 是否正在保存 */
  isSaving: boolean;
  /** 保存当前 state */
  save: (state: AgentState) => Promise<void>;
  /** 恢复最近 session */
  restoreLatest: () => Promise<AgentState | null>;
  /** 设置 session ID（state 恢复后调用） */
  setSessionId: (id: string | null) => void;
}

/**
 * Session 持久化 hook
 *
 * @param baseDir - 可选的自定义存储目录（测试用）
 * @returns Session 管理接口
 *
 * @example
 * ```tsx
 * const { save, restoreLatest, sessionId } = useSession();
 *
 * // 恢复最近 session
 * const state = await restoreLatest();
 *
 * // 保存当前 state
 * await save(agentState);
 * ```
 */
export function useSession(baseDir?: string): UseSessionReturn {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  /**
   * 保存 AgentState 到文件
   *
   * @param state - 当前 AgentState
   */
  const save = useCallback(
    async (state: AgentState) => {
      setIsSaving(true);
      try {
        await saveSession(state, baseDir);
        setSessionId(state.id);
      } catch {
        // 保存失败静默处理，不影响交互
      } finally {
        setIsSaving(false);
      }
    },
    [baseDir]
  );

  /**
   * 恢复最近的 session
   *
   * 从 session 列表中选择最新的一个并加载。
   *
   * @returns AgentState 或 null（无 session 时）
   */
  const restoreLatest = useCallback(async (): Promise<AgentState | null> => {
    try {
      const sessions = await listSessions(baseDir);
      if (sessions.length === 0) return null;

      const latest = sessions[0]; // 已按时间降序排列
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
 * 延迟自动保存
 *
 * state 变化后延迟保存，避免高频写入。
 *
 * @param state - 当前 AgentState
 * @param sessionId - 当前 session ID
 * @param saveFn - 保存函数
 * @param timerRef - 定时器 ref
 */
export function scheduleAutoSave(
  state: AgentState | null,
  sessionId: string | null,
  saveFn: (state: AgentState) => Promise<void>,
  timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
): void {
  if (!state) return;
  // session ID 不匹配说明是新 state 或未保存过
  if (state.id === sessionId) return;

  if (timerRef.current) {
    clearTimeout(timerRef.current);
  }

  timerRef.current = setTimeout(() => {
    saveFn(state);
    timerRef.current = null;
  }, AUTOSAVE_DELAY_MS);
}
