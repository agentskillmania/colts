/**
 * @fileoverview App-level tool usage with real LLM
 *
 * User Story: User asks a question that requires tool use.
 * The LLM calls the calculator tool, user sees the tool execution in TUI,
 * and the agent returns the correct answer based on the tool result.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { AgentRunner, calculatorTool } from '@agentskillmania/colts';
import { testConfig, itif } from './config.js';
import { createRealRunner, renderApp, submitMessage, waitForIdle } from './app-helpers.js';

describe('Integration: App tool usage with real LLM', () => {
  let runner: AgentRunner;

  beforeAll(() => {
    if (testConfig.enabled) {
      runner = createRealRunner({ tools: [calculatorTool] });
    }
  });

  itif(testConfig.enabled)(
    'LLM calls calculator tool and user sees the answer',
    async () => {
      const { lastFrame, unmount } = renderApp({ runner });

      // 问一个 LLM 不太可能心算正确的乘法
      await submitMessage('What is 25 times 37? Use the calculator tool.');
      const frame = await waitForIdle(lastFrame, 90000);

      // 用户消息和 agent 回复
      expect(frame).toContain('You:');
      expect(frame).toContain('What is 25 times 37?');
      expect(frame).toContain('Agent:');

      // 工具调用应该可见（compact 模式也显示 tool）
      expect(frame.toLowerCase()).toContain('calculator');

      // 最终答案应该包含正确结果 925
      expect(frame).toMatch(/925/);

      unmount();
    },
    180000
  );
});
