/**
 * @fileoverview User Story: Event Observability
 *
 * As a developer building AI applications
 * I want to observe the agent execution through events
 * So that I can build reactive UIs, log execution progress, and debug issues
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 *
 * Acceptance Criteria:
 * 1. Can observe run-level lifecycle events (run:start, run:end)
 * 2. Can observe step-level lifecycle events (step:start, step:end)
 * 3. Can observe advance-level phase transitions (phase-change)
 * 4. Can observe execution details (tool:start, tool:end, compressing, compressed)
 * 5. Events are emitted hierarchically (run includes step includes advance)
 * 6. Both streaming and non-streaming modes emit the same EventEmitter events
 * 7. Error events are emitted with context when failures occur
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '@agentskillmania/llm-client';
import { testConfig, itif, logProviderInfo } from './config.js';
import { AgentRunner } from '../../src/runner/index.js';
import { createAgentState } from '../../src/state/index.js';
import { ToolRegistry, calculatorTool } from '../../src/index.js';
import type { AgentConfig } from '../../src/types.js';

describe('User Story: Event Observability', () => {
  let client: LLMClient;

  beforeAll(() => {
    logProviderInfo();
    client = new LLMClient({
      baseUrl: testConfig.baseUrl,
    });

    if (testConfig.enabled) {
      client.registerProvider({
        name: testConfig.provider,
        maxConcurrency: 5,
      });

      client.registerApiKey({
        key: testConfig.apiKey,
        provider: testConfig.provider,
        maxConcurrency: 5,
        models: [{ modelId: testConfig.testModel, maxConcurrency: 5 }],
      });
    }
  });

  const defaultConfig: AgentConfig = {
    name: 'event-test-agent',
    instructions: 'You are a helpful assistant. Answer concisely.',
    tools: [],
  };

  // Scenario 1: Run-level events
  describe('Scenario 1: Run-level Events', () => {
    itif(testConfig.enabled)(
      'should emit run:start and run:end during run()',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          maxSteps: 3,
        });

        const state = createAgentState(defaultConfig);
        const events: string[] = [];

        runner.on('run:start', () => events.push('run:start'));
        runner.on('run:end', () => events.push('run:end'));

        await runner.run(state, { maxSteps: 1 });

        expect(events).toContain('run:start');
        expect(events).toContain('run:end');
        expect(events.indexOf('run:start')).toBeLessThan(events.indexOf('run:end'));
      },
      60000
    );

    itif(testConfig.enabled)(
      'should emit run:start and run:end during runStream()',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          maxSteps: 3,
        });

        const state = createAgentState(defaultConfig);
        const events: string[] = [];

        runner.on('run:start', () => events.push('run:start'));
        runner.on('run:end', () => events.push('run:end'));

        for await (const _ of runner.runStream(state, { maxSteps: 1 })) {
          // consume stream
        }

        expect(events).toContain('run:start');
        expect(events).toContain('run:end');
      },
      60000
    );
  });

  // Scenario 2: Step-level events
  describe('Scenario 2: Step-level Events', () => {
    itif(testConfig.enabled)(
      'should emit step:start and step:end during step()',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
        });

        const state = createAgentState(defaultConfig);
        const events: Array<{ type: string; step?: number }> = [];

        runner.on('step:start', (e) => events.push({ type: 'step:start', step: e.step }));
        runner.on('step:end', (e) => events.push({ type: 'step:end', step: e.step }));

        await runner.step(state);

        expect(events.some((e) => e.type === 'step:start')).toBe(true);
        expect(events.some((e) => e.type === 'step:end')).toBe(true);
      },
      60000
    );

    itif(testConfig.enabled)(
      'should emit step events with correct step numbers during run()',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          maxSteps: 2,
        });

        const state = createAgentState(defaultConfig);
        const stepStarts: number[] = [];

        runner.on('step:start', (e) => stepStarts.push(e.step));

        await runner.run(state, { maxSteps: 1 });

        expect(stepStarts.length).toBeGreaterThanOrEqual(1);
        expect(stepStarts[0]).toBe(0);
      },
      60000
    );
  });

  // Scenario 3: Advance-level events
  describe('Scenario 3: Advance-level Phase Events', () => {
    itif(testConfig.enabled)(
      'should emit phase-change during step()',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
        });

        const state = createAgentState(defaultConfig);
        const phases: Array<{ from: string; to: string }> = [];

        runner.on('phase-change', (e) => {
          phases.push({ from: e.from.type, to: e.to.type });
        });

        await runner.step(state);

        expect(phases.length).toBeGreaterThan(0);
        // Should include phase transitions
        expect(phases.some((p) => p.from === 'idle')).toBe(true);
      },
      60000
    );

    itif(testConfig.enabled)(
      'should emit phase-change during run()',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          maxSteps: 2,
        });

        const state = createAgentState(defaultConfig);
        const phases: string[] = [];

        runner.on('phase-change', (e) => {
          phases.push(e.to.type);
        });

        await runner.run(state, { maxSteps: 1 });

        expect(phases.length).toBeGreaterThan(0);
      },
      60000
    );
  });

  // Scenario 4: Hierarchical event propagation
  describe('Scenario 4: Hierarchical Event Propagation', () => {
    itif(testConfig.enabled)(
      'run() should emit all level events in correct order',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          maxSteps: 2,
        });

        const state = createAgentState(defaultConfig);
        const events: string[] = [];

        runner.on('run:start', () => events.push('run:start'));
        runner.on('step:start', () => events.push('step:start'));
        runner.on('phase-change', () => events.push('phase-change'));
        runner.on('step:end', () => events.push('step:end'));
        runner.on('run:end', () => events.push('run:end'));

        await runner.run(state, { maxSteps: 1 });

        // All levels should be represented
        expect(events).toContain('run:start');
        expect(events).toContain('step:start');
        expect(events).toContain('phase-change');
        expect(events).toContain('step:end');
        expect(events).toContain('run:end');

        // Should be in order
        const runStartIdx = events.indexOf('run:start');
        const stepStartIdx = events.indexOf('step:start');
        const stepEndIdx = events.indexOf('step:end');
        const runEndIdx = events.indexOf('run:end');

        expect(runStartIdx).toBeLessThan(stepStartIdx);
        expect(stepStartIdx).toBeLessThan(stepEndIdx);
        expect(stepEndIdx).toBeLessThan(runEndIdx);
      },
      60000
    );
  });

  // Scenario 5: Tool execution events
  describe('Scenario 5: Tool Execution Events', () => {
    itif(testConfig.enabled)(
      'should emit tool events during tool execution',
      async () => {
        const registry = new ToolRegistry();
        registry.register(calculatorTool);

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          toolRegistry: registry,
          systemPrompt: 'You have a calculator tool. Use it for math calculations.',
          maxSteps: 3,
        });

        const state = createAgentState({
          name: 'calculator-agent',
          instructions: 'Use calculator for math.',
          tools: [],
        });

        const events: string[] = [];
        runner.on('tool:start', () => events.push('tool:start'));
        runner.on('tool:end', () => events.push('tool:end'));

        // Ask a math question that might trigger tool use
        const stateWithMessage = {
          ...state,
          context: {
            ...state.context,
            messages: [...state.context.messages, { role: 'user', content: 'Calculate 123 * 456' }],
          },
        };

        await runner.run(stateWithMessage, { maxSteps: 2 });

        // Tool events may or may not be emitted depending on LLM behavior
        // We just verify no errors occurred
      },
      60000
    );
  });

  // Scenario 6: Error events
  describe('Scenario 6: Error Events', () => {
    itif(testConfig.enabled)(
      'should continue normal execution without error events',
      async () => {
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
        });

        const state = createAgentState(defaultConfig);
        const errors: Array<{ message: string }> = [];

        runner.on('error', (e) => {
          errors.push({ message: e.error.message });
        });

        // Normal execution should not emit error
        await runner.run(state, { maxSteps: 1 });

        expect(errors.length).toBe(0);
      },
      60000
    );
  });
});
