/**
 * @fileoverview Unit tests for parseCommand function
 */

import { describe, it, expect } from 'vitest';
import { parseCommand } from '../../src/hooks/use-agent.js';

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

  it('/skill 无参数匹配为 skill 类型', () => {
    const result = parseCommand('/skill');
    expect(result.type).toBe('skill');
    expect(result.skillName).toBeUndefined();
  });

  it('/skill 尾部空格等同于无参数', () => {
    const result = parseCommand('/skill ');
    expect(result.type).toBe('skill');
    expect(result.skillName).toBeUndefined();
  });

  it('/skill 带多空格参数正确提取', () => {
    const result = parseCommand('/skill   hello-world  ');
    expect(result.type).toBe('skill');
    expect(result.skillName).toBe('hello-world');
    expect(result.skillMessage).toBeUndefined();
  });

  it('/skill name message 正确分离', () => {
    const result = parseCommand('/skill tell-time 现在几点了');
    expect(result.type).toBe('skill');
    expect(result.skillName).toBe('tell-time');
    expect(result.skillMessage).toBe('现在几点了');
  });

  it('/skill name 多段 message 完整保留', () => {
    const result = parseCommand('/skill computer 1+2+3');
    expect(result.type).toBe('skill');
    expect(result.skillName).toBe('computer');
    expect(result.skillMessage).toBe('1+2+3');
  });

  it('/skill name 长消息带空格', () => {
    const result = parseCommand('/skill greeting 你好 请用中文问候');
    expect(result.type).toBe('skill');
    expect(result.skillName).toBe('greeting');
    expect(result.skillMessage).toBe('你好 请用中文问候');
  });
});
