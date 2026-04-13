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

  it('should not match /show without subcommand', () => {
    const result = parseCommand('/show');
    expect(result.type).toBe('message');
  });

  it('should not match /show:unknown', () => {
    const result = parseCommand('/show:unknown');
    expect(result.type).toBe('message');
  });
});
