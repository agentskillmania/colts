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

      // Step 模式会在每个 step 完成后暂停，需要循环处理暂停直到最终完成
      let frame = '';
      for (let i = 0; i < 10; i++) {
        const state = await waitForPauseOrIdle(lastFrame, 30000);
        frame = state.frame;
        if (state.type === 'idle') break;
        // 暂停状态，发空消息继续
        await submitMessage('');
      }

      expect(frame).toContain('You:');
      expect(frame).toContain('What is 2+2?');
      expect(frame).toContain('Agent:');
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

      // 用一个不需要工具调用的问题，让 LLM 直接回答
      await submitMessage('Say exactly the number 42 and nothing else.');

      // Advance mode 在每个 phase boundary 暂停，循环处理直到 idle
      let frame = '';
      for (let i = 0; i < 20; i++) {
        const state = await waitForPauseOrIdle(lastFrame, 30000);
        frame = state.frame;
        if (state.type === 'idle') break;
        await submitMessage(''); // resume from pause
      }

      expect(frame).toContain('You:');
      expect(frame).toContain('42');

      unmount();
    },
    180000
  );
});
