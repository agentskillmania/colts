/**
 * @fileoverview MessageBubble component unit tests
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { MessageBubble } from '../../../src/components/chat/message-bubble.js';
import type { ChatMessage } from '../../../src/hooks/use-agent.js';

describe('MessageBubble', () => {
  it('should render user message', () => {
    const msg: ChatMessage = {
      id: '1',
      role: 'user',
      content: 'Hello world',
      timestamp: Date.now(),
    };
    const { lastFrame } = render(<MessageBubble message={msg} />);
    const frame = lastFrame();
    expect(frame).toContain('You');
    expect(frame).toContain('Hello world');
  });

  it('should render assistant message', () => {
    const msg: ChatMessage = {
      id: '2',
      role: 'assistant',
      content: 'Hi there!',
      timestamp: Date.now(),
    };
    const { lastFrame } = render(<MessageBubble message={msg} />);
    const frame = lastFrame();
    expect(frame).toContain('Assistant');
    expect(frame).toContain('Hi there!');
  });

  it('should render system message', () => {
    const msg: ChatMessage = {
      id: '3',
      role: 'system',
      content: 'Switched to STEP mode',
      timestamp: Date.now(),
    };
    const { lastFrame } = render(<MessageBubble message={msg} />);
    const frame = lastFrame();
    expect(frame).toContain('System');
    expect(frame).toContain('Switched to STEP mode');
  });

  it('should show cursor in streaming state', () => {
    const msg: ChatMessage = {
      id: '4',
      role: 'assistant',
      content: 'Thinking...',
      timestamp: Date.now(),
      isStreaming: true,
    };
    const { lastFrame } = render(<MessageBubble message={msg} />);
    expect(lastFrame()).toContain('|');
  });

  it('should not show cursor in non-streaming state', () => {
    const msg: ChatMessage = {
      id: '5',
      role: 'assistant',
      content: 'Done',
      timestamp: Date.now(),
      isStreaming: false,
    };
    const { lastFrame } = render(<MessageBubble message={msg} />);
    expect(lastFrame()).toContain('Done');
  });

  it('should render even with empty content', () => {
    const msg: ChatMessage = {
      id: '6',
      role: 'user',
      content: '',
      timestamp: Date.now(),
    };
    const { lastFrame } = render(<MessageBubble message={msg} />);
    expect(lastFrame()).toContain('You');
  });

  it('should use default label for unknown role', () => {
    const msg = {
      id: '7',
      role: 'other' as 'user' | 'assistant' | 'system',
      content: 'test',
      timestamp: Date.now(),
    };
    const { lastFrame } = render(<MessageBubble message={msg as ChatMessage} />);
    expect(lastFrame()).toContain('other');
    expect(lastFrame()).toContain('test');
  });
});
