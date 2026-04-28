/**
 * @fileoverview User Story: Middleware
 *
 * As a developer building AI applications
 * I want to inject middleware at advance/step/run levels
 * So that I can implement cross-cutting concerns like audit logging,
 * security guardrails, and budget tracking without modifying core logic
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 *
 * Acceptance Criteria:
 * 1. Can observe run lifecycle via beforeRun/afterRun
 * 2. Can observe step lifecycle via beforeStep/afterStep
 * 3. Can observe advance lifecycle via beforeAdvance/afterAdvance (when calling advance() directly)
 * 4. before hooks run in registration order, after hooks in reverse order
 * 5. Can override state in before/after hooks
 * 6. Can stop execution via stop signal in before hooks
 * 7. Can add middleware at runtime via use()
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '@agentskillmania/llm-client';
import { testConfig, itif, logProviderInfo } from './config.js';
import { AgentRunner } from '../../src/runner/index.js';
import { createAgentState, addUserMessage } from '../../src/state/index.js';
import { createExecutionState } from '../../src/execution/index.js';
import type { AgentConfig } from '../../src/types.js';
import type { AgentMiddleware } from '../../src/middleware/types.js';
import { ToolRegistry, calculatorTool } from '../../src/index.js';

describe('User Story: Middleware', () => {
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
    name: 'middleware-test-agent',
    instructions: 'You are a helpful assistant. Answer concisely in one sentence.',
    tools: [],
  };

  const toolConfig: AgentConfig = {
    name: 'middleware-tool-agent',
    instructions:
      'You are a helpful assistant. When asked to calculate, use the calculator tool. Otherwise answer concisely.',
    tools: [{ name: 'calculate', description: 'Calculate math expressions' }],
  };

  // Scenario 1: Audit logging — observe all three levels via run()
  describe('Scenario 1: Audit Logging Middleware', () => {
    itif(testConfig.enabled)(
      'should observe run, step, and advance level lifecycle hooks during run()',
      async () => {
        const auditLog: Array<{ hook: string; timestamp: number }> = [];

        const auditMw: AgentMiddleware = {
          name: 'audit',
          beforeRun: async () => {
            auditLog.push({ hook: 'beforeRun', timestamp: Date.now() });
          },
          beforeStep: async () => {
            auditLog.push({ hook: 'beforeStep', timestamp: Date.now() });
          },
          beforeAdvance: async () => {
            auditLog.push({ hook: 'beforeAdvance', timestamp: Date.now() });
          },
          afterAdvance: async () => {
            auditLog.push({ hook: 'afterAdvance', timestamp: Date.now() });
          },
          afterStep: async () => {
            auditLog.push({ hook: 'afterStep', timestamp: Date.now() });
          },
          afterRun: async () => {
            auditLog.push({ hook: 'afterRun', timestamp: Date.now() });
          },
        };

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          middleware: [auditMw],
          maxSteps: 3,
        });

        const state = addUserMessage(createAgentState(defaultConfig), 'Say hello.');

        await runner.run(state, { maxSteps: 1 });

        // Must have run-level hooks
        expect(auditLog.some((e) => e.hook === 'beforeRun')).toBe(true);
        expect(auditLog.some((e) => e.hook === 'afterRun')).toBe(true);

        // Must have step-level hooks
        expect(auditLog.some((e) => e.hook === 'beforeStep')).toBe(true);
        expect(auditLog.some((e) => e.hook === 'afterStep')).toBe(true);

        // Must have advance-level hooks (step() now delegates to advance())
        expect(auditLog.some((e) => e.hook === 'beforeAdvance')).toBe(true);
        expect(auditLog.some((e) => e.hook === 'afterAdvance')).toBe(true);

        // Hooks must be ordered: beforeRun → beforeStep → beforeAdvance → afterAdvance → afterStep → afterRun
        const hookNames = auditLog.map((e) => e.hook);
        const firstBeforeRun = hookNames.indexOf('beforeRun');
        const firstBeforeStep = hookNames.indexOf('beforeStep');
        const firstBeforeAdvance = hookNames.indexOf('beforeAdvance');
        const firstAfterAdvance = hookNames.indexOf('afterAdvance');
        const firstAfterStep = hookNames.indexOf('afterStep');
        const firstAfterRun = hookNames.indexOf('afterRun');

        expect(firstBeforeRun).toBeLessThan(firstBeforeStep);
        expect(firstBeforeStep).toBeLessThan(firstBeforeAdvance);
        expect(firstBeforeAdvance).toBeLessThan(firstAfterAdvance);
        expect(firstAfterAdvance).toBeLessThan(firstAfterStep);
        expect(firstAfterStep).toBeLessThan(firstAfterRun);
      },
      60000
    );
  });

  // Scenario 2: Advance-level hooks via advance() method
  describe('Scenario 2: Advance-Level Hooks', () => {
    itif(testConfig.enabled)(
      'should observe beforeAdvance and afterAdvance when calling advance() directly',
      async () => {
        const phases: string[] = [];

        const mw: AgentMiddleware = {
          name: 'phase-tracker',
          beforeAdvance: async (ctx) => {
            phases.push('before:' + ctx.fromPhase.type);
          },
          afterAdvance: async (ctx) => {
            phases.push('after:' + ctx.result.phase.type);
          },
        };

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          middleware: [mw],
          maxSteps: 3,
        });

        const state = addUserMessage(createAgentState(defaultConfig), 'Say hello.');
        const execState = createExecutionState();

        // Advance from idle → preparing
        const result = await runner.advance(state, execState);

        expect(phases).toContain('before:idle');
        expect(phases.length).toBeGreaterThanOrEqual(2);
        // Result should have progressed past idle
        expect(result.phase.type).not.toBe('idle');
      },
      60000
    );
  });

  // Scenario 3: Execution order — before in order, after in reverse
  describe('Scenario 3: Hook Execution Order', () => {
    itif(testConfig.enabled)(
      'should run before hooks in registration order and after hooks in reverse',
      async () => {
        const order: string[] = [];

        const mw1: AgentMiddleware = {
          name: 'mw1',
          beforeRun: async () => {
            order.push('mw1:beforeRun');
          },
          afterRun: async () => {
            order.push('mw1:afterRun');
          },
        };
        const mw2: AgentMiddleware = {
          name: 'mw2',
          beforeRun: async () => {
            order.push('mw2:beforeRun');
          },
          afterRun: async () => {
            order.push('mw2:afterRun');
          },
        };

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          middleware: [mw1, mw2],
          maxSteps: 3,
        });

        const state = addUserMessage(createAgentState(defaultConfig), 'Say hi.');

        await runner.run(state, { maxSteps: 1 });

        // before: mw1 then mw2, after: mw2 then mw1
        expect(order.indexOf('mw1:beforeRun')).toBeLessThan(order.indexOf('mw2:beforeRun'));
        expect(order.indexOf('mw2:afterRun')).toBeLessThan(order.indexOf('mw1:afterRun'));
      },
      60000
    );
  });

  // Scenario 4: State override
  describe('Scenario 4: State Override', () => {
    itif(testConfig.enabled)(
      'should apply state override from beforeRun middleware',
      async () => {
        let capturedName = '';

        const mw: AgentMiddleware = {
          name: 'override',
          beforeRun: async (ctx) => {
            capturedName = ctx.state.config.name;
            // Override with modified config
            const overridden = createAgentState({
              ...defaultConfig,
              name: 'overridden-agent',
            });
            return { state: addUserMessage(overridden, 'Reply with exactly: OVERRIDDEN') };
          },
        };

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          middleware: [mw],
          maxSteps: 3,
        });

        const state = addUserMessage(createAgentState(defaultConfig), 'Say something.');

        const { result } = await runner.run(state, { maxSteps: 1 });

        // The original state's name was captured before override
        expect(capturedName).toBe('middleware-test-agent');
        // The run should succeed with the overridden state
        expect(result.type).toBe('success');
      },
      60000
    );
  });

  // Scenario 5: Security guardrail — stop execution
  describe('Scenario 5: Security Guardrail (Stop)', () => {
    itif(testConfig.enabled)(
      'should stop execution when beforeRun returns stop:true',
      async () => {
        const mw: AgentMiddleware = {
          name: 'guard',
          beforeRun: async () => {
            return { stop: true as const };
          },
        };

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          middleware: [mw],
          maxSteps: 3,
        });

        const state = addUserMessage(createAgentState(defaultConfig), 'Do something.');

        const { result } = await runner.run(state, { maxSteps: 1 });

        expect(result.type).toBe('error');
        if (result.type === 'error') {
          expect(result.error.message).toContain('Stopped by middleware');
        }
      },
      60000
    );

    itif(testConfig.enabled)(
      'should stop execution when beforeStep returns stop:true',
      async () => {
        const mw: AgentMiddleware = {
          name: 'step-guard',
          beforeStep: async () => {
            return { stop: true as const };
          },
        };

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          middleware: [mw],
          maxSteps: 5,
        });

        const state = addUserMessage(createAgentState(defaultConfig), 'Say hello.');

        const { result } = await runner.run(state, { maxSteps: 5 });

        // Should be stopped by middleware before any step runs
        expect(result.type).toBe('error');
        if (result.type === 'error') {
          expect(result.error.message).toContain('Stopped by middleware');
        }
      },
      60000
    );
  });

  // Scenario 6: Step-level observability with tool calls
  describe('Scenario 6: Step Observability with Tool Calls', () => {
    itif(testConfig.enabled)(
      'should observe step results including tool execution',
      async () => {
        const stepResults: string[] = [];

        const mw: AgentMiddleware = {
          name: 'step-observer',
          afterStep: async (ctx) => {
            stepResults.push(ctx.result.type);
          },
        };

        const registry = new ToolRegistry();
        registry.register(calculatorTool);

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          middleware: [mw],
          maxSteps: 5,
          toolRegistry: registry,
        });

        const state = addUserMessage(createAgentState(toolConfig), 'What is 2 + 3?');

        await runner.run(state, { maxSteps: 5 });

        // Should have at least one 'continue' (tool call) and one 'done'
        expect(stepResults).toContain('continue');
        expect(stepResults).toContain('done');
      },
      60000
    );
  });

  // Scenario 7: Runtime middleware addition via use()
  describe('Scenario 7: Runtime Middleware Addition', () => {
    itif(testConfig.enabled)(
      'should invoke middleware added at runtime via use()',
      async () => {
        let hookCalled = false;

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          maxSteps: 3,
        });

        // No middleware at construction time
        expect(runner.getMiddlewares()).toHaveLength(0);

        // Add at runtime
        const mw: AgentMiddleware = {
          name: 'dynamic',
          beforeRun: async () => {
            hookCalled = true;
          },
        };
        runner.use(mw);

        expect(runner.getMiddlewares()).toHaveLength(1);

        const state = addUserMessage(createAgentState(defaultConfig), 'Hello.');

        await runner.run(state, { maxSteps: 1 });

        expect(hookCalled).toBe(true);
      },
      60000
    );
  });

  // Scenario 8: Streaming middleware — stepStream
  describe('Scenario 8: stepStream Middleware Hooks', () => {
    itif(testConfig.enabled)(
      'should fire beforeStep, afterStep, beforeAdvance, and afterAdvance during stepStream()',
      async () => {
        const hooks: string[] = [];

        const mw: AgentMiddleware = {
          name: 'stream-audit',
          beforeStep: async () => {
            hooks.push('beforeStep');
          },
          afterStep: async () => {
            hooks.push('afterStep');
          },
          beforeAdvance: async () => {
            hooks.push('beforeAdvance');
          },
          afterAdvance: async () => {
            hooks.push('afterAdvance');
          },
        };

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          middleware: [mw],
          maxSteps: 3,
        });

        const state = addUserMessage(createAgentState(defaultConfig), 'Say hello.');
        const iterator = runner.stepStream(state);

        // Drain the generator
        while (true) {
          const { done } = await iterator.next();
          if (done) break;
        }

        expect(hooks).toContain('beforeStep');
        expect(hooks).toContain('afterStep');
        expect(hooks).toContain('beforeAdvance');
        expect(hooks).toContain('afterAdvance');

        // Ordering: beforeStep before beforeAdvance, afterAdvance before afterStep
        expect(hooks.indexOf('beforeStep')).toBeLessThan(hooks.indexOf('beforeAdvance'));
        expect(hooks.indexOf('afterAdvance')).toBeLessThan(hooks.indexOf('afterStep'));
      },
      60000
    );
  });

  // Scenario 9: Streaming middleware — runStream with all three levels
  describe('Scenario 9: runStream Middleware Hooks', () => {
    itif(testConfig.enabled)(
      'should fire run, step, and advance level hooks during runStream()',
      async () => {
        const hooks: string[] = [];

        const mw: AgentMiddleware = {
          name: 'stream-full-audit',
          beforeRun: async () => {
            hooks.push('beforeRun');
          },
          afterRun: async () => {
            hooks.push('afterRun');
          },
          beforeStep: async () => {
            hooks.push('beforeStep');
          },
          afterStep: async () => {
            hooks.push('afterStep');
          },
          beforeAdvance: async () => {
            hooks.push('beforeAdvance');
          },
          afterAdvance: async () => {
            hooks.push('afterAdvance');
          },
        };

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          middleware: [mw],
          maxSteps: 3,
        });

        const state = addUserMessage(createAgentState(defaultConfig), 'Say hello.');
        const iterator = runner.runStream(state, { maxSteps: 1 });

        // Drain the generator
        while (true) {
          const { done } = await iterator.next();
          if (done) break;
        }

        // All three levels must fire
        expect(hooks).toContain('beforeRun');
        expect(hooks).toContain('afterRun');
        expect(hooks).toContain('beforeStep');
        expect(hooks).toContain('afterStep');
        expect(hooks).toContain('beforeAdvance');
        expect(hooks).toContain('afterAdvance');

        // Ordering: beforeRun → beforeStep → beforeAdvance → afterAdvance → afterStep → afterRun
        expect(hooks.indexOf('beforeRun')).toBeLessThan(hooks.indexOf('beforeStep'));
        expect(hooks.indexOf('beforeStep')).toBeLessThan(hooks.indexOf('beforeAdvance'));
        expect(hooks.indexOf('afterAdvance')).toBeLessThan(hooks.indexOf('afterStep'));
        expect(hooks.indexOf('afterStep')).toBeLessThan(hooks.indexOf('afterRun'));
      },
      60000
    );

    itif(testConfig.enabled)(
      'should stop runStream when beforeStep returns stop',
      async () => {
        const mw: AgentMiddleware = {
          name: 'stream-step-guard',
          beforeStep: async () => {
            return { stop: true as const };
          },
        };

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          middleware: [mw],
          maxSteps: 5,
        });

        const state = addUserMessage(createAgentState(defaultConfig), 'Say hello.');
        const iterator = runner.runStream(state, { maxSteps: 5 });

        // Drain
        let finalResult: import('../../src/execution/index.js').RunResult | undefined;
        while (true) {
          const { done, value } = await iterator.next();
          if (done) {
            finalResult = value.result;
            break;
          }
        }

        expect(finalResult!.type).toBe('error');
        if (finalResult!.type === 'error') {
          expect(finalResult!.error.message).toContain('Stopped by middleware');
        }
      },
      60000
    );
  });
});
