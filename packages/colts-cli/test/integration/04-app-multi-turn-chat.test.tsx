/**
 * @fileoverview App-level multi-turn chat with real LLM
 *
 * End-to-end user story: a CLI user sends multiple messages through the TUI
 * and the real LLM responds with context-aware answers.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { AgentRunner } from '@agentskillmania/colts';
import { testConfig, itif } from './config.js';
import { createRealRunner, renderApp, submitMessage, waitForIdle } from './app-helpers.js';

describe('Integration: App multi-turn chat with real LLM', () => {
  let runner: AgentRunner;

  beforeAll(() => {
    if (testConfig.enabled) {
      runner = createRealRunner();
    }
  });

  itif(testConfig.enabled)(
    'Two consecutive messages through App, LLM remembers context',
    async () => {
      const { lastFrame, unmount } = renderApp({ runner });

      // First turn
      await submitMessage('My favorite color is blue.');
      let frame = await waitForIdle(lastFrame, 90000);
      expect(frame).toContain('You:');
      expect(frame).toContain('My favorite color is blue.');
      expect(frame).toContain('Agent:');
      expect(frame).not.toContain('Agent is thinking');

      // Second turn
      await submitMessage('What is my favorite color?');
      frame = await waitForIdle(lastFrame, 90000);
      expect(frame).toContain('You:');
      expect(frame).toContain('What is my favorite color?');
      expect(frame).toContain('Agent:');
      expect(frame.toLowerCase()).toContain('blue');

      unmount();
    },
    180000
  );

  itif(testConfig.enabled)(
    '/run command does not break the conversation flow',
    async () => {
      const { lastFrame, unmount } = renderApp({ runner });

      await submitMessage('/run');
      let frame = lastFrame() || '';
      expect(frame).toContain('RUN');

      await submitMessage('Say hello.');
      frame = await waitForIdle(lastFrame, 90000);
      expect(frame).toContain('You:');
      expect(frame).toContain('Say hello.');
      expect(frame).toContain('Agent:');
      expect(frame.toLowerCase()).toContain('hello');

      unmount();
    },
    120000
  );
});
