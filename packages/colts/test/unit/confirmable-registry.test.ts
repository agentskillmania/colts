/**
 * @fileoverview Step 11: ConfirmableRegistry Unit Tests
 *
 * Tests for the registry wrapper that requires human confirmation
 * before executing specified tools.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry, ConfirmableRegistry, type ConfirmHandler } from '../../src/index.js';

function createInnerRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register({
    name: 'calculate',
    description: 'Calculate math expression',
    parameters: z.object({ expression: z.string() }),
    execute: async ({ expression }: { expression: string }) => eval(expression).toString(),
  });

  registry.register({
    name: 'delete_file',
    description: 'Delete a file',
    parameters: z.object({ path: z.string() }),
    execute: async ({ path }: { path: string }) => `Deleted: ${path}`,
  });

  registry.register({
    name: 'send_email',
    description: 'Send an email',
    parameters: z.object({ to: z.string(), body: z.string() }),
    execute: async ({ to }: { to: string }) => `Email sent to ${to}`,
  });

  return registry;
}

describe('ConfirmableRegistry', () => {
  describe('execute', () => {
    it('should allow execution of non-confirmed tools without confirmation', async () => {
      const inner = createInnerRegistry();
      const confirm = vi.fn().mockResolvedValue(true);

      const registry = new ConfirmableRegistry(inner, {
        confirmTools: ['delete_file', 'send_email'],
        confirm,
      });

      const result = await registry.execute('calculate', { expression: '2+2' });

      expect(result).toBe('4');
      expect(confirm).not.toHaveBeenCalled();
    });

    it('should require confirmation for listed tools', async () => {
      const inner = createInnerRegistry();
      const confirm = vi.fn().mockResolvedValue(true);

      const registry = new ConfirmableRegistry(inner, {
        confirmTools: ['delete_file'],
        confirm,
      });

      const result = await registry.execute('delete_file', { path: '/tmp/test.txt' });

      expect(confirm).toHaveBeenCalledWith('delete_file', { path: '/tmp/test.txt' });
      expect(result).toBe('Deleted: /tmp/test.txt');
    });

    it('should reject execution when human denies confirmation', async () => {
      const inner = createInnerRegistry();
      const confirm = vi.fn().mockResolvedValue(false);

      const registry = new ConfirmableRegistry(inner, {
        confirmTools: ['delete_file'],
        confirm,
      });

      await expect(
        registry.execute('delete_file', { path: '/important/data.txt' })
      ).rejects.toThrow('Tool execution rejected by human');
    });

    it('should pass tool name and args to confirm handler', async () => {
      const inner = createInnerRegistry();
      const confirm = vi.fn().mockResolvedValue(true);

      const registry = new ConfirmableRegistry(inner, {
        confirmTools: ['send_email'],
        confirm,
      });

      await registry.execute('send_email', { to: 'user@example.com', body: 'Hello' });

      expect(confirm).toHaveBeenCalledWith('send_email', {
        to: 'user@example.com',
        body: 'Hello',
      });
    });
  });

  describe('delegation', () => {
    it('should delegate toToolSchemas to inner registry', () => {
      const inner = createInnerRegistry();
      const confirm = vi.fn().mockResolvedValue(true);

      const registry = new ConfirmableRegistry(inner, {
        confirmTools: ['delete_file'],
        confirm,
      });

      const schemas = registry.toToolSchemas();
      expect(schemas).toHaveLength(3);
      expect(schemas.map((s) => s.function.name)).toContain('calculate');
      expect(schemas.map((s) => s.function.name)).toContain('delete_file');
    });

    it('should delegate has to inner registry', () => {
      const inner = createInnerRegistry();
      const confirm = vi.fn().mockResolvedValue(true);

      const registry = new ConfirmableRegistry(inner, {
        confirmTools: ['delete_file'],
        confirm,
      });

      expect(registry.has('calculate')).toBe(true);
      expect(registry.has('delete_file')).toBe(true);
      expect(registry.has('nonexistent')).toBe(false);
    });

    it('should delegate getToolNames to inner registry', () => {
      const inner = createInnerRegistry();
      const confirm = vi.fn().mockResolvedValue(true);

      const registry = new ConfirmableRegistry(inner, {
        confirmTools: ['delete_file'],
        confirm,
      });

      expect(registry.getToolNames()).toEqual(['calculate', 'delete_file', 'send_email']);
    });

    it('should delegate register to inner registry', () => {
      const inner = createInnerRegistry();
      const confirm = vi.fn().mockResolvedValue(true);

      const registry = new ConfirmableRegistry(inner, {
        confirmTools: ['delete_file'],
        confirm,
      });

      registry.register({
        name: 'new_tool',
        description: 'New tool',
        parameters: z.object({ value: z.number() }),
        execute: async ({ value }: { value: number }) => value * 2,
      });

      expect(registry.has('new_tool')).toBe(true);
      expect(registry.getToolNames()).toHaveLength(4);
    });

    it('should delegate unregister to inner registry', () => {
      const inner = createInnerRegistry();
      const confirm = vi.fn().mockResolvedValue(true);

      const registry = new ConfirmableRegistry(inner, {
        confirmTools: ['delete_file'],
        confirm,
      });

      expect(registry.unregister('send_email')).toBe(true);
      expect(registry.has('send_email')).toBe(false);
      expect(registry.unregister('nonexistent')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty confirmTools list', async () => {
      const inner = createInnerRegistry();
      const confirm = vi.fn().mockResolvedValue(true);

      const registry = new ConfirmableRegistry(inner, {
        confirmTools: [],
        confirm,
      });

      // All tools execute without confirmation
      const result = await registry.execute('delete_file', { path: '/tmp/test.txt' });
      expect(result).toBe('Deleted: /tmp/test.txt');
      expect(confirm).not.toHaveBeenCalled();
    });

    it('should handle confirm handler throwing an error', async () => {
      const inner = createInnerRegistry();
      const confirm = vi.fn().mockRejectedValue(new Error('UI crashed'));

      const registry = new ConfirmableRegistry(inner, {
        confirmTools: ['delete_file'],
        confirm,
      });

      await expect(registry.execute('delete_file', { path: '/tmp/test.txt' })).rejects.toThrow(
        'UI crashed'
      );
    });
  });
});
