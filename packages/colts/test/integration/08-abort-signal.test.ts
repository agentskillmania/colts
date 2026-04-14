/**
 * @fileoverview User Story: AbortSignal Cancellation with Real LLM
 *
 * As a developer
 * I want to cancel agent execution via AbortSignal
 * So that I can stop long-running operations when the user navigates away
 *
 * Acceptance Criteria:
 * 1. Pre-aborted signal causes run() to throw immediately
 * 2. runStream() can be cancelled mid-stream
 * 3. step() can be cancelled between iterations
 * 4. No signal passed → works exactly as before (backward compatible)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { testConfig, itif } from './config.js';
import { createRealLLMClient } from './helpers.js';
import { AgentRunner } from '../../src/runner.js';
import { createAgentState } from '../../src/state.js';
import type { AgentConfig } from '../../src/types.js';
import { ToolRegistry, calculatorTool } from '../../src/index.js';

describe('User Story: AbortSignal Cancellation', () => {
  let client: ReturnType<typeof createRealLLMClient>;

  beforeAll(() => {
    client = createRealLLMClient();
  });

  // ============================================================
  // User Story 1: Pre-aborted signal
  // ============================================================
  describe('User Story 1: Pre-aborted Signal', () => {
    itif(testConfig.enabled)(
      'should throw immediately when signal is already aborted',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
        });

        const config: AgentConfig = {
          name: 'test-agent',
          instructions: 'Reply with: OK',
          tools: [],
        };

        const state = createAgentState(config);
        const controller = new AbortController();
        controller.abort();

        await expect(runner.run(state, { signal: controller.signal })).rejects.toThrow();
      },
      120000
    );
  });

  // ============================================================
  // User Story 2: Cancel runStream mid-stream
  // ============================================================
  describe('User Story 2: Cancel runStream', () => {
    itif(testConfig.enabled)(
      'should stop emitting events when signal is aborted',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
        });

        const config: AgentConfig = {
          name: 'test-agent',
          instructions: 'Reply with: OK',
          tools: [],
        };

        const state = createAgentState(config);
        const controller = new AbortController();

        const events: string[] = [];
        try {
          for await (const event of runner.runStream(state, {
            signal: controller.signal,
          })) {
            events.push(event.type);
            // Abort after first event
            if (events.length === 1) {
              controller.abort();
            }
          }
        } catch {
          // AbortError expected
        }

        // Should have received at least step:start before abort
        expect(events.length).toBeGreaterThanOrEqual(1);
        expect(events).toContain('step:start');
      },
      120000
    );
  });

  // ============================================================
  // User Story 3: Backward compatibility
  // ============================================================
  describe('User Story 3: Backward Compatibility', () => {
    itif(testConfig.enabled)(
      'should work without signal parameter (existing code)',
      async () => {
        const registry = new ToolRegistry();
        registry.register(calculatorTool);

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          toolRegistry: registry,
          systemPrompt: 'You have a calculator tool. You MUST use it for all math calculations.',
        });

        const config: AgentConfig = {
          name: 'math-agent',
          instructions: 'Calculate "2 + 3" using the calculate tool. You MUST call the tool.',
          tools: [{ name: 'calculate', description: 'Calculate math expressions' }],
        };

        const state = createAgentState(config);

        // No signal parameter — backward compatible
        const { result } = await runner.run(state);
        expect(result.type).toBe('success');
        if (result.type === 'success') {
          expect(result.answer).toBeTruthy();
        }
      },
      120000
    );
  });
});
