/**
 * deepMerge unit tests
 */

import { describe, it, expect } from 'vitest';
import { deepMerge } from '../../src/deepMerge';

describe('deepMerge', () => {
  describe('basic merge', () => {
    it('should override defaultValue with target value', () => {
      const target = { name: 'target' };
      const defaultValue = { name: 'default' };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({ name: 'target' });
    });

    it('should preserve fields in defaultValue that are missing in target', () => {
      const target = { name: 'target' };
      const defaultValue = { name: 'default', extra: 'value' };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({ name: 'target', extra: 'value' });
    });

    it('should add fields in target that are missing in defaultValue', () => {
      const target = { name: 'target', newField: 'new' };
      const defaultValue = { name: 'default' };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({ name: 'target', newField: 'new' });
    });
  });

  describe('nested objects', () => {
    it('should recursively merge nested objects', () => {
      const target = {
        server: { port: 8080 },
      };
      const defaultValue = {
        server: { port: 3000, host: 'localhost' },
      };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({
        server: { port: 8080, host: 'localhost' },
      });
    });

    it('should support multi-level nesting', () => {
      const target = {
        db: { connection: { host: 'db.example.com' } },
      };
      const defaultValue = {
        db: { connection: { host: 'localhost', port: 5432 } },
      };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({
        db: { connection: { host: 'db.example.com', port: 5432 } },
      });
    });

    it('should use target value directly when defaultValue field is not an object', () => {
      const target = {
        config: { nested: 'value' },
      };
      const defaultValue = {
        config: 'string',
      };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({
        config: { nested: 'value' },
      });
    });

    it('should use target value directly when target field is not an object', () => {
      const target = {
        config: 'string',
      };
      const defaultValue = {
        config: { nested: 'value' },
      };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({
        config: 'string',
      });
    });
  });

  describe('array handling', () => {
    it('should merge arrays element by element, keeping extra default elements', () => {
      const target = { items: ['a', 'b'] };
      const defaultValue = { items: ['x', 'y', 'z'] };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({ items: ['a', 'b', 'z'] });
    });

    it('should merge object array elements by index', () => {
      const target = {
        servers: [{ host: 'a.com' }],
      };
      const defaultValue = {
        servers: [
          { host: 'localhost', port: 80 },
          { host: 'backup.com', port: 8080 },
        ],
      };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({
        servers: [
          { host: 'a.com', port: 80 },
          { host: 'backup.com', port: 8080 },
        ],
      });
    });

    it('should deep copy target arrays — no shared references', () => {
      const target = { items: ['a', 'b'] };

      const result = deepMerge(target, {});

      (result as { items: string[] }).items.push('c');

      expect(target.items).toEqual(['a', 'b']);
      expect((result as { items: string[] }).items).toEqual(['a', 'b', 'c']);
    });

    it('should deep copy nested objects inside arrays', () => {
      const target = {
        servers: [
          { host: 'a.com', port: 80 },
          { host: 'b.com', port: 443 },
        ],
      };

      const result = deepMerge(target, {});

      const resultServers = (result as { servers: Array<Record<string, unknown>> }).servers;
      resultServers[0].host = 'hacked';

      expect(target.servers[0].host).toBe('a.com');
      expect(resultServers[0].host).toBe('hacked');
    });

    it('should deep copy nested arrays inside arrays', () => {
      const target = {
        matrix: [
          [1, 2],
          [3, 4],
        ],
      };

      const result = deepMerge(target, {});

      (result as { matrix: number[][] }).matrix[0].push(99);

      expect(target.matrix[0]).toEqual([1, 2]);
      expect((result as { matrix: number[][] }).matrix[0]).toEqual([1, 2, 99]);
    });

    it('should deep copy default arrays when target has no such key', () => {
      const target = { name: 'test' };
      const defaultValue = { items: ['x', 'y', 'z'] };

      const result = deepMerge(target, defaultValue);

      (result as { items: string[] }).items.push('w');

      expect(defaultValue.items).toEqual(['x', 'y', 'z']);
      expect((result as { items: string[] }).items).toEqual(['x', 'y', 'z', 'w']);
    });

    it('should handle type mismatch: target array vs default non-array', () => {
      const target = { items: ['a', 'b'] };
      const defaultValue = { items: 'not-array' };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({ items: ['a', 'b'] });
    });

    it('should handle type mismatch: target non-array vs default array', () => {
      const target = { items: 'not-array' };
      const defaultValue = { items: ['x', 'y', 'z'] };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({ items: 'not-array' });
    });
  });

  describe('deep copy — no shared references', () => {
    it('should deep copy default-only nested objects', () => {
      const target = { name: 'test' };
      const defaultValue = { server: { port: 3000, host: 'localhost' } };

      const result = deepMerge(target, defaultValue);

      (result as { server: Record<string, unknown> }).server.port = 9999;

      expect(defaultValue.server.port).toBe(3000);
      expect((result as { server: Record<string, unknown> }).server.port).toBe(9999);
    });

    it('should deep copy merged nested objects from both sides', () => {
      const target = { server: { port: 8080 } };
      const defaultValue = { server: { port: 3000, host: 'localhost' } };

      const result = deepMerge(target, defaultValue);

      (result as { server: Record<string, unknown> }).server.host = 'changed';

      expect(target.server).not.toHaveProperty('host');
      expect(defaultValue.server.host).toBe('localhost');
      expect((result as { server: Record<string, unknown> }).server.host).toBe('changed');
    });

    it('should deep copy default-only nested objects with further nesting', () => {
      const target = { name: 'test' };
      const defaultValue = { db: { connection: { host: 'localhost', port: 5432 } } };

      const result = deepMerge(target, defaultValue);

      const resultDb = (result as { db: { connection: Record<string, unknown> } }).db;
      resultDb.connection.host = 'hacked';

      expect(defaultValue.db.connection.host).toBe('localhost');
      expect(resultDb.connection.host).toBe('hacked');
    });
  });

  describe('null handling', () => {
    it('should override defaultValue with null from target', () => {
      const target = { value: null };
      const defaultValue = { value: 'default' };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({ value: null });
    });

    it('should not recursively merge when target has null object field', () => {
      const target = { config: null };
      const defaultValue = { config: { nested: 'value' } };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({ config: null });
    });

    it('should not treat null in defaultValue as an object', () => {
      const target = { config: { nested: 'value' } };
      const defaultValue = { config: null };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({ config: { nested: 'value' } });
    });
  });

  describe('edge cases', () => {
    it('should return deep copy of defaultValue when target is empty', () => {
      const target = {};
      const defaultValue = { name: 'default', nested: { key: 'value' } };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({ name: 'default', nested: { key: 'value' } });
      (result as { nested: Record<string, unknown> }).nested.key = 'changed';
      expect(defaultValue.nested.key).toBe('value');
    });

    it('should return deep copy of target when defaultValue is empty', () => {
      const target = { name: 'target', nested: { key: 'value' } };
      const defaultValue = {};

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({ name: 'target', nested: { key: 'value' } });
      (result as { nested: Record<string, unknown> }).nested.key = 'changed';
      expect(target.nested.key).toBe('value');
    });

    it('should return empty object when both are empty', () => {
      const result = deepMerge({}, {});

      expect(result).toEqual({});
    });

    it('should not modify original objects', () => {
      const target = { name: 'target', nested: { key: 't' } };
      const defaultValue = { name: 'default', extra: 'value', nested2: { key: 'd' } };

      deepMerge(target, defaultValue);

      expect(target).toEqual({ name: 'target', nested: { key: 't' } });
      expect(defaultValue).toEqual({ name: 'default', extra: 'value', nested2: { key: 'd' } });
    });

    it('should support various primitive types', () => {
      const target = { string: 'target', number: 100, boolean: false };
      const defaultValue = { string: 'default', number: 0, boolean: true };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({ string: 'target', number: 100, boolean: false });
    });
  });

  // T6: 回归测试 — 数组中 undefined 使用 default fallback (CR SY-2)
  describe('undefined semantics in arrays vs objects (CR SY-2)', () => {
    it('should use default value for undefined array elements', () => {
      const target = { items: [undefined, 'b'] } as unknown as Record<string, unknown>;
      const defaultValue = { items: ['a', 'x', 'c'] };

      const result = deepMerge(target, defaultValue);

      // 数组中 undefined 元素应 fallback 到 default
      expect((result as { items: string[] }).items[0]).toBe('a');
      expect((result as { items: string[] }).items[1]).toBe('b');
      // 短数组缺失的尾部元素从 default 填充
      expect((result as { items: string[] }).items[2]).toBe('c');
    });

    it('should preserve undefined in object keys (target overrides default)', () => {
      const target = { key: undefined } as unknown as Record<string, unknown>;
      const defaultValue = { key: 'default-value' };

      const result = deepMerge(target, defaultValue);

      // 对象中 target 有这个 key（即使值为 undefined），应保留
      expect(result).toHaveProperty('key');
      expect(result.key).toBeUndefined();
    });
  });
});
