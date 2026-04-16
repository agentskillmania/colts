/**
 * @fileoverview Unit tests for parseCommand function and trimToMaxEntries
 */

import { describe, it, expect } from 'vitest';
import { parseCommand, trimToMaxEntries, MAX_ENTRIES } from '../../src/hooks/use-agent.js';

describe('parseCommand', () => {
  it('should parse /run command', () => {
    const result = parseCommand('/run');
    expect(result.type).toBe('mode-run');
    expect(result.raw).toBe('/run');
  });

  it('should parse /step command', () => {
    const result = parseCommand('/step');
    expect(result.type).toBe('mode-step');
  });

  it('should parse /advance command', () => {
    const result = parseCommand('/advance');
    expect(result.type).toBe('mode-advance');
  });

  it('should parse /clear command', () => {
    const result = parseCommand('/clear');
    expect(result.type).toBe('clear');
  });

  it('should parse /help command', () => {
    const result = parseCommand('/help');
    expect(result.type).toBe('help');
  });

  it('should parse /skill command', () => {
    const result = parseCommand('/skill my-skill');
    expect(result.type).toBe('skill');
    expect(result.skillName).toBe('my-skill');
  });

  it('should trim spaces in /skill command', () => {
    const result = parseCommand('/skill   spaced-name  ');
    expect(result.type).toBe('skill');
    expect(result.skillName).toBe('spaced-name');
  });

  it('should parse plain text as message', () => {
    const result = parseCommand('Hello world');
    expect(result.type).toBe('message');
    expect(result.raw).toBe('Hello world');
  });

  it('should parse text with spaces as message', () => {
    const result = parseCommand('  trim me  ');
    expect(result.type).toBe('message');
    expect(result.raw).toBe('trim me');
  });

  it('should not match /ski as skill command', () => {
    const result = parseCommand('/ski name');
    expect(result.type).toBe('message');
  });

  it('should parse /show:compact command', () => {
    const result = parseCommand('/show:compact');
    expect(result.type).toBe('show-compact');
    expect(result.raw).toBe('/show:compact');
  });

  it('should parse /show:detail command', () => {
    const result = parseCommand('/show:detail');
    expect(result.type).toBe('show-detail');
    expect(result.raw).toBe('/show:detail');
  });

  it('should parse /show:verbose command', () => {
    const result = parseCommand('/show:verbose');
    expect(result.type).toBe('show-verbose');
    expect(result.raw).toBe('/show:verbose');
  });

  it('should parse /compact as alias for /show:compact', () => {
    const result = parseCommand('/compact');
    expect(result.type).toBe('show-compact');
    expect(result.raw).toBe('/compact');
  });

  it('should parse /detail as alias for /show:detail', () => {
    const result = parseCommand('/detail');
    expect(result.type).toBe('show-detail');
    expect(result.raw).toBe('/detail');
  });

  it('should parse /verbose as alias for /show:verbose', () => {
    const result = parseCommand('/verbose');
    expect(result.type).toBe('show-verbose');
    expect(result.raw).toBe('/verbose');
  });

  it('should not match /show without subcommand', () => {
    const result = parseCommand('/show');
    expect(result.type).toBe('message');
  });

  it('should not match /show:unknown', () => {
    const result = parseCommand('/show:unknown');
    expect(result.type).toBe('message');
  });

  it('/skill without argument matches skill type', () => {
    const result = parseCommand('/skill');
    expect(result.type).toBe('skill');
    expect(result.skillName).toBeUndefined();
  });

  it('/skill trailing space equals no argument', () => {
    const result = parseCommand('/skill ');
    expect(result.type).toBe('skill');
    expect(result.skillName).toBeUndefined();
  });

  it('/skill with multiple spaces extracts argument correctly', () => {
    const result = parseCommand('/skill   hello-world  ');
    expect(result.type).toBe('skill');
    expect(result.skillName).toBe('hello-world');
    expect(result.skillMessage).toBeUndefined();
  });

  it('/skill name message separates correctly', () => {
    const result = parseCommand('/skill tell-time What time is it now?');
    expect(result.type).toBe('skill');
    expect(result.skillName).toBe('tell-time');
    expect(result.skillMessage).toBe('What time is it now?');
  });

  it('/skill name multi-part message preserved completely', () => {
    const result = parseCommand('/skill computer 1+2+3');
    expect(result.type).toBe('skill');
    expect(result.skillName).toBe('computer');
    expect(result.skillMessage).toBe('1+2+3');
  });

  it('/skill name long message with spaces', () => {
    const result = parseCommand('/skill greeting Hello please greet in Chinese');
    expect(result.type).toBe('skill');
    expect(result.skillName).toBe('greeting');
    expect(result.skillMessage).toBe('Hello please greet in Chinese');
  });
});

describe('trimToMaxEntries', () => {
  it('不超过上限时返回原数组（同一引用）', () => {
    const arr = [1, 2, 3];
    const result = trimToMaxEntries(arr, 200);
    expect(result).toBe(arr); // 同一引用
  });

  it('恰好等于上限时返回原数组', () => {
    const arr = Array.from({ length: 200 }, (_, i) => i);
    const result = trimToMaxEntries(arr, 200);
    expect(result).toBe(arr);
    expect(result).toHaveLength(200);
  });

  it('超出上限时裁剪到 max 条（保留最新）', () => {
    const arr = Array.from({ length: 250 }, (_, i) => i);
    const result = trimToMaxEntries(arr, 200);
    expect(result).toHaveLength(200);
    // 保留最后的 200 条（索引 50-249）
    expect(result[0]).toBe(50);
    expect(result[199]).toBe(249);
  });

  it('空数组不裁剪', () => {
    const arr: number[] = [];
    const result = trimToMaxEntries(arr, 200);
    expect(result).toBe(arr);
    expect(result).toHaveLength(0);
  });

  it('max=1 只保留最后 1 条', () => {
    const arr = [10, 20, 30, 40];
    const result = trimToMaxEntries(arr, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(40);
  });

  it('使用默认 MAX_ENTRIES 常量', () => {
    expect(MAX_ENTRIES).toBe(200);
  });

  it('超出默认 MAX_ENTRIES 时正确裁剪', () => {
    const arr = Array.from({ length: 300 }, (_, i) => `entry-${i}`);
    const result = trimToMaxEntries(arr, MAX_ENTRIES);
    expect(result).toHaveLength(200);
    expect(result[0]).toBe('entry-100');
    expect(result[199]).toBe('entry-299');
  });
});
