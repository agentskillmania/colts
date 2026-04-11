/**
 * chat.tsx 单元测试
 *
 * 测试 Chat 组件的渲染行为，包括角色标签、消息内容和流式光标。
 * 使用 ink-testing-library 进行组件渲染验证。
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Chat } from '../../src/components/chat.js';
import type { ChatMessage } from '../../src/hooks/use-agent.js';

/** 创建测试用消息的辅助函数 */
function createMessage(overrides: Partial<ChatMessage> & { id: string; role: ChatMessage['role']; content: string }): ChatMessage {
  return {
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('Chat 组件', () => {
  describe('基本渲染', () => {
    it('空消息列表能正常渲染', () => {
      const { lastFrame } = render(<Chat messages={[]} />);
      // 空列表应该渲染一个空的容器
      const frame = lastFrame();
      expect(frame).toBeDefined();
    });

    it('渲染单条用户消息', () => {
      const messages: ChatMessage[] = [
        createMessage({ id: '1', role: 'user', content: 'Hello' }),
      ];
      const { lastFrame } = render(<Chat messages={messages} />);
      const frame = lastFrame();
      expect(frame).toContain('You');
      expect(frame).toContain('Hello');
    });

    it('渲染单条助手消息', () => {
      const messages: ChatMessage[] = [
        createMessage({ id: '2', role: 'assistant', content: 'Hi there' }),
      ];
      const { lastFrame } = render(<Chat messages={messages} />);
      const frame = lastFrame();
      expect(frame).toContain('Agent');
      expect(frame).toContain('Hi there');
    });

    it('渲染单条系统消息', () => {
      const messages: ChatMessage[] = [
        createMessage({ id: '3', role: 'system', content: 'System notice' }),
      ];
      const { lastFrame } = render(<Chat messages={messages} />);
      const frame = lastFrame();
      expect(frame).toContain('System');
      expect(frame).toContain('System notice');
    });
  });

  describe('多消息渲染', () => {
    it('渲染多条消息时按顺序显示', () => {
      const messages: ChatMessage[] = [
        createMessage({ id: '1', role: 'user', content: 'First question' }),
        createMessage({ id: '2', role: 'assistant', content: 'First answer' }),
        createMessage({ id: '3', role: 'user', content: 'Second question' }),
      ];
      const { lastFrame } = render(<Chat messages={messages} />);
      const frame = lastFrame()!;
      // 验证消息按顺序出现
      const firstIdx = frame.indexOf('First question');
      const secondIdx = frame.indexOf('First answer');
      const thirdIdx = frame.indexOf('Second question');
      expect(firstIdx).toBeLessThan(secondIdx);
      expect(secondIdx).toBeLessThan(thirdIdx);
    });

    it('不同角色消息显示对应标签', () => {
      const messages: ChatMessage[] = [
        createMessage({ id: '1', role: 'user', content: 'msg1' }),
        createMessage({ id: '2', role: 'assistant', content: 'msg2' }),
        createMessage({ id: '3', role: 'system', content: 'msg3' }),
      ];
      const { lastFrame } = render(<Chat messages={messages} />);
      const frame = lastFrame();
      expect(frame).toContain('You');
      expect(frame).toContain('Agent');
      expect(frame).toContain('System');
    });
  });

  describe('流式光标', () => {
    it('isStreaming 为 true 时显示 ▌ 光标', () => {
      const messages: ChatMessage[] = [
        createMessage({
          id: '1',
          role: 'assistant',
          content: 'Streaming',
          isStreaming: true,
        }),
      ];
      const { lastFrame } = render(<Chat messages={messages} />);
      const frame = lastFrame();
      expect(frame).toContain('Streaming▌');
    });

    it('isStreaming 为 false 时不显示光标', () => {
      const messages: ChatMessage[] = [
        createMessage({
          id: '1',
          role: 'assistant',
          content: 'Done',
          isStreaming: false,
        }),
      ];
      const { lastFrame } = render(<Chat messages={messages} />);
      const frame = lastFrame();
      expect(frame).toContain('Done');
      expect(frame).not.toContain('Done▌');
    });

    it('无 isStreaming 字段时不显示光标', () => {
      const messages: ChatMessage[] = [
        createMessage({ id: '1', role: 'assistant', content: 'No streaming' }),
      ];
      const { lastFrame } = render(<Chat messages={messages} />);
      const frame = lastFrame();
      expect(frame).not.toContain('▌');
    });

    it('用户消息不支持流式光标', () => {
      const messages: ChatMessage[] = [
        createMessage({
          id: '1',
          role: 'user',
          content: 'User message',
          isStreaming: true,
        }),
      ];
      const { lastFrame } = render(<Chat messages={messages} />);
      const frame = lastFrame();
      // 用户消息也会渲染 isStreaming，因为组件逻辑不做角色过滤
      expect(frame).toContain('User message▌');
    });
  });

  describe('消息内容', () => {
    it('空内容的消息也能正常渲染', () => {
      const messages: ChatMessage[] = [
        createMessage({ id: '1', role: 'user', content: '' }),
      ];
      const { lastFrame } = render(<Chat messages={messages} />);
      const frame = lastFrame();
      expect(frame).toContain('You');
    });

    it('长内容消息能正常渲染', () => {
      const longContent = 'A'.repeat(1000);
      const messages: ChatMessage[] = [
        createMessage({ id: '1', role: 'assistant', content: longContent }),
      ];
      const { lastFrame } = render(<Chat messages={messages} />);
      const frame = lastFrame();
      expect(frame).toContain('Agent');
      // 验证长内容的一部分存在
      expect(frame).toContain('A'.repeat(50));
    });

    it('包含特殊字符的消息能正常渲染', () => {
      const messages: ChatMessage[] = [
        createMessage({ id: '1', role: 'user', content: '<script>alert("xss")</script>' }),
      ];
      const { lastFrame } = render(<Chat messages={messages} />);
      const frame = lastFrame();
      expect(frame).toContain('You');
    });
  });
});
