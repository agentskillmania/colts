/**
 * Tool Registry unit tests (Step 3)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  ToolRegistry,
  ToolNotFoundError,
  ToolParameterError,
  calculatorTool,
  type Tool,
} from '../../src/tools/index.js';

describe('Tool Registry (Step 3)', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register', () => {
    it('should register a tool', () => {
      const tool: Tool = {
        name: 'test',
        description: 'Test tool',
        parameters: z.object({ value: z.string() }),
        execute: async ({ value }) => value,
      };

      registry.register(tool);

      expect(registry.has('test')).toBe(true);
      expect(registry.get('test')).toBe(tool);
    });

    it('should throw when registering duplicate tool', () => {
      const tool: Tool = {
        name: 'test',
        description: 'Test tool',
        parameters: z.object({}),
        execute: async () => 'done',
      };

      registry.register(tool);

      expect(() => registry.register(tool)).toThrow("Tool 'test' is already registered");
    });

    it('should support different Zod schema types', () => {
      // String schema
      const stringTool: Tool = {
        name: 'stringTool',
        description: 'Test',
        parameters: z.object({ value: z.string() }),
        execute: async () => '',
      };
      registry.register(stringTool);

      // Number schema with default
      const numberTool: Tool = {
        name: 'numberTool',
        description: 'Test',
        parameters: z.object({ value: z.number().default(42) }),
        execute: async () => 0,
      };
      registry.register(numberTool);

      // Enum schema
      const enumTool: Tool = {
        name: 'enumTool',
        description: 'Test',
        parameters: z.object({ value: z.enum(['a', 'b', 'c']) }),
        execute: async () => '',
      };
      registry.register(enumTool);

      expect(registry.size).toBe(3);
    });
  });

  describe('unregister', () => {
    it('should unregister a tool', () => {
      const tool: Tool = {
        name: 'test',
        description: 'Test tool',
        parameters: z.object({}),
        execute: async () => 'done',
      };

      registry.register(tool);
      const removed = registry.unregister('test');

      expect(removed).toBe(true);
      expect(registry.has('test')).toBe(false);
    });

    it('should return false when unregistering non-existent tool', () => {
      const removed = registry.unregister('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('get', () => {
    it('should return tool by name', () => {
      const tool: Tool = {
        name: 'test',
        description: 'Test tool',
        parameters: z.object({}),
        execute: async () => 'done',
      };

      registry.register(tool);
      const retrieved = registry.get('test');

      expect(retrieved).toBe(tool);
    });

    it('should return undefined for non-existent tool', () => {
      const retrieved = registry.get('nonexistent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true for existing tool', () => {
      const tool: Tool = {
        name: 'test',
        description: 'Test tool',
        parameters: z.object({}),
        execute: async () => 'done',
      };

      registry.register(tool);
      expect(registry.has('test')).toBe(true);
    });

    it('should return false for non-existent tool', () => {
      expect(registry.has('nonexistent')).toBe(false);
    });
  });

  describe('getToolNames', () => {
    it('should return all tool names', () => {
      registry.register({
        name: 'tool1',
        description: 'Tool 1',
        parameters: z.object({}),
        execute: async () => '',
      });
      registry.register({
        name: 'tool2',
        description: 'Tool 2',
        parameters: z.object({}),
        execute: async () => '',
      });

      const names = registry.getToolNames();

      expect(names).toContain('tool1');
      expect(names).toContain('tool2');
      expect(names).toHaveLength(2);
    });

    it('should return empty array when no tools', () => {
      expect(registry.getToolNames()).toEqual([]);
    });
  });

  describe('size', () => {
    it('should return number of registered tools', () => {
      expect(registry.size).toBe(0);

      registry.register({
        name: 'tool1',
        description: 'Tool 1',
        parameters: z.object({}),
        execute: async () => '',
      });
      expect(registry.size).toBe(1);

      registry.register({
        name: 'tool2',
        description: 'Tool 2',
        parameters: z.object({}),
        execute: async () => '',
      });
      expect(registry.size).toBe(2);
    });
  });

  describe('execute', () => {
    it('should execute tool with valid parameters', async () => {
      const tool: Tool = {
        name: 'greet',
        description: 'Greet someone',
        parameters: z.object({ name: z.string() }),
        execute: async ({ name }) => `Hello, ${name}!`,
      };

      registry.register(tool);
      const result = await registry.execute('greet', { name: 'Alice' });

      expect(result).toBe('Hello, Alice!');
    });

    it('should throw ToolNotFoundError for non-existent tool', async () => {
      await expect(registry.execute('nonexistent', {})).rejects.toThrow(ToolNotFoundError);
      await expect(registry.execute('nonexistent', {})).rejects.toThrow(
        'Tool not found: nonexistent'
      );
    });

    it('should throw ToolParameterError for invalid parameters', async () => {
      const tool: Tool = {
        name: 'greet',
        description: 'Greet someone',
        parameters: z.object({
          name: z.string(),
          age: z.number().optional(),
        }),
        execute: async () => '',
      };

      registry.register(tool);

      // Missing required field
      await expect(registry.execute('greet', {})).rejects.toThrow(ToolParameterError);

      // Wrong type
      await expect(registry.execute('greet', { name: 123 })).rejects.toThrow(ToolParameterError);
    });

    it('should include detailed error message for validation failure', async () => {
      const tool: Tool = {
        name: 'test',
        description: 'Test tool',
        parameters: z.object({
          name: z.string().min(2),
          age: z.number().positive(),
        }),
        execute: async () => '',
      };

      registry.register(tool);

      try {
        await registry.execute('test', { name: 'a', age: -5 });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ToolParameterError);
        expect((error as ToolParameterError).message).toContain('name');
        expect((error as ToolParameterError).message).toContain('age');
      }
    });

    it('should handle async execute functions', async () => {
      const tool: Tool = {
        name: 'asyncTool',
        description: 'Async tool',
        parameters: z.object({ delay: z.number() }),
        execute: async ({ delay }) => {
          await new Promise((resolve) => setTimeout(resolve, delay));
          return 'done';
        },
      };

      registry.register(tool);
      const result = await registry.execute('asyncTool', { delay: 10 });

      expect(result).toBe('done');
    });

    it('should pass through tool errors', async () => {
      const tool: Tool = {
        name: 'errorTool',
        description: 'Tool that throws',
        parameters: z.object({}),
        execute: async () => {
          throw new Error('Tool execution failed');
        },
      };

      registry.register(tool);

      await expect(registry.execute('errorTool', {})).rejects.toThrow('Tool execution failed');
    });
  });

  describe('toToolSchemas', () => {
    it('should convert tools to OpenAI function format', () => {
      registry.register({
        name: 'greet',
        description: 'Greet someone',
        parameters: z.object({
          name: z.string().describe('Person name'),
          age: z.number().optional().describe('Person age'),
        }),
        execute: async () => '',
      });

      const schemas = registry.toToolSchemas();

      expect(schemas).toHaveLength(1);
      expect(schemas[0]).toMatchObject({
        type: 'function',
        function: {
          name: 'greet',
          description: 'Greet someone',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Person name' },
              age: { type: 'number', description: 'Person age' },
            },
          },
        },
      });
    });

    it('should mark required fields correctly', () => {
      registry.register({
        name: 'test',
        description: 'Test tool',
        parameters: z.object({
          required: z.string(),
          optional: z.string().optional(),
        }),
        execute: async () => '',
      });

      const schemas = registry.toToolSchemas();
      const params = schemas[0].function.parameters as {
        required?: string[];
      };

      // Zod's required field may contain all fields or only required fields
      expect(params.required || []).toContain('required');
    });

    it('should handle empty registry', () => {
      const schemas = registry.toToolSchemas();
      expect(schemas).toEqual([]);
    });

    it('should handle complex Zod types', () => {
      registry.register({
        name: 'complex',
        description: 'Complex tool',
        parameters: z.object({
          enum: z.enum(['a', 'b', 'c']),
          array: z.array(z.string()),
          nested: z.object({
            value: z.number(),
          }),
        }),
        execute: async () => '',
      });

      const schemas = registry.toToolSchemas();
      expect(schemas).toHaveLength(1);

      const params = schemas[0].function.parameters as {
        properties: {
          enum: { anyOf?: Array<{ enum?: string[] }>; enum?: string[] };
          array: { type: string };
          nested: { type: string };
        };
      };

      // Zod enum converted to JSON Schema may be anyOf format or direct enum
      const enumSchema = params.properties.enum;
      const enumValues = enumSchema.enum || enumSchema.anyOf?.[0]?.enum || [];
      expect(enumValues).toEqual(['a', 'b', 'c']);
      expect(params.properties.array.type).toBe('array');
      expect(params.properties.nested.type).toBe('object');
    });
  });

  describe('clear', () => {
    it('should remove all tools', () => {
      registry.register({
        name: 'tool1',
        description: 'Tool 1',
        parameters: z.object({}),
        execute: async () => '',
      });
      registry.register({
        name: 'tool2',
        description: 'Tool 2',
        parameters: z.object({}),
        execute: async () => '',
      });

      expect(registry.size).toBe(2);
      registry.clear();
      expect(registry.size).toBe(0);
      expect(registry.getToolNames()).toEqual([]);
    });
  });

  describe('calculator tool', () => {
    it('should be available as built-in', () => {
      expect(calculatorTool.name).toBe('calculate');
      expect(calculatorTool.description).toContain('Calculate');
    });

    it('should calculate basic expressions', async () => {
      const result = await calculatorTool.execute({ expression: '2 + 2' });
      expect(result).toBe('4');
    });

    it('should calculate complex expressions', async () => {
      expect(await calculatorTool.execute({ expression: '15 * 23' })).toBe('345');
      expect(await calculatorTool.execute({ expression: '2 ** 8' })).toBe('256');
      expect(await calculatorTool.execute({ expression: '(10 + 5) * 2' })).toBe('30');
      expect(await calculatorTool.execute({ expression: '100 % 7' })).toBe('2');
    });

    it('should handle power operator with ^', async () => {
      const result = await calculatorTool.execute({ expression: '2 ^ 10' });
      expect(result).toBe('1024');
    });

    it('should reject invalid characters', async () => {
      await expect(calculatorTool.execute({ expression: 'process.exit()' })).rejects.toThrow(
        'Invalid characters'
      );
    });

    it('should reject assignment', async () => {
      await expect(calculatorTool.execute({ expression: 'x = 5' })).rejects.toThrow(
        'Invalid characters'
      );
    });

    it('should reject function calls', async () => {
      await expect(calculatorTool.execute({ expression: 'alert(1)' })).rejects.toThrow(
        'Invalid characters'
      );
    });

    it('should reject division by zero (Infinity)', async () => {
      await expect(calculatorTool.execute({ expression: '1 / 0' })).rejects.toThrow(
        'invalid number'
      );
    });

    it('should reject 0/0 (NaN)', async () => {
      await expect(calculatorTool.execute({ expression: '0 / 0' })).rejects.toThrow(
        'invalid number'
      );
    });

    it('should handle syntax errors in expression', async () => {
      await expect(calculatorTool.execute({ expression: '2 + * 3' })).rejects.toThrow(
        'Failed to evaluate expression'
      );
    });

    it('should handle incomplete expressions', async () => {
      await expect(calculatorTool.execute({ expression: '2 +' })).rejects.toThrow(
        'Failed to evaluate expression'
      );
    });

    it('should handle non-Error exceptions', async () => {
      // Mock Function constructor to throw non-Error
      const originalFunction = global.Function;
      global.Function = class MockFunction extends originalFunction {
        constructor(...args: string[]) {
          super(...args);
          // Return a function that throws non-Error
          return (() => {
            throw 'string error'; // Non-Error exception
          }) as unknown as MockFunction;
        }
      } as unknown as typeof originalFunction;

      try {
        await expect(calculatorTool.execute({ expression: '1 + 1' })).rejects.toThrow(
          'Failed to evaluate expression'
        );
      } finally {
        global.Function = originalFunction;
      }
    });

    it('should be usable with registry', async () => {
      registry.register(calculatorTool);

      const result = await registry.execute('calculate', { expression: '10 * 5' });
      expect(result).toBe('50');
    });
  });
});
