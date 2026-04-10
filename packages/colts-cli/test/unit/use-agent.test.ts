/**
 * use-agent.ts 单元测试
 *
 * 测试命令解析、消息处理和执行模式切换逻辑。
 * Hook 的交互逻辑通过直接调用纯函数测试。
 */

import { describe, it, expect } from 'vitest';
import { parseCommand } from '../../src/hooks/use-agent.js';
import type { ParsedCommand } from '../../src/hooks/use-agent.js';

describe('use-agent', () => {
  describe('parseCommand', () => {
    it('能解析 /run 命令', () => {
      const result = parseCommand('/run');
      expect(result.type).toBe('mode-run');
      expect(result.raw).toBe('/run');
    });

    it('能解析 /step 命令', () => {
      const result = parseCommand('/step');
      expect(result.type).toBe('mode-step');
      expect(result.raw).toBe('/step');
    });

    it('能解析 /advance 命令', () => {
      const result = parseCommand('/advance');
      expect(result.type).toBe('mode-advance');
      expect(result.raw).toBe('/advance');
    });

    it('能解析 /clear 命令', () => {
      const result = parseCommand('/clear');
      expect(result.type).toBe('clear');
      expect(result.raw).toBe('/clear');
    });

    it('能解析 /help 命令', () => {
      const result = parseCommand('/help');
      expect(result.type).toBe('help');
      expect(result.raw).toBe('/help');
    });

    it('普通文本识别为消息', () => {
      const result = parseCommand('Hello, how are you?');
      expect(result.type).toBe('message');
      expect(result.raw).toBe('Hello, how are you?');
    });

    it('带前导空格的文本仍识别为消息', () => {
      const result = parseCommand('  Hello  ');
      expect(result.type).toBe('message');
      expect(result.raw).toBe('Hello');
    });

    it('带前导空格的命令仍识别为命令', () => {
      const result = parseCommand('  /run  ');
      expect(result.type).toBe('mode-run');
      expect(result.raw).toBe('/run');
    });

    it('空字符串识别为消息', () => {
      const result = parseCommand('');
      expect(result.type).toBe('message');
      expect(result.raw).toBe('');
    });

    it('/runx 不被识别为 /run 命令', () => {
      const result = parseCommand('/runx');
      expect(result.type).toBe('message');
    });

    it('/running 不被识别为 /run 命令', () => {
      const result = parseCommand('/running');
      expect(result.type).toBe('message');
    });

    it('/stepper 不被识别为 /step 命令', () => {
      const result = parseCommand('/stepper');
      expect(result.type).toBe('message');
    });

    it('多行文本识别为消息', () => {
      const result = parseCommand('line1\nline2');
      expect(result.type).toBe('message');
    });

    it('包含 /run 的消息不被识别为命令', () => {
      const result = parseCommand('please /run this');
      expect(result.type).toBe('message');
    });

    it('包含 /step 的消息不被识别为命令', () => {
      const result = parseCommand('please /step through');
      expect(result.type).toBe('message');
    });

    it('返回类型符合 ParsedCommand 接口', () => {
      const result: ParsedCommand = parseCommand('/clear');
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('raw');
    });
  });
});
