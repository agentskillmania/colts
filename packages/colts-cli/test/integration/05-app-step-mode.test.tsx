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

      // Step mode pauses after each step completes; loop through pauses until final completion
      let frame = '';
      for (let i = 0; i < 10; i++) {
        const state = await waitForPauseOrIdle(lastFrame, 30000);
        frame = state.frame;
        if (state.type === 'idle') break;
        // Paused state, send empty message to continue
        await submitMessage('');
      }

      expect(frame).toContain('❯');
      expect(frame).toContain('What is 2+2?');
      expect(frame).toContain('◀');
      expect(frame).toMatch(/4/);

      unmount();
    },
    180000
  );

  itif(testConfig.enabled)(
    'Advance mode pauses at phase boundaries and resumes to completion',
    async () => {
      const { lastFrame, unmount } = renderApp({ runner });

      await submitMessage('/advance');
      expect(lastFrame()).toContain('ADV');

      // Use a question that does not require tool calls, let LLM answer directly
      await submitMessage('Say exactly the number 42 and nothing else.');

      // Advance mode pauses at each phase boundary; loop until idle
      let frame = '';
      for (let i = 0; i < 20; i++) {
        const state = await waitForPauseOrIdle(lastFrame, 30000);
        frame = state.frame;
        if (state.type === 'idle') break;
        await submitMessage(''); // resume from pause
      }

      expect(frame).toContain('❯');
      expect(frame).toContain('42');

      unmount();
    },
    180000
  );
});
