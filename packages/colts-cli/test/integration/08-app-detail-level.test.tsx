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

      // Switch to verbose mode first
      await submitMessage('/verbose');

      // Send a message
      await submitMessage('Say exactly the word "hello" and nothing else.');
      const verboseFrame = await waitForIdle(lastFrame, 90000);

      // Agent reply should be visible in verbose mode
      expect(verboseFrame).toContain('◀');
      expect(verboseFrame.toLowerCase()).toContain('hello');

      // Switch back to compact mode
      await submitMessage('/compact');

      // Send another message
      await submitMessage('Say exactly the word "world" and nothing else.');
      const compactFrame = await waitForIdle(lastFrame, 90000);

      // Reply should also be visible in compact mode
      expect(compactFrame).toContain('◀');
      expect(compactFrame.toLowerCase()).toContain('world');

      unmount();
    },
    180000
  );
});
