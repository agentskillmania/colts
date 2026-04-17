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

      // 问一个需要工具调用的问题，强制 LLM 调 calculator
      await submitMessage('What is 25 times 37? Use the calculator tool.');
      const frame = await waitForIdle(lastFrame, 90000);

      // 用户消息可见
      expect(frame).toContain('❯');
      expect(frame).toContain('What is 25 times 37?');

      // 工具应该被调用了（第一轮 LLM 会调 calculator）
      expect(frame.toLowerCase()).toContain('calculator');

      // agent 不应该处于运行中状态（已停止）
      expect(frame).not.toContain('Running');

      unmount();
    },
    180000
  );
});
