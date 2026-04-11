/**
 * @fileoverview ChatPanel component unit tests
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { ChatPanel } from '../../../src/components/chat/chat-panel.js';
import type { ChatMessage } from '../../../src/hooks/use-agent.js';

describe('ChatPanel', () => {
  it('should show empty state prompt when no messages', () => {
    const { lastFrame } = render(<ChatPanel messages={[]} />);
    expect(lastFrame()).toContain('No messages yet');
  });

  it('should render a single user message', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: 'Hello', timestamp: Date.now() },
    ];
    const { lastFrame } = render(<ChatPanel messages={messages} />);
    expect(lastFrame()).toContain('You');
    expect(lastFrame()).toContain('Hello');
  });

  it('should render multiple messages', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: 'Hi', timestamp: Date.now() },
      { id: '2', role: 'assistant', content: 'Hey', timestamp: Date.now() },
    ];
    const { lastFrame } = render(<ChatPanel messages={messages} />);
    expect(lastFrame()).toContain('Hi');
    expect(lastFrame()).toContain('Hey');
  });

  it('should render system messages', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'system', content: 'Switched to RUN mode', timestamp: Date.now() },
    ];
    const { lastFrame } = render(<ChatPanel messages={messages} />);
    expect(lastFrame()).toContain('System');
    expect(lastFrame()).toContain('Switched to RUN mode');
  });

  it('should render streaming messages', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'assistant', content: 'Thinking...', timestamp: Date.now(), isStreaming: true },
    ];
    const { lastFrame } = render(<ChatPanel messages={messages} />);
    expect(lastFrame()).toContain('Thinking...');
    expect(lastFrame()).toContain('|');
  });
});
