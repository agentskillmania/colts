/**
 * @fileoverview App-level step and advance mode with real LLM
 *
 * End-to-end user story: a CLI user switches to step/advance mode and
 * watches the agent execute one ReAct cycle or phase at a time.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { AgentRunner, calculatorTool } from '@agentskillmania/colts';
import { testConfig, itif } from './config.js';
import {
  createRealRunner,
  renderApp,
  submitMessage,
  waitForIdle,
  waitForPauseOrIdle,
} from './app-helpers.js';

describe('Integration: App step/advance mode with real LLM', () => {
  let runner: AgentRunner;

  beforeAll(() => {
    if (testConfig.enabled) {
      runner = createRealRunner({ tools: [calculatorTool] });
    }
  });

  itif(testConfig.enabled)(
    'Step mode answers a simple question directly',
    async () => {
      const { lastFrame, unmount } = renderApp({ runner });

      await submitMessage('/step');
      expect(lastFrame()).toContain('STEP');

      await submitMessage('What is 2+2?');
      const frame = await waitForIdle(lastFrame, 90000);

      expect(frame).toContain('You:');
      expect(frame).toContain('What is 2+2?');
      expect(frame).toContain('Agent:');
      expect(frame).toMatch(/4/);

      unmount();
    },
    120000
  );

  itif(testConfig.enabled)(
    'Advance mode pauses at phase boundaries and resumes to completion',
    async () => {
      const { lastFrame, unmount } = renderApp({ runner });

      await submitMessage('/advance');
      expect(lastFrame()).toContain('ADV');

      await submitMessage('What is 3+3?');

      // Advance mode pauses after each phase change; loop until idle
      let frame = '';
      for (let i = 0; i < 15; i++) {
        const state = await waitForPauseOrIdle(lastFrame, 20000);
        frame = state.frame;
        if (state.type === 'idle') break;
        await submitMessage(''); // resume from pause
      }

      expect(frame).toContain('You:');
      expect(frame).toContain('What is 3+3?');
      expect(frame).toContain('Agent:');
      expect(frame).toMatch(/6/);

      unmount();
    },
    180000
  );
});
