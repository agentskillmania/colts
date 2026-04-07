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
    it('should replace arrays entirely instead of merging', () => {
      const target = {
        items: ['a', 'b'],
      };
      const defaultValue = {
        items: ['x', 'y', 'z'],
      };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({
        items: ['a', 'b'],
      });
    });

    it('should override non-array value in defaultValue with array from target', () => {
      const target = {
        items: ['a', 'b'],
      };
      const defaultValue = {
        items: 'not-array',
      };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({
        items: ['a', 'b'],
      });
    });

    it('should override array in defaultValue with non-array value from target', () => {
      const target = {
        items: 'not-array',
      };
      const defaultValue = {
        items: ['x', 'y', 'z'],
      };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({
        items: 'not-array',
      });
    });
  });

  describe('null handling', () => {
    it('should override defaultValue with null from target', () => {
      const target = {
        value: null,
      };
      const defaultValue = {
        value: 'default',
      };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({
        value: null,
      });
    });

    it('should not recursively merge when target has null object field', () => {
      const target = {
        config: null,
      };
      const defaultValue = {
        config: { nested: 'value' },
      };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({
        config: null,
      });
    });

    it('should not treat null in defaultValue as an object', () => {
      const target = {
        config: { nested: 'value' },
      };
      const defaultValue = {
        config: null,
      };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({
        config: { nested: 'value' },
      });
    });
  });

  describe('edge cases', () => {
    it('should return copy of defaultValue when target is empty', () => {
      const target = {};
      const defaultValue = { name: 'default' };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({ name: 'default' });
    });

    it('should return target when defaultValue is empty', () => {
      const target = { name: 'target' };
      const defaultValue = {};

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({ name: 'target' });
    });

    it('should return empty object when both are empty', () => {
      const target = {};
      const defaultValue = {};

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({});
    });

    it('should not modify original objects', () => {
      const target = { name: 'target' };
      const defaultValue = { name: 'default', extra: 'value' };

      deepMerge(target, defaultValue);

      expect(target).toEqual({ name: 'target' });
      expect(defaultValue).toEqual({ name: 'default', extra: 'value' });
    });

    it('should support various primitive types', () => {
      const target = {
        string: 'target',
        number: 100,
        boolean: false,
      };
      const defaultValue = {
        string: 'default',
        number: 0,
        boolean: true,
      };

      const result = deepMerge(target, defaultValue);

      expect(result).toEqual({
        string: 'target',
        number: 100,
        boolean: false,
      });
    });
  });
});
