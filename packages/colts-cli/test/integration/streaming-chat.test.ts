/**
 * @fileoverview Real LLM streaming chat integration tests
 *
 * User Story: Streaming Chat with Real LLM
 * As a CLI user, I want to have streaming conversations with a real LLM,
 * ensuring chatStream chunks are correctly accumulated and displayed.
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 *
 * Coverage:
 * 1. chatStream streaming chat — text accumulation, done event, state update
 * 2. stepStream single-step execution — token accumulation, tool:start event
 * 3. Multi-turn conversation context retention
 * 4. Session persistence + restore and continue conversation
 * 5. Error handling (timeout, invalid model)
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  AgentRunner,
  createAgentState,
  serializeState,
  deserializeState,
} from '@agentskillmania/colts';
import type { AgentState, AgentConfig } from '@agentskillmania/colts';
import { testConfig, itif } from './config.js';
import { createRealLLMClient } from './helpers.js';
import { saveSession, loadSession, listSessions } from '../../src/session.js';

describe('Integration: Real LLM streaming chat', () => {
  let client: LLMClient;
  let runner: AgentRunner;

  const defaultConfig: AgentConfig = {
    name: 'streaming-test-agent',
    instructions: 'You are a helpful assistant. Answer concisely in one sentence.',
    tools: [],
  };

  beforeAll(() => {
    client = createRealLLMClient();

    if (testConfig.enabled) {
      runner = new AgentRunner({
        model: testConfig.testModel,
        llmClient: client,
        requestTimeout: 60000,
      });
    }
  });

  // Scenario 1: chatStream streaming chat
  describe('Scenario 1: chatStream streaming chat', () => {
    itif(testConfig.enabled)(
      'chatStream returns multiple text chunks and a final done chunk',
      async () => {
        const state = createAgentState(defaultConfig);
        const chunks: Array<{ type: string; delta?: string; accumulatedContent?: string }> = [];

        for await (const chunk of runner.chatStream(
          state,
          'Say "Hello, World!" and nothing else.'
        )) {
          chunks.push(chunk);
          if (chunk.type === 'text') {
            process.stdout.write(chunk.delta || '');
          }
        }
        console.log('\n--- chatStream complete ---');

        // Verify: at least one text chunk
        const textChunks = chunks.filter((c) => c.type === 'text');
        expect(textChunks.length).toBeGreaterThan(0);

        // Verify: has done chunk
        const doneChunk = chunks.find((c) => c.type === 'done');
        expect(doneChunk).toBeDefined();

        // Verify: final content is non-empty
        const finalContent = doneChunk?.accumulatedContent || '';
        expect(finalContent.length).toBeGreaterThan(0);
        console.log('Final content:', finalContent);
      },
      90000
    );

    itif(testConfig.enabled)(
      'chatStream content accumulates monotonically',
      async () => {
        const state = createAgentState(defaultConfig);
        let lastLength = 0;
        let monotonic = true;

        for await (const chunk of runner.chatStream(state, 'Write one sentence about AI.')) {
          if (chunk.type === 'text' && chunk.accumulatedContent) {
            if (chunk.accumulatedContent.length < lastLength) {
              monotonic = false;
            }
            lastLength = chunk.accumulatedContent.length;
          }
        }

        expect(monotonic).toBe(true);
        expect(lastLength).toBeGreaterThan(5);
      },
      90000
    );

    itif(testConfig.enabled)(
      'chatStream done chunk contains updated AgentState',
      async () => {
        const state = createAgentState(defaultConfig);

        let finalState: AgentState | null = null;
        for await (const chunk of runner.chatStream(state, 'What is 1+1?')) {
          if (chunk.type === 'done') {
            finalState = chunk.state;
          }
        }

        expect(finalState).not.toBeNull();
        expect(finalState!.context.messages).toHaveLength(2);
        expect(finalState!.context.messages[0].role).toBe('user');
        expect(finalState!.context.messages[1].role).toBe('assistant');
        expect(finalState!.context.stepCount).toBe(1);
      },
      90000
    );
  });

  // Scenario 2: Multi-turn conversation context retention
  describe('Scenario 2: Multi-turn conversation context retention', () => {
    itif(testConfig.enabled)(
      'Two consecutive turns, second turn can reference first turn content',
      async () => {
        let state = createAgentState({
          ...defaultConfig,
          instructions: 'Remember what the user tells you. Answer concisely.',
        });

        // First turn
        const chunks1: Array<{ type: string; delta?: string }> = [];
        for await (const chunk of runner.chatStream(state, 'My favorite color is blue.')) {
          chunks1.push(chunk);
          if (chunk.type === 'text') process.stdout.write(chunk.delta || '');
          if (chunk.type === 'done') state = chunk.state;
        }
        console.log('\n--- First turn complete ---');

        expect(state.context.messages).toHaveLength(2);

        // Second turn
        const chunks2: Array<{ type: string; delta?: string }> = [];
        for await (const chunk of runner.chatStream(state, 'What is my favorite color?')) {
          chunks2.push(chunk);
          if (chunk.type === 'text') process.stdout.write(chunk.delta || '');
          if (chunk.type === 'done') state = chunk.state;
        }
        console.log('\n--- Second turn complete ---');

        // Second turn should reference "blue"
        const finalContent = state.context.messages[3]?.content?.toLowerCase() || '';
        console.log('Second turn reply:', finalContent);
        expect(finalContent).toContain('blue');
        expect(state.context.messages).toHaveLength(4);
        expect(state.context.stepCount).toBe(2);
      },
      120000
    );
  });

  // Scenario 3: Session persistence + restore + continue conversation
  describe('Scenario 3: Session persistence + restore + continue conversation', () => {
    const sessionDir = path.join(os.tmpdir(), `colts-intg-session-${Date.now()}`);

    beforeEach(async () => {
      await fs.mkdir(sessionDir, { recursive: true });
    });

    afterEach(async () => {
      try {
        await fs.rm(sessionDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    });

    itif(testConfig.enabled)(
      'Save session → load → continue conversation with intact context',
      async () => {
        // 1. Create state and converse
        let state = createAgentState(defaultConfig);

        for await (const chunk of runner.chatStream(state, 'Remember the number 42.')) {
          if (chunk.type === 'done') state = chunk.state;
        }

        expect(state.context.messages).toHaveLength(2);

        // 2. Save session
        await saveSession(state, sessionDir);

        // 3. Load session
        const loadedState = await loadSession(state.id, sessionDir);
        expect(loadedState.id).toBe(state.id);
        expect(loadedState.context.messages).toHaveLength(2);

        // 4. Continue conversation with loaded state
        let continuedState = loadedState;
        for await (const chunk of runner.chatStream(
          continuedState,
          'What number did I ask you to remember?'
        )) {
          if (chunk.type === 'done') continuedState = chunk.state;
        }

        // 5. Verify reply references "42"
        const reply = continuedState.context.messages[3]?.content?.toLowerCase() || '';
        console.log('Reply after restore:', reply);
        expect(reply).toContain('42');
        expect(continuedState.context.messages).toHaveLength(4);
        expect(continuedState.context.stepCount).toBe(2);

        // 6. Save again and verify listSessions
        await saveSession(continuedState, sessionDir);
        const sessions = await listSessions(sessionDir);
        expect(sessions).toHaveLength(1);
        expect(sessions[0].id).toBe(state.id);
      },
      120000
    );

    itif(testConfig.enabled)(
      'Serialize → deserialize produces identical state',
      async () => {
        let state = createAgentState(defaultConfig);

        for await (const chunk of runner.chatStream(state, 'Say "test".')) {
          if (chunk.type === 'done') state = chunk.state;
        }

        // Serialize → deserialize
        const json = serializeState(state);
        const restored = deserializeState(json);

        // Re-serialize and compare
        const json2 = serializeState(restored);
        expect(json2).toBe(json);

        // Key fields
        expect(restored.id).toBe(state.id);
        expect(restored.context.messages).toHaveLength(2);
        expect(restored.context.stepCount).toBe(state.context.stepCount);
      },
      90000
    );
  });

  // Scenario 4: Error handling
  describe('Scenario 4: Error handling', () => {
    itif(testConfig.enabled)(
      'chatStream returns error chunk or throws for unreachable endpoint',
      async () => {
        // Create a client connected to a non-existent endpoint
        const badClient = new LLMClient({ baseUrl: 'http://127.0.0.1:1' });
        badClient.registerProvider({ name: testConfig.provider, maxConcurrency: 1 });
        badClient.registerApiKey({
          key: 'sk-invalid',
          provider: testConfig.provider,
          maxConcurrency: 1,
          models: [{ modelId: testConfig.testModel, maxConcurrency: 1 }],
        });

        const badRunner = new AgentRunner({
          model: testConfig.testModel,
          llmClient: badClient,
          requestTimeout: 5000,
        });

        const state = createAgentState(defaultConfig);

        let errorThrown = false;
        let errorChunk = false;
        try {
          for await (const chunk of badRunner.chatStream(state, 'Test')) {
            if (chunk.type === 'error') {
              errorChunk = true;
            }
          }
        } catch {
          errorThrown = true;
        }

        expect(errorThrown || errorChunk).toBe(true);
      },
      15000
    );

    itif(testConfig.enabled)(
      'chatStream returns error chunk or throws for invalid model',
      async () => {
        const badRunner = new AgentRunner({
          model: 'nonexistent-model-xyz-123',
          llmClient: client,
          requestTimeout: 10000,
        });

        const state = createAgentState(defaultConfig);

        let errorThrown = false;
        let errorChunk = false;
        try {
          for await (const chunk of badRunner.chatStream(state, 'Test')) {
            if (chunk.type === 'error') {
              errorChunk = true;
            }
          }
        } catch {
          errorThrown = true;
        }

        expect(errorThrown || errorChunk).toBe(true);
      },
      30000
    );
  });
});
