/**
 * @fileoverview Step 11: ask_human Tool Unit Tests
 *
 * Tests for createAskHumanTool factory function, type validation,
 * and integration with ToolRegistry.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  createAskHumanTool,
  ToolRegistry,
  type AskHumanHandler,
  type HumanResponse,
} from '../../src/index.js';

describe('Step 11: ask_human Tool', () => {
  describe('createAskHumanTool', () => {
    it('should return a tool with correct name and description', () => {
      const handler: AskHumanHandler = vi.fn();
      const tool = createAskHumanTool(handler);

      expect(tool.name).toBe('ask_human');
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe('string');
    });

    it('should return a tool with Zod parameters schema', () => {
      const handler: AskHumanHandler = vi.fn();
      const tool = createAskHumanTool(handler);

      expect(tool.parameters).toBeDefined();
      // Should be a ZodObject
      expect(tool.parameters._def).toBeDefined();
    });

    it('should call handler with questions and context on execute', async () => {
      const handler = vi.fn().mockResolvedValue({
        name: { type: 'direct' as const, value: 'Alice' },
      });

      const tool = createAskHumanTool(handler);

      const result = await tool.execute({
        questions: [{ id: 'name', question: 'What is your name?', type: 'text' }],
        context: 'Need your name for registration',
      });

      expect(handler).toHaveBeenCalledWith({
        questions: [{ id: 'name', question: 'What is your name?', type: 'text' }],
        context: 'Need your name for registration',
      });

      expect(result).toEqual({
        name: { type: 'direct', value: 'Alice' },
      });
    });

    it('should work without context parameter', async () => {
      const handler = vi.fn().mockResolvedValue({});

      const tool = createAskHumanTool(handler);

      await tool.execute({
        questions: [{ id: 'q1', question: 'OK?', type: 'text' }],
      });

      expect(handler).toHaveBeenCalledWith({
        questions: [{ id: 'q1', question: 'OK?', type: 'text' }],
        context: undefined,
      });
    });

    it('should work with empty options object', async () => {
      const handler = vi.fn().mockResolvedValue({});

      const tool = createAskHumanTool(handler);

      await tool.execute(
        {
          questions: [{ id: 'q1', question: 'OK?', type: 'text' }],
        },
        {}
      );

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Question types', () => {
    it('should support text question type', async () => {
      const handler = vi.fn().mockResolvedValue({
        city: { type: 'direct', value: 'Shanghai' },
      });

      const tool = createAskHumanTool(handler);

      const result = await tool.execute({
        questions: [{ id: 'city', question: 'Which city?', type: 'text' }],
      });

      expect(result).toEqual({
        city: { type: 'direct', value: 'Shanghai' },
      });
    });

    it('should support number question type', async () => {
      const handler = vi.fn().mockResolvedValue({
        age: { type: 'direct', value: 25 },
      });

      const tool = createAskHumanTool(handler);

      const result = await tool.execute({
        questions: [{ id: 'age', question: 'How old are you?', type: 'number' }],
      });

      expect(result).toEqual({
        age: { type: 'direct', value: 25 },
      });
    });

    it('should support single-select question type', async () => {
      const handler = vi.fn().mockResolvedValue({
        size: { type: 'direct', value: 'M' },
      });

      const tool = createAskHumanTool(handler);

      const result = await tool.execute({
        questions: [
          {
            id: 'size',
            question: 'Which size?',
            type: 'single-select',
            options: ['S', 'M', 'L'],
          },
        ],
      });

      expect(result).toEqual({
        size: { type: 'direct', value: 'M' },
      });
    });

    it('should support multi-select question type', async () => {
      const handler = vi.fn().mockResolvedValue({
        toppings: { type: 'direct', value: ['cheese', 'mushroom'] },
      });

      const tool = createAskHumanTool(handler);

      const result = await tool.execute({
        questions: [
          {
            id: 'toppings',
            question: 'Which toppings?',
            type: 'multi-select',
            options: ['cheese', 'mushroom', 'olives', 'pepperoni'],
          },
        ],
      });

      expect(result).toEqual({
        toppings: { type: 'direct', value: ['cheese', 'mushroom'] },
      });
    });
  });

  describe('Batch questions', () => {
    it('should handle multiple questions in one call', async () => {
      const handler = vi.fn().mockResolvedValue({
        name: { type: 'direct', value: 'Bob' },
        color: { type: 'direct', value: 'blue' },
      });

      const tool = createAskHumanTool(handler);

      const result = await tool.execute({
        questions: [
          { id: 'name', question: 'Name?', type: 'text' },
          {
            id: 'color',
            question: 'Favorite color?',
            type: 'single-select',
            options: ['red', 'blue', 'green'],
          },
        ],
      });

      expect(handler).toHaveBeenCalledWith({
        questions: [
          { id: 'name', question: 'Name?', type: 'text' },
          {
            id: 'color',
            question: 'Favorite color?',
            type: 'single-select',
            options: ['red', 'blue', 'green'],
          },
        ],
        context: undefined,
      });

      expect(result).toEqual({
        name: { type: 'direct', value: 'Bob' },
        color: { type: 'direct', value: 'blue' },
      });
    });
  });

  describe('Answer modes', () => {
    it('should support direct answer mode', async () => {
      const handler = vi.fn().mockResolvedValue({
        q1: { type: 'direct', value: 'yes' },
      });

      const tool = createAskHumanTool(handler);
      const result = await tool.execute({
        questions: [{ id: 'q1', question: 'Proceed?', type: 'text' }],
      });

      expect(result).toEqual({ q1: { type: 'direct', value: 'yes' } });
    });

    it('should support free-text answer mode', async () => {
      const handler = vi.fn().mockResolvedValue({
        address: { type: 'free-text', value: 'I do not want to provide my address' },
      });

      const tool = createAskHumanTool(handler);
      const result = await tool.execute({
        questions: [{ id: 'address', question: 'Shipping address?', type: 'text' }],
      });

      expect(result).toEqual({
        address: { type: 'free-text', value: 'I do not want to provide my address' },
      });
    });

    it('should support mixed answer modes in one response', async () => {
      const handler = vi.fn().mockResolvedValue({
        address: { type: 'free-text', value: 'Skip this' },
        size: { type: 'direct', value: 'M' },
      });

      const tool = createAskHumanTool(handler);
      const result = await tool.execute({
        questions: [
          { id: 'address', question: 'Address?', type: 'text' },
          { id: 'size', question: 'Size?', type: 'single-select', options: ['S', 'M', 'L'] },
        ],
      });

      expect(result).toEqual({
        address: { type: 'free-text', value: 'Skip this' },
        size: { type: 'direct', value: 'M' },
      });
    });
  });

  describe('ToolRegistry integration', () => {
    it('should be registerable in ToolRegistry', () => {
      const handler: AskHumanHandler = vi.fn();
      const tool = createAskHumanTool(handler);

      const registry = new ToolRegistry();
      registry.register(tool);

      expect(registry.has('ask_human')).toBe(true);
    });

    it('should generate valid tool schema for LLM', () => {
      const handler: AskHumanHandler = vi.fn();
      const tool = createAskHumanTool(handler);

      const registry = new ToolRegistry();
      registry.register(tool);

      const schemas = registry.toToolSchemas();
      expect(schemas).toHaveLength(1);

      const schema = schemas[0];
      expect(schema.type).toBe('function');
      expect(schema.function.name).toBe('ask_human');
      expect(schema.function.description).toBeTruthy();

      // Parameters should have questions and context
      const params = schema.function.parameters as Record<string, unknown>;
      expect(params).toBeDefined();
      expect(params.type).toBe('object');
    });

    it('should be executable via ToolRegistry', async () => {
      const handler = vi.fn().mockResolvedValue({
        q1: { type: 'direct', value: 'hello' },
      });

      const tool = createAskHumanTool(handler);

      const registry = new ToolRegistry();
      registry.register(tool);

      const result = await registry.execute('ask_human', {
        questions: [{ id: 'q1', question: 'Say something', type: 'text' }],
      });

      expect(result).toEqual({
        q1: { type: 'direct', value: 'hello' },
      });
    });

    it('should validate parameters via Zod schema', async () => {
      const handler: AskHumanHandler = vi.fn();
      const tool = createAskHumanTool(handler);

      const registry = new ToolRegistry();
      registry.register(tool);

      // Missing questions array should fail validation
      await expect(registry.execute('ask_human', {})).rejects.toThrow();

      // Empty questions array should fail (min 1)
      await expect(registry.execute('ask_human', { questions: [] })).rejects.toThrow();

      // Invalid question type should fail
      await expect(
        registry.execute('ask_human', {
          questions: [{ id: 'q1', question: 'test', type: 'invalid-type' }],
        })
      ).rejects.toThrow();
    });
  });

  describe('Error handling', () => {
    it('should propagate handler errors', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('User cancelled'));
      const tool = createAskHumanTool(handler);

      await expect(
        tool.execute({
          questions: [{ id: 'q1', question: 'OK?', type: 'text' }],
        })
      ).rejects.toThrow('User cancelled');
    });
  });

  describe('AbortSignal support', () => {
    it('should pass signal to handler', async () => {
      const handler = vi.fn().mockResolvedValue({
        q1: { type: 'direct', value: 'hello' },
      });

      const tool = createAskHumanTool(handler);
      const controller = new AbortController();

      await tool.execute(
        { questions: [{ id: 'q1', question: 'Say something', type: 'text' }] },
        { signal: controller.signal }
      );

      expect(handler).toHaveBeenCalledWith({
        questions: [{ id: 'q1', question: 'Say something', type: 'text' }],
        context: undefined,
        signal: controller.signal,
      });
    });

    it('signal should be undefined without options', async () => {
      const handler = vi.fn().mockResolvedValue({});

      const tool = createAskHumanTool(handler);

      await tool.execute({
        questions: [{ id: 'q1', question: 'OK?', type: 'text' }],
      });

      expect(handler).toHaveBeenCalledWith({
        questions: [{ id: 'q1', question: 'OK?', type: 'text' }],
        context: undefined,
        signal: undefined,
      });
    });

    it('handler receives aborted signal when pre-aborted', async () => {
      const handler = vi.fn().mockResolvedValue({});
      const tool = createAskHumanTool(handler);

      const controller = new AbortController();
      controller.abort();

      // Tool no longer throws on abort; it delegates to the handler
      const result = await tool.execute(
        { questions: [{ id: 'q1', question: 'OK?', type: 'text' }] },
        { signal: controller.signal }
      );

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].signal?.aborted).toBe(true);
      expect(result).toBeDefined();
    });

    it('handler can detect abort via signal', async () => {
      const receivedSignals: (AbortSignal | undefined)[] = [];
      const handler = vi.fn().mockImplementation(async ({ signal }) => {
        receivedSignals.push(signal);
        return { q1: { type: 'direct', value: 'ok' } };
      });

      const tool = createAskHumanTool(handler);
      const controller = new AbortController();

      await tool.execute(
        { questions: [{ id: 'q1', question: 'OK?', type: 'text' }] },
        { signal: controller.signal }
      );

      expect(receivedSignals).toHaveLength(1);
      expect(receivedSignals[0]).toBe(controller.signal);
      expect(receivedSignals[0]!.aborted).toBe(false);
    });
  });
});
