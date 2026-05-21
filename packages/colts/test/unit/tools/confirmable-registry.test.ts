/**
 * @fileoverview ConfirmableRegistry coverage tests
 */

import { describe, it, expect, vi } from 'vitest';
import { ConfirmableRegistry } from '../../../src/tools/confirmable-registry.js';

describe('ConfirmableRegistry', () => {
  function createInnerRegistry(allTools: unknown[] = []) {
    return {
      execute: vi.fn().mockResolvedValue('result'),
      toToolSchemas: vi.fn().mockReturnValue([]),
      register: vi.fn(),
      unregister: vi.fn().mockReturnValue(true),
      has: vi.fn().mockReturnValue(true),
      getToolNames: vi.fn().mockReturnValue(['tool-a']),
      get: vi.fn().mockReturnValue({ name: 'tool-a' }),
      getAll: vi.fn().mockReturnValue(allTools),
    };
  }

  it('should confirm before executing confirmable tool', async () => {
    const inner = createInnerRegistry();
    const confirm = vi.fn().mockResolvedValue(true);
    const registry = new ConfirmableRegistry(inner as never, {
      confirm,
      confirmTools: ['dangerous'],
    });

    await registry.execute('dangerous', { path: '/tmp' });
    expect(confirm).toHaveBeenCalledWith('dangerous', { path: '/tmp' });
    expect(inner.execute).toHaveBeenCalledWith('dangerous', { path: '/tmp' }, undefined);
  });

  it('should reject execution when confirmation fails', async () => {
    const inner = createInnerRegistry();
    const confirm = vi.fn().mockResolvedValue(false);
    const registry = new ConfirmableRegistry(inner as never, {
      confirm,
      confirmTools: ['dangerous'],
    });

    await expect(registry.execute('dangerous', {})).rejects.toThrow(
      'Tool execution rejected by human: dangerous'
    );
    expect(inner.execute).not.toHaveBeenCalled();
  });

  it('should bypass confirmation for non-confirmable tools', async () => {
    const inner = createInnerRegistry();
    const confirm = vi.fn().mockResolvedValue(true);
    const registry = new ConfirmableRegistry(inner as never, {
      confirm,
      confirmTools: ['dangerous'],
    });

    await registry.execute('safe', { x: 1 });
    expect(confirm).not.toHaveBeenCalled();
    expect(inner.execute).toHaveBeenCalledWith('safe', { x: 1 }, undefined);
  });

  it('should pass signal to inner execute', async () => {
    const inner = createInnerRegistry();
    const registry = new ConfirmableRegistry(inner as never, {
      confirm: vi.fn().mockResolvedValue(true),
      confirmTools: ['dangerous'],
    });

    const controller = new AbortController();
    await registry.execute('dangerous', {}, { signal: controller.signal });
    expect(inner.execute).toHaveBeenCalledWith('dangerous', {}, { signal: controller.signal });
  });

  it('should delegate getAll when inner has getAll', () => {
    const inner = createInnerRegistry([{ name: 'tool-a' }]);
    const registry = new ConfirmableRegistry(inner as never, {
      confirm: vi.fn(),
      confirmTools: [],
    });

    expect(registry.getAll()).toEqual([{ name: 'tool-a' }]);
  });

  it('should return empty array when inner has no getAll', () => {
    const inner = createInnerRegistry();
    delete (inner as never as { getAll?: unknown }).getAll;
    const registry = new ConfirmableRegistry(inner as never, {
      confirm: vi.fn(),
      confirmTools: [],
    });

    expect(registry.getAll()).toEqual([]);
  });

  it('should delegate get()', () => {
    const inner = createInnerRegistry();
    const registry = new ConfirmableRegistry(inner as never, {
      confirm: vi.fn(),
      confirmTools: [],
    });

    expect(registry.get('tool-a')).toEqual({ name: 'tool-a' });
    expect(inner.get).toHaveBeenCalledWith('tool-a');
  });
});
