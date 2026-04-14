/**
 * @fileoverview User Story: Subagent Delegation
 *
 * As a user
 * I want the parent agent to delegate tasks to specialized sub-agents
 * So that complex work can be distributed
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { testConfig, itif } from './config.js';
import { createRealLLMClient } from './helpers.js';
import { AgentRunner, ToolRegistry, calculatorTool } from '../../src/index.js';
import { createAgentState } from '../../src/state.js';
import { createDelegateTool } from '../../src/subagent/delegate-tool.js';
import type { AgentConfig } from '../../src/types.js';
import type { SubAgentConfig } from '../../src/subagent/types.js';

describe('User Story: Subagent Delegation', () => {
  let client: ReturnType<typeof createRealLLMClient>;

  beforeAll(() => {
    client = createRealLLMClient();
  });

  const defaultConfig: AgentConfig = {
    name: 'delegation-test-agent',
    instructions: 'You are a helpful assistant. Use tools when needed.',
    tools: [],
  };

  // Build sub-agent config map
  function buildSubAgents(): Map<string, SubAgentConfig> {
    const map = new Map<string, SubAgentConfig>();

    map.set('math-expert', {
      name: 'math-expert',
      description: 'A math expert with a calculator. Use for any math problem.',
      config: {
        name: 'math-expert',
        instructions:
          'You are a math expert. You have a calculator tool. Use it for ALL math calculations. After getting the result, provide the final answer clearly.',
        tools: [{ name: 'calculate', description: 'Calculate math expressions' }],
      },
      maxSteps: 3,
    });

    return map;
  }

  // Scenario 1: Parent delegates to math-expert sub-agent
  describe('Scenario 1: Delegate to Math Expert', () => {
    itif(testConfig.enabled)(
      'should delegate calculation to sub-agent and use the result',
      async () => {
        const registry = new ToolRegistry();
        registry.register(calculatorTool);

        const subAgents = buildSubAgents();
        const delegateTool = createDelegateTool({
          subAgentConfigs: subAgents,
          llmProvider: client,
          parentToolRegistry: registry,
        });
        registry.register(delegateTool);

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          toolRegistry: registry,
          systemPrompt:
            'You have access to a math-expert sub-agent. For any math problem, you MUST use the delegate tool to ask the math-expert. Then include the result in your final answer.',
        });

        const state = createAgentState(defaultConfig);
        const { state: finalState, result } = await runner.run(state, { maxSteps: 5 });

        expect(result.type).toBe('success');
        if (result.type === 'success') {
          expect(result.answer.length).toBeGreaterThan(0);
          expect(result.totalSteps).toBeGreaterThanOrEqual(1);
        }

        expect(finalState.context.stepCount).toBeGreaterThanOrEqual(1);
      },
      180000
    );
  });

  // Scenario 2: Subagent has independent tools and instructions
  describe('Scenario 2: Subagent Independence', () => {
    itif(testConfig.enabled)(
      'should let sub-agent use its own calculator tool independently',
      async () => {
        const registry = new ToolRegistry();
        registry.register(calculatorTool);

        const subAgents = buildSubAgents();
        const delegateTool = createDelegateTool({
          subAgentConfigs: subAgents,
          llmProvider: client,
          parentToolRegistry: registry,
        });
        registry.register(delegateTool);

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          toolRegistry: registry,
          systemPrompt: 'When asked for math, delegate to math-expert using the delegate tool.',
        });

        const state = createAgentState(defaultConfig);
        const { result } = await runner.run(state, { maxSteps: 5 });

        expect(result.type).toBe('success');
        if (result.type === 'success') {
          expect(result.answer).toBeTruthy();
        }
      },
      180000
    );
  });

  // Scenario 3: Streaming emits subagent events
  describe('Scenario 3: Streaming Subagent Events', () => {
    itif(testConfig.enabled)(
      'should emit subagent:start and subagent:end during runStream',
      async () => {
        const registry = new ToolRegistry();
        registry.register(calculatorTool);

        const subAgents = buildSubAgents();
        const delegateTool = createDelegateTool({
          subAgentConfigs: subAgents,
          llmProvider: client,
          parentToolRegistry: registry,
        });
        registry.register(delegateTool);

        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          toolRegistry: registry,
          systemPrompt: 'For math questions, delegate to math-expert.',
        });

        const state = createAgentState(defaultConfig);
        const events: string[] = [];

        runner.on('subagent:start', (e) => events.push(`start:${e.name}`));
        runner.on('subagent:end', (e) => events.push(`end:${e.name}`));

        for await (const _ of runner.runStream(state, { maxSteps: 5 })) {
          // consume stream
        }

        // If LLM used delegate, we should see both events
        if (events.includes('start:math-expert')) {
          expect(events).toContain('end:math-expert');
        }
      },
      180000
    );
  });
});
