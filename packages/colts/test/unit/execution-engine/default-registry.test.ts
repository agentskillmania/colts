/**
 * @fileoverview Default phase handler registry tests
 *
 * Tests createDefaultPhaseHandlers() returns all 10 handlers
 * and they register correctly with PhaseRouter.
 */
import { describe, it, expect } from 'vitest';
import { createDefaultPhaseHandlers } from '../../../src/execution-engine/default-registry.js';
import { PhaseRouter } from '../../../src/execution-engine/router.js';

describe('createDefaultPhaseHandlers', () => {
  it('should return 10 handlers', () => {
    const handlers = createDefaultPhaseHandlers();
    expect(handlers).toHaveLength(10);
  });

  it('should cover all known phase types', () => {
    const expectedTypes = [
      'idle',
      'preparing',
      'calling-llm',
      'llm-response',
      'parsing',
      'parsed',
      'executing-tool',
      'tool-result',
      'completed',
      'error',
    ];

    const handlers = createDefaultPhaseHandlers();
    const router = new PhaseRouter(handlers);

    for (const type of expectedTypes) {
      const handler = router.getHandler(type);
      expect(handler).toBeDefined();
      expect(handler!.canHandle(type)).toBe(true);
    }
  });

  it('should register all handlers without error', () => {
    const handlers = createDefaultPhaseHandlers();
    expect(() => new PhaseRouter(handlers)).not.toThrow();
  });

  it('should have unique handler for each phase type', () => {
    const handlers = createDefaultPhaseHandlers();
    const types = [
      'idle',
      'preparing',
      'calling-llm',
      'llm-response',
      'parsing',
      'parsed',
      'executing-tool',
      'tool-result',
      'completed',
      'error',
    ];

    // Each handler should handle exactly one type
    for (const handler of handlers) {
      const matchingTypes = types.filter((t) => handler.canHandle(t));
      expect(matchingTypes).toHaveLength(1);
    }
  });
});
