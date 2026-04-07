/**
 * User Story 2: Real-time Typewriter Effect (Streaming)
 *
 * As a frontend developer
 * I want to receive LLM output character by character in real-time
 * So that I can show a typewriter effect to improve UX
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '../../src/client';
import { testConfig, itif } from './config';

describe('Integration: Streaming (User Story 2)', () => {
  let client: LLMClient;

  beforeAll(() => {
    client = new LLMClient();

    if (testConfig.enabled) {
      client.registerProvider({
        name: 'openai',
        maxConcurrency: 5,
      });

      client.registerApiKey({
        key: testConfig.openaiApiKey,
        provider: 'openai',
        maxConcurrency: 3,
        models: [
          {
            modelId: testConfig.testModel,
            maxConcurrency: 2,
          },
        ],
      });
    }
  });

  itif(testConfig.enabled)(
    'should stream response with delta and accumulated content',
    async () => {
      // Given: A streaming request
      const messages = [{ role: 'user' as const, content: 'Count from 1 to 3: 1, 2, 3' }];

      // When: Stream the response
      const events: Array<{
        type: string;
        delta?: string;
        accumulatedContent?: string;
        tokens?: { input: number; output: number };
      }> = [];

      for await (const event of client.stream({
        model: testConfig.testModel,
        messages,
      })) {
        events.push(event);

        // Simulate real-time display (typewriter effect)
        if (event.delta) {
          process.stdout.write(event.delta);
        }
      }
      process.stdout.write('\n');

      // Then: Verify streaming events
      const textEvents = events.filter((e) => e.type === 'text');
      expect(textEvents.length).toBeGreaterThan(0);

      // Verify delta accumulates correctly
      const lastTextEvent = textEvents[textEvents.length - 1];
      expect(lastTextEvent.accumulatedContent).toBeDefined();
      expect(lastTextEvent.accumulatedContent!.length).toBeGreaterThan(0);

      // Verify final done event
      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
      expect(doneEvent!.tokens).toBeDefined();
      expect(doneEvent!.tokens!.input).toBeGreaterThan(0);
      expect(doneEvent!.tokens!.output).toBeGreaterThan(0);

      console.log('Total events received:', events.length);
      console.log('Final tokens:', doneEvent!.tokens);
    },
    60000
  );

  itif(testConfig.enabled)(
    'should support requestId in streaming for tracing',
    async () => {
      // Given: A trace ID
      const traceId = `stream-test-${Date.now()}`;
      const receivedRequestIds: string[] = [];

      // Listen to state events
      client.on('state', (event) => {
        if (event.requestId) {
          receivedRequestIds.push(event.requestId);
        }
      });

      // When: Stream with custom requestId
      const events: Array<{ type: string }> = [];
      for await (const event of client.stream({
        model: testConfig.testModel,
        messages: [{ role: 'user' as const, content: 'Hi' }],
        requestId: traceId,
      })) {
        events.push(event);
      }

      // Then: Verify requestId is propagated
      expect(receivedRequestIds).toContain(traceId);
      console.log('Trace ID verified:', traceId);
    },
    60000
  );

  itif(testConfig.enabled)(
    'should handle streaming with total timeout',
    async () => {
      // Given: A long response with short total timeout
      const messages = [
        { role: 'user' as const, content: 'Write a very long story about space exploration.' },
      ];

      // When & Then: Should timeout including queue wait
      const events: Array<{ type: string }> = [];

      await expect(async () => {
        for await (const event of client.stream({
          model: testConfig.testModel,
          messages,
          totalTimeout: 1, // 1ms - intentionally short
        })) {
          events.push(event);
        }
      }).rejects.toThrow('timeout');
    },
    10000
  );
});
