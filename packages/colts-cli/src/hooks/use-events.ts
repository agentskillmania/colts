/**
 * @fileoverview Events Hook — 事件流的缓冲管理和格式化
 *
 * 管理来自 Agent 执行的事件流，支持 100ms 批量渲染以避免终端闪烁。
 * 将 StreamEvent 转换为可显示的 DisplayEvent 格式。
 */

import { useState, useCallback, useRef } from 'react';
import type { StreamEvent } from '@agentskillmania/colts';

/**
 * 可显示的事件
 */
export interface DisplayEvent {
  /** 事件唯一标识 */
  id: string;
  /** 事件类型 */
  type: string;
  /** 格式化后的显示文本 */
  text: string;
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 缩进层级（用于层级展示） */
  indent?: number;
}

/** 事件批量渲染的延迟时间（毫秒） */
const BATCH_DELAY_MS = 100;

/**
 * 格式化 StreamEvent 为可显示文本
 *
 * 根据事件类型生成人类可读的描述。
 *
 * @param event - 原始 StreamEvent
 * @returns 格式化后的文本
 */
export function formatEvent(event: StreamEvent): string {
  switch (event.type) {
    case 'phase-change':
      return `Phase: ${event.from.type} → ${event.to.type}`;
    case 'token':
      return event.token;
    case 'tool:start':
      return `Tool: ${event.action.tool}`;
    case 'tool:end': {
      const resultText =
        typeof event.result === 'string'
          ? event.result.slice(0, 50)
          : JSON.stringify(event.result).slice(0, 50);
      return `Result: ${resultText}`;
    }
    case 'error':
      return `Error: ${event.error.message}`;
    case 'compressing':
      return 'Compressing context...';
    case 'compressed':
      return `Compressed: ${event.removedCount} messages`;
    default:
      return JSON.stringify(event);
  }
}

/**
 * useEvents Hook 的返回值
 */
export interface UseEventsReturn {
  /** 当前事件列表 */
  events: DisplayEvent[];
  /** 添加事件（自动批量渲染） */
  addEvent: (event: StreamEvent) => void;
  /** 清空事件 */
  clearEvents: () => void;
}

/**
 * 事件流管理 Hook
 *
 * 将 StreamEvent 转为 DisplayEvent，并使用 100ms 定时器批量渲染，
 * 避免高频事件导致终端闪烁。
 *
 * @returns 事件管理接口
 *
 * @example
 * ```tsx
 * const { events, addEvent, clearEvents } = useEvents();
 *
 * // 在 Agent 流式执行中添加事件
 * for await (const event of runner.runStream(state)) {
 *   addEvent(event);
 * }
 * ```
 */
export function useEvents(): UseEventsReturn {
  const [events, setEvents] = useState<DisplayEvent[]>([]);
  const bufferRef = useRef<DisplayEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 将缓冲区的事件批量刷新到状态中 */
  const flushEvents = useCallback(() => {
    if (bufferRef.current.length > 0) {
      setEvents((prev) => [...prev, ...bufferRef.current]);
      bufferRef.current = [];
    }
    timerRef.current = null;
  }, []);

  /**
   * 添加事件到缓冲区
   *
   * 事件先存入缓冲区，100ms 后批量刷新到状态中。
   * 如果已有定时器在运行，新事件会在下次刷新时一并处理。
   *
   * @param event - StreamEvent 事件
   */
  const addEvent = useCallback(
    (event: StreamEvent) => {
      const displayEvent: DisplayEvent = {
        id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
        type: event.type,
        text: formatEvent(event),
        timestamp: Date.now(),
      };

      bufferRef.current.push(displayEvent);

      // 启动批量渲染定时器
      if (!timerRef.current) {
        timerRef.current = setTimeout(flushEvents, BATCH_DELAY_MS);
      }
    },
    [flushEvents]
  );

  /** 清空所有事件并取消定时器 */
  const clearEvents = useCallback(() => {
    setEvents([]);
    bufferRef.current = [];
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return { events, addEvent, clearEvents };
}
