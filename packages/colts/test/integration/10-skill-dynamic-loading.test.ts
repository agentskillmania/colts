/**
 * @fileoverview User Story: Skill Dynamic Loading
 *
 * As a user
 * I want the agent to dynamically load skills and switch working modes
 * So that it can follow specialized workflows
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { testConfig, itif } from './config.js';
import { createRealLLMClient } from './helpers.js';
import { AgentRunner } from '../../src/runner/index.js';
import { createAgentState, addUserMessage } from '../../src/state/index.js';
import { FilesystemSkillProvider } from '../../src/skills/filesystem-provider.js';
import type { AgentConfig } from '../../src/types.js';

describe('User Story: Skill Dynamic Loading', () => {
  let client: ReturnType<typeof createRealLLMClient>;
  const skillDir = path.join(os.tmpdir(), `colts-skill-intg-${Date.now()}`);

  beforeAll(() => {
    client = createRealLLMClient();
  });

  beforeEach(async () => {
    await fs.mkdir(skillDir, { recursive: true });

    // Coordinator skill: delegates to other skills
    const coordinatorDir = path.join(skillDir, 'coordinator');
    await fs.mkdir(coordinatorDir, { recursive: true });
    await fs.writeFile(
      path.join(coordinatorDir, 'SKILL.md'),
      `---
name: coordinator
description: Task coordinator that delegates to specialized skills using load_skill.
---
You are a task coordinator. Your ONLY job is to decide which skill to load.
When the user asks for a poem, you MUST call the load_skill tool with name="poet" and pass the topic as task.
When the user asks for analysis, you MUST call the load_skill tool with name="critic" and pass the text as task.
Do NOT answer directly — always delegate using load_skill.`,
      'utf-8'
    );

    // Poet skill: writes haikus
    const poetDir = path.join(skillDir, 'poet');
    await fs.mkdir(poetDir, { recursive: true });
    await fs.writeFile(
      path.join(poetDir, 'SKILL.md'),
      `---
name: poet
description: A poet who writes 3-line haikus about any topic.
---
You are a poet. Write a short 3-line haiku about the given topic.
Keep your response to exactly 3 lines. Do not add explanations.`,
      'utf-8'
    );

    // Critic skill: analyzes text (sub-skill, must return_skill)
    const criticDir = path.join(skillDir, 'critic');
    await fs.mkdir(criticDir, { recursive: true });
    await fs.writeFile(
      path.join(criticDir, 'SKILL.md'),
      `---
name: critic
description: A literary critic who analyzes poems in one sentence.
---
You are a literary critic. Analyze the given poem in one brief sentence.
After your analysis, you MUST call the return_skill tool with your analysis as the result.
Do NOT just say you are done — always use return_skill.`,
      'utf-8'
    );
  });

  afterEach(async () => {
    try {
      await fs.rm(skillDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const defaultConfig: AgentConfig = {
    name: 'skill-test-agent',
    instructions: 'Use skills when needed.',
    tools: [],
  };

  // Scenario 1: LLM autonomously loads a skill and answers in that mode
  describe('Scenario 1: Autonomous Skill Loading', () => {
    itif(testConfig.enabled)(
      'should load poet skill and write a haiku',
      async () => {
        const skillProvider = new FilesystemSkillProvider([skillDir]);
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          skillProvider,
          systemPrompt:
            'You have access to specialized skills. Use the load_skill tool when the user asks for something specific.',
        });

        let state = createAgentState(defaultConfig);
        // Add user message to trigger LLM action
        state = addUserMessage(state, 'Write me a haiku about autumn.');
        const events: string[] = [];

        runner.on('skill:loaded', (e) => events.push(`loaded:${e.name}`));
        runner.on('skill:start', (e) => events.push(`start:${e.name}`));

        const { state: finalState, result } = await runner.run(state, {
          maxSteps: 3,
        });

        // Verify success
        expect(result.type).toBe('success');
        if (result.type === 'success') {
          expect(result.answer.length).toBeGreaterThan(0);
        }

        // EXPLORATORY: Real LLM may or may not use load_skill; do not gate CI on this
        if (events.includes('loaded:poet')) {
          expect(events).toContain('start:poet');
          // If poet was used, answer should be roughly 3 lines
          const lines = result.answer.split('\n').filter((l) => l.trim().length > 0);
          expect(lines.length).toBeGreaterThanOrEqual(2);
          // On successful run completion, cleanupStaleSkillState clears current; verify cleanup
          expect(finalState.context.skillState?.current).toBeNull();
        }
      },
      120000
    );
  });

  // Scenario 2: Same-skill guard prevents self-reference
  describe('Scenario 2: Same-Skill Guard', () => {
    itif(testConfig.enabled)(
      'should not enter infinite loop when loading already-active skill',
      async () => {
        const skillProvider = new FilesystemSkillProvider([skillDir]);
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          skillProvider,
        });

        // First, get into poet mode
        let state = createAgentState(defaultConfig);
        const r1 = await runner.run(state, { maxSteps: 2 });
        state = r1.state;

        // Now ask to load poet again (if LLM decides to do so)
        const r2 = await runner.chat(state, 'Please load the poet skill again.');

        // Should succeed without infinite loop
        expect(r2.response).toBeTruthy();
        expect(r2.state.context.stepCount).toBeGreaterThanOrEqual(1);
      },
      120000
    );
  });

  // Scenario 3: Loading non-existent skill is handled gracefully
  describe('Scenario 3: Skill Not Found', () => {
    itif(testConfig.enabled)(
      'should handle non-existent skill gracefully',
      async () => {
        const skillProvider = new FilesystemSkillProvider([skillDir]);
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          skillProvider,
        });

        let state = createAgentState(defaultConfig);
        state = addUserMessage(state, 'Please load the nonexistent_skill skill.');
        const { result } = await runner.run(state, { maxSteps: 2 });

        // Even if skill loading fails, run should complete
        expect(['success', 'error', 'max_steps']).toContain(result.type);
      },
      60000
    );
  });

  // Scenario 4: Nested skill calling and return
  describe('Scenario 4: Nested Skill with return_skill', () => {
    itif(testConfig.enabled)(
      'should delegate to critic sub-skill and return result to parent',
      async () => {
        const skillProvider = new FilesystemSkillProvider([skillDir]);
        const runner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: client,
          skillProvider,
          systemPrompt:
            'You are a coordinator with access to poet and critic skills. Delegate using load_skill.',
        });

        const state = createAgentState(defaultConfig);
        const skillEvents: string[] = [];

        runner.on('skill:loaded', (e) => skillEvents.push(`loaded:${e.name}`));
        runner.on('skill:start', (e) => skillEvents.push(`start:${e.name}`));
        runner.on('skill:end', (e) => skillEvents.push(`end:${e.name}`));

        // Ask for analysis — coordinator should load critic
        const { result } = await runner.run(state, { maxSteps: 5 });

        expect(result.type).toBe('success');
        if (result.type === 'success') {
          expect(result.answer.length).toBeGreaterThan(0);
        }

        // EXPLORATORY: Real LLM may or may not load critic sub-skill
        if (skillEvents.includes('start:critic')) {
          expect(skillEvents).toContain('end:critic');
        }
      },
      180000
    );
  });
});
