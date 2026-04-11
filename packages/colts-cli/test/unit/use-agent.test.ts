/**
 * @fileoverview parseCommand 函数单元测试
 */

import { describe, it, expect } from 'vitest';
import { parseCommand } from '../../src/hooks/use-agent.js';

describe('parseCommand', () => {
  it('解析 /run 命令', () => {
    const result = parseCommand('/run');
    expect(result.type).toBe('mode-run');
    expect(result.raw).toBe('/run');
  });

  it('解析 /step 命令', () => {
    const result = parseCommand('/step');
    expect(result.type).toBe('mode-step');
  });

  it('解析 /advance 命令', () => {
    const result = parseCommand('/advance');
    expect(result.type).toBe('mode-advance');
  });

  it('解析 /clear 命令', () => {
    const result = parseCommand('/clear');
    expect(result.type).toBe('clear');
  });

  it('解析 /help 命令', () => {
    const result = parseCommand('/help');
    expect(result.type).toBe('help');
  });

  it('解析 /skill 命令', () => {
    const result = parseCommand('/skill my-skill');
    expect(result.type).toBe('skill');
    expect(result.skillName).toBe('my-skill');
  });

  it('解析 /skill 命令去除空格', () => {
    const result = parseCommand('/skill   spaced-name  ');
    expect(result.type).toBe('skill');
    expect(result.skillName).toBe('spaced-name');
  });

  it('普通文本解析为 message', () => {
    const result = parseCommand('Hello world');
    expect(result.type).toBe('message');
    expect(result.raw).toBe('Hello world');
  });

  it('带空格的文本解析为 message', () => {
    const result = parseCommand('  trim me  ');
    expect(result.type).toBe('message');
    expect(result.raw).toBe('trim me');
  });

  it('/ski 不匹配 skill 命令', () => {
    const result = parseCommand('/ski name');
    expect(result.type).toBe('message');
  });
});
