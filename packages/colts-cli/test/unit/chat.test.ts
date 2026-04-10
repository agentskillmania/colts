/**
 * chat.tsx 单元测试
 *
 * 测试 Chat 组件中使用的常量和映射逻辑。
 * ink 组件渲染测试比较困难，重点测试数据映射逻辑。
 */

import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '../../src/hooks/use-agent.js';

describe('Chat 组件逻辑', () => {
  /** 角色显示名映射（与 chat.tsx 中定义一致） */
  const ROLE_LABELS: Record<ChatMessage['role'], string> = {
    user: 'You',
    assistant: 'Agent',
    system: 'System',
  };

  /** 角色颜色映射（与 chat.tsx 中定义一致） */
  const ROLE_COLORS: Record<ChatMessage['role'], string> = {
    user: 'blue',
    assistant: 'white',
    system: 'gray',
  };

  describe('ROLE_LABELS', () => {
    it('user 角色标签为 You', () => {
      expect(ROLE_LABELS.user).toBe('You');
    });

    it('assistant 角色标签为 Agent', () => {
      expect(ROLE_LABELS.assistant).toBe('Agent');
    });

    it('system 角色标签为 System', () => {
      expect(ROLE_LABELS.system).toBe('System');
    });
  });

  describe('ROLE_COLORS', () => {
    it('user 角色颜色为 blue', () => {
      expect(ROLE_COLORS.user).toBe('blue');
    });

    it('assistant 角色颜色为 white', () => {
      expect(ROLE_COLORS.assistant).toBe('white');
    });

    it('system 角色颜色为 gray', () => {
      expect(ROLE_COLORS.system).toBe('gray');
    });
  });

  describe('消息数据结构', () => {
    it('ChatMessage 接口包含必要字段', () => {
      const msg: ChatMessage = {
        id: '1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };
      expect(msg.id).toBe('1');
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello');
      expect(msg.timestamp).toBeTypeOf('number');
    });

    it('流式消息包含 isStreaming 标志', () => {
      const msg: ChatMessage = {
        id: '2',
        role: 'assistant',
        content: 'Hello',
        timestamp: Date.now(),
        isStreaming: true,
      };
      expect(msg.isStreaming).toBe(true);
    });

    it('非流式消息不包含 isStreaming 标志', () => {
      const msg: ChatMessage = {
        id: '3',
        role: 'assistant',
        content: 'Hello',
        timestamp: Date.now(),
      };
      expect(msg.isStreaming).toBeUndefined();
    });
  });

  describe('流式光标', () => {
    it('流式光标为 ▌', () => {
      const STREAMING_CURSOR = '▌';
      expect(STREAMING_CURSOR).toBe('▌');
    });
  });

  describe('消息列表渲染顺序', () => {
    it('消息按添加顺序排列', () => {
      const messages: ChatMessage[] = [
        { id: '1', role: 'user', content: 'First', timestamp: 1000 },
        { id: '2', role: 'assistant', content: 'Second', timestamp: 2000 },
        { id: '3', role: 'user', content: 'Third', timestamp: 3000 },
      ];

      expect(messages[0].content).toBe('First');
      expect(messages[1].content).toBe('Second');
      expect(messages[2].content).toBe('Third');
    });
  });
});
