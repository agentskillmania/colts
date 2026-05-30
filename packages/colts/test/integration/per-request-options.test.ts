/**
 * @fileoverview User Story: Per-Request Configuration with Real LLM
 *
 * As a developer
 * I want to override model and thinkingEnabled per-request
 * So that I can dynamically control LLM behavior without recreating the runner
 *
 * Acceptance Criteria:
 * 1. Per-request thinkingEnabled overrides runner default in step/run
 * 2. Per-request model override reaches the LLM (verified by successful response)
 * 3. Empty options fall back to runner defaults gracefully
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { testConfig, itif } from './config.js';
import { createRealLLMClient } from './helpers.js';
import { AgentRunner } from '../../src/runner/index.js';
import { createAgentState } from '../../src/state/index.js';
import type { RunOptions, StepOptions } from '../../src/runner/options.js';

describe('User Story: Per-Request Configuration with Real LLM', () => {
  let client: ReturnType<typeof createRealLLMClient>;

  beforeAll(() => {
    client = createRealLLMClient();
  });

  // Scenario 1: Per-request thinkingEnabled override via run()
  describe('Scenario 1: thinkingEnabled override via run()', () => {
    itif(testConfig.enabled)(
      'should complete successfully with thinkingEnabled=true override',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          thinkingEnabled: false,
        });

        const state = createAgentState({
          name: 'test-agent',
          instructions: 'Answer in one word: what is 1+1?',
          tools: [],
        });

        const opts: RunOptions = { thinkingEnabled: true, maxSteps: 1 };
        const { result } = await runner.run(state, opts);

        expect(result.type).toBe('success');
        if (result.type === 'success') {
          expect(result.answer).toBeTruthy();
        }
      }
    );

    itif(testConfig.enabled)(
      'should complete successfully with thinkingEnabled=false (default)',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          thinkingEnabled: false,
        });

        const state = createAgentState({
          name: 'test-agent',
          instructions: 'Answer in one word: what is 2+2?',
          tools: [],
        });

        const opts: RunOptions = { maxSteps: 1 };
        const { result } = await runner.run(state, opts);

        expect(result.type).toBe('success');
        if (result.type === 'success') {
          expect(result.answer).toBeTruthy();
        }
      }
    );
  });

  // Scenario 2: Per-request step() works with and without options
  describe('Scenario 2: step() with per-request options', () => {
    itif(testConfig.enabled)('should complete a step with thinkingEnabled override', async () => {
      const runner = new AgentRunner({
        model: testConfig.testModel,
        llmClient: client,
        thinkingEnabled: false,
      });

      const state = createAgentState({
        name: 'test-agent',
        instructions: 'Answer in one word: what color is the sky?',
        tools: [],
      });

      const stepOpts: StepOptions = { thinkingEnabled: true };
      const { result } = await runner.step(state, undefined, stepOpts);

      expect(result.type).toBe('done');
    });

    itif(testConfig.enabled)(
      'should complete a step with no options (runner defaults)',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
        });

        const state = createAgentState({
          name: 'test-agent',
          instructions: 'Answer in one word: what is the capital of France?',
          tools: [],
        });

        const { result } = await runner.step(state);

        expect(result.type).toBe('done');
      }
    );
  });

  // Scenario 3: runStream() with per-request options
  describe('Scenario 3: runStream() with per-request options', () => {
    itif(testConfig.enabled)(
      'should stream and complete with thinkingEnabled override',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          thinkingEnabled: false,
        });

        const state = createAgentState({
          name: 'test-agent',
          instructions: 'Answer in one word: what is 3+3?',
          tools: [],
        });

        const opts: RunOptions = { thinkingEnabled: true, maxSteps: 1 };
        let tokenCount = 0;
        for await (const event of runner.runStream(state, opts)) {
          if (event.type === 'token') tokenCount++;
        }

        // Should have received at least one token
        expect(tokenCount).toBeGreaterThan(0);
      }
    );
  });
});
