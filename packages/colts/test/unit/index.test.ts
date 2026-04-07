import { describe, it, expect } from 'vitest';
import { hello } from '../../src/index';

describe('hello', () => {
  it('should return hello world', () => {
    expect(hello()).toBe('Hello, World!');
  });
});
