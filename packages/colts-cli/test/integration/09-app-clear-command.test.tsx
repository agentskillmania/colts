/**
 * @fileoverview App-level /clear command with real LLM
 *
 * User Story: User sends a message, sees the conversation, then runs /clear.
 * The timeline is cleared and user sees the welcome screen again.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { AgentRunner } from '@agentskillmania/colts';
import { testConfig, itif } from './config.js';
import { createRealRunner, renderApp, submitMessage, waitForIdle } from './app-helpers.js';

describe('Integration: App /clear command with real LLM', () => {
  let runner: AgentRunner;

  beforeAll(() => {
    if (testConfig.enabled) {
      runner = createRealRunner();
    }
  });

  itif(testConfig.enabled)(
    '/clear clears the conversation and shows welcome screen',
    async () => {
      const { lastFrame, unmount } = renderApp({ runner });

      // Send a message first to establish conversation history
      await submitMessage('Say exactly "banana" and nothing else.');
      const frameWithMessage = await waitForIdle(lastFrame, 90000);
      expect(frameWithMessage).toContain('❯');
      expect(frameWithMessage.toLowerCase()).toContain('banana');

      // Execute /clear
      await submitMessage('/clear');
      const clearedFrame = lastFrame() || '';

      // Previous messages should not be visible after clear
      expect(clearedFrame).not.toContain('banana');
      // Should return to welcome screen
      expect(clearedFrame).toContain('Welcome to colts-cli');

      unmount();
    },
    180000
  );
});
