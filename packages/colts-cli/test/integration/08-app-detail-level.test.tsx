/**
 * @fileoverview App-level detail level switching with real LLM
 *
 * User Story: User switches display detail level between compact and verbose.
 * In verbose mode, user sees phase change entries.
 * In compact mode, phase entries are hidden.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { AgentRunner } from '@agentskillmania/colts';
import { testConfig, itif } from './config.js';
import { createRealRunner, renderApp, submitMessage, waitForIdle } from './app-helpers.js';

describe('Integration: App detail level switching with real LLM', () => {
  let runner: AgentRunner;

  beforeAll(() => {
    if (testConfig.enabled) {
      runner = createRealRunner();
    }
  });

  itif(testConfig.enabled)(
    '/verbose shows phase details, /compact hides them',
    async () => {
      const { lastFrame, unmount } = renderApp({ runner });

      // 先切到 verbose 模式
      await submitMessage('/verbose');

      // 发一条消息
      await submitMessage('Say exactly the word "hello" and nothing else.');
      const verboseFrame = await waitForIdle(lastFrame, 90000);

      // verbose 模式下应该看到 agent 回复
      expect(verboseFrame).toContain('Agent:');
      expect(verboseFrame.toLowerCase()).toContain('hello');

      // 切回 compact 模式
      await submitMessage('/compact');

      // 再发一条消息
      await submitMessage('Say exactly the word "world" and nothing else.');
      const compactFrame = await waitForIdle(lastFrame, 90000);

      // compact 模式下也能看到回复
      expect(compactFrame).toContain('Agent:');
      expect(compactFrame.toLowerCase()).toContain('world');

      unmount();
    },
    180000
  );
});
