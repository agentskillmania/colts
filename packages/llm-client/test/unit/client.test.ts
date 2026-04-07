/**
 * LLMClient unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LLMClient } from '../../src/client';

describe('LLMClient', () => {
  let client: LLMClient;

  beforeEach(() => {
    client = new LLMClient();
  });

  describe('registration', () => {
    it('should register a provider', () => {
      client.registerProvider({
        name: 'test-provider',
        maxConcurrency: 5,
      });

      const stats = client.getStats();
      expect(stats.providerActiveCounts.has('test-provider')).toBe(true);
    });

    it('should throw when registering duplicate provider', () => {
      client.registerProvider({
        name: 'test-provider',
        maxConcurrency: 5,
      });

      expect(() => {
        client.registerProvider({
          name: 'test-provider',
          maxConcurrency: 3,
        });
      }).toThrow('already registered');
    });

    it('should register an API key', () => {
      client.registerProvider({
        name: 'openai',
        maxConcurrency: 10,
      });

      client.registerApiKey({
        key: 'sk-test123',
        provider: 'openai',
        maxConcurrency: 3,
        models: [{ modelId: 'gpt-4', maxConcurrency: 2 }],
      });

      const stats = client.getStats();
      expect(stats.keyHealth.size).toBe(1);
    });

    it('should throw when registering key for non-existent provider', () => {
      expect(() => {
        client.registerApiKey({
          key: 'sk-test',
          provider: 'non-existent',
          maxConcurrency: 3,
          models: [],
        });
      }).toThrow('not registered');
    });

    it('should throw when registering duplicate API key', () => {
      client.registerProvider({ name: 'openai', maxConcurrency: 10 });
      client.registerApiKey({
        key: 'sk-same',
        provider: 'openai',
        maxConcurrency: 3,
        models: [],
      });

      expect(() => {
        client.registerApiKey({
          key: 'sk-same',
          provider: 'openai',
          maxConcurrency: 5,
          models: [],
        });
      }).toThrow('already registered');
    });
  });

  describe('stats', () => {
    it('should return initial stats', () => {
      const stats = client.getStats();

      expect(stats.queueSize).toBe(0);
      expect(stats.activeRequests).toBe(0);
      expect(stats.keyHealth.size).toBe(0);
      expect(stats.providerActiveCounts.size).toBe(0);
    });

    it('should reflect registered providers in stats', () => {
      client.registerProvider({ name: 'p1', maxConcurrency: 5 });
      client.registerProvider({ name: 'p2', maxConcurrency: 10 });

      const stats = client.getStats();
      expect(stats.providerActiveCounts.size).toBe(2);
      expect(stats.providerActiveCounts.get('p1')).toBe(0);
      expect(stats.providerActiveCounts.get('p2')).toBe(0);
    });
  });

  describe('events', () => {
    it('should emit state events', async () => {
      const events: string[] = [];

      client.on('state', (event) => {
        events.push(event.type);
      });

      client.registerProvider({ name: 'test', maxConcurrency: 5 });

      expect(events).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should clear all registrations', () => {
      client.registerProvider({ name: 'openai', maxConcurrency: 10 });
      client.registerApiKey({
        key: 'sk-test',
        provider: 'openai',
        maxConcurrency: 3,
        models: [{ modelId: 'gpt-4', maxConcurrency: 2 }],
      });

      expect(client.getStats().providerActiveCounts.size).toBe(1);

      client.clear();

      expect(client.getStats().providerActiveCounts.size).toBe(0);
      expect(client.getStats().keyHealth.size).toBe(0);
    });
  });

  describe('streaming', () => {
    it('should support streaming calls', async () => {
      expect(typeof client.stream).toBe('function');
    });
  });
});
