/**
 * @fileoverview App-level max_steps stop with real LLM
 *
 * User Story: User configures maxSteps=1 and asks a question requiring tool use.
 * The agent executes one step (LLM calls calculator), then stops because
 * max steps is reached. User sees the agent did not finish the full answer.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { AgentRunner, calculatorTool } from '@agentskillmania/colts';
import { testConfig, itif } from './config.js';
import { createRealRunner, renderApp, submitMessage, waitForIdle } from './app-helpers.js';

describe('Integration: App max_steps stop with real LLM', () => {
  let runner: AgentRunner;

  beforeAll(() => {
    if (testConfig.enabled) {
      runner = createRealRunner({ tools: [calculatorTool], maxSteps: 1 });
    }
  });

  itif(testConfig.enabled)(
    'Agent stops after 1 step when maxSteps=1 with tool-calling question',
    async () => {
      const { lastFrame, unmount } = renderApp({ runner });

      // Ask a question requiring tool calls, forcing LLM to call calculator
      await submitMessage('What is 25 times 37? Use the calculator tool.');
      const frame = await waitForIdle(lastFrame, 90000);

      // User message visible
      expect(frame).toContain('❯');
      expect(frame).toContain('What is 25 times 37?');

      // Tool should have been called (first round LLM calls calculator)
      expect(frame.toLowerCase()).toContain('calculator');

      // Agent should not be in running state (stopped)
      expect(frame).not.toContain('Running');

      unmount();
    },
    180000
  );
});
