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

      // 先发一条消息建立对话历史
      await submitMessage('Say exactly "banana" and nothing else.');
      const frameWithMessage = await waitForIdle(lastFrame, 90000);
      expect(frameWithMessage).toContain('You:');
      expect(frameWithMessage.toLowerCase()).toContain('banana');

      // 执行 /clear
      await submitMessage('/clear');
      const clearedFrame = lastFrame() || '';

      // 清屏后不应该看到之前的消息
      expect(clearedFrame).not.toContain('banana');
      // 应该回到欢迎屏幕
      expect(clearedFrame).toContain('Welcome to colts-cli');

      unmount();
    },
    180000
  );
});
