/**
 * Response Parser unit tests (Step 2)
 */

import { describe, it, expect } from 'vitest';
import {
  parseResponse,
  requiresToolExecution,
  formatToolCalls,
  ParseError,
  type ToolCall,
  type ParseResult,
} from '../../src/parser.js';
import type { LLMResponse } from '@agentskillmania/llm-client';

describe('Response Parser (Step 2)', () => {
  describe('parseResponse', () => {
    it('should parse final answer (no tool calls)', () => {
      // Given: LLM response with content only
      const response: LLMResponse = {
        content: 'The answer is 42.',
        tokens: { input: 10, output: 5 },
        stopReason: 'stop',
      };

      // When: Parse response
      const result = parseResponse(response);

      // Then: Recognized as final answer
      expect(result.thought).toBe('The answer is 42.');
      expect(result.toolCalls).toHaveLength(0);
      expect(result.isFinalAnswer).toBe(true);
    });

    it('should parse response with tool calls', () => {
      // Given: LLM response with tool calls
      const response: LLMResponse = {
        content: 'I will calculate that for you.',
        tokens: { input: 15, output: 20 },
        stopReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call_abc123',
            name: 'calculate',
            arguments: '{"expression": "15 + 23"}',
          },
        ],
      };

      // When: Parse response
      const result = parseResponse(response);

      // Then: Extract tool call correctly
      expect(result.thought).toBe('I will calculate that for you.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toEqual({
        id: 'call_abc123',
        name: 'calculate',
        arguments: { expression: '15 + 23' },
      });
      expect(result.isFinalAnswer).toBe(false);
    });

    it('should parse multiple tool calls', () => {
      // Given: LLM response with multiple tool calls
      const response: LLMResponse = {
        content: 'I need to search and calculate.',
        tokens: { input: 20, output: 30 },
        stopReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call_1',
            name: 'search',
            arguments: '{"query": "weather in Beijing"}',
          },
          {
            id: 'call_2',
            name: 'calculate',
            arguments: '{"expression": "25 * 2"}',
          },
        ],
      };

      // When: Parse response
      const result = parseResponse(response);

      // Then: Extract all tool calls
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('search');
      expect(result.toolCalls[1].name).toBe('calculate');
      expect(result.isFinalAnswer).toBe(false);
    });

    it('should prefer thinking over content', () => {
      // Given: Response with both thinking and content
      const response: LLMResponse = {
        content: 'Let me help you with that.',
        thinking: 'The user wants to know 2+2. I should use calculator.',
        tokens: { input: 10, output: 15 },
        stopReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call_1',
            name: 'calculate',
            arguments: '{"expression": "2+2"}',
          },
        ],
      };

      // When: Parse response
      const result = parseResponse(response);

      // Then: Use thinking as thought
      expect(result.thought).toBe('The user wants to know 2+2. I should use calculator.');
    });

    it('should handle arguments as object (already parsed)', () => {
      // Given: Response with arguments as object (some providers)
      const response: LLMResponse = {
        content: 'Calculating...',
        tokens: { input: 10, output: 10 },
        stopReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call_1',
            name: 'calculate',
            // Some providers may return already parsed object
            arguments: { expression: '10 * 5' } as unknown as string,
          },
        ],
      };

      // When: Parse response
      const result = parseResponse(response);

      // Then: Handle object arguments correctly
      expect(result.toolCalls[0].arguments).toEqual({ expression: '10 * 5' });
    });

    it('should handle empty content', () => {
      // Given: Response with empty content
      const response: LLMResponse = {
        content: '',
        tokens: { input: 5, output: 0 },
        stopReason: 'stop',
      };

      // When: Parse response
      const result = parseResponse(response);

      // Then: Empty thought, final answer
      expect(result.thought).toBe('');
      expect(result.isFinalAnswer).toBe(true);
    });

    it('should throw ParseError for invalid JSON arguments', () => {
      // Given: Response with invalid JSON arguments
      const response: LLMResponse = {
        content: 'Let me calculate.',
        tokens: { input: 10, output: 10 },
        stopReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call_1',
            name: 'calculate',
            arguments: 'not valid json',
          },
        ],
      };

      // When/Then: Should throw ParseError
      expect(() => parseResponse(response)).toThrow(ParseError);
      expect(() => parseResponse(response)).toThrow(/Failed to parse arguments/);
    });

    it('should throw ParseError for non-object JSON arguments', () => {
      // Given: Response with array arguments (invalid)
      const response: LLMResponse = {
        content: 'Let me calculate.',
        tokens: { input: 10, output: 10 },
        stopReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call_1',
            name: 'calculate',
            arguments: '[1, 2, 3]',
          },
        ],
      };

      // When/Then: Should throw ParseError
      expect(() => parseResponse(response)).toThrow(ParseError);
    });

    it('should throw ParseError for null arguments', () => {
      // Given: Response with null arguments
      const response: LLMResponse = {
        content: 'Let me calculate.',
        tokens: { input: 10, output: 10 },
        stopReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call_1',
            name: 'calculate',
            arguments: null as unknown as string,
          },
        ],
      };

      // When/Then: Should throw ParseError
      expect(() => parseResponse(response)).toThrow(ParseError);
    });

    it('should handle complex nested arguments', () => {
      // Given: Response with complex nested arguments
      const response: LLMResponse = {
        content: 'Creating user...',
        tokens: { input: 20, output: 30 },
        stopReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call_1',
            name: 'createUser',
            arguments: JSON.stringify({
              name: 'Alice',
              age: 30,
              address: {
                city: 'Beijing',
                zip: '100000',
              },
              tags: ['developer', 'admin'],
            }),
          },
        ],
      };

      // When: Parse response
      const result = parseResponse(response);

      // Then: Parse nested structure correctly
      expect(result.toolCalls[0].arguments).toEqual({
        name: 'Alice',
        age: 30,
        address: {
          city: 'Beijing',
          zip: '100000',
        },
        tags: ['developer', 'admin'],
      });
    });
  });

  describe('requiresToolExecution', () => {
    it('should return true when tool calls exist', () => {
      const result: ParseResult = {
        thought: 'Need to calculate',
        toolCalls: [{ id: '1', name: 'calc', arguments: {} }],
        isFinalAnswer: false,
      };

      expect(requiresToolExecution(result)).toBe(true);
    });

    it('should return false when no tool calls', () => {
      const result: ParseResult = {
        thought: 'The answer is 42',
        toolCalls: [],
        isFinalAnswer: true,
      };

      expect(requiresToolExecution(result)).toBe(false);
    });
  });

  describe('formatToolCalls', () => {
    it('should format single tool call', () => {
      const calls: ToolCall[] = [{ id: '1', name: 'calculate', arguments: { expr: '2+2' } }];

      expect(formatToolCalls(calls)).toBe('calculate({"expr":"2+2"})');
    });

    it('should format multiple tool calls', () => {
      const calls: ToolCall[] = [
        { id: '1', name: 'search', arguments: { q: 'weather' } },
        { id: '2', name: 'calculate', arguments: { expr: '1+1' } },
      ];

      expect(formatToolCalls(calls)).toBe('search({"q":"weather"}), calculate({"expr":"1+1"})');
    });

    it('should handle empty array', () => {
      expect(formatToolCalls([])).toBe('No tool calls');
    });
  });

  describe('ParseError', () => {
    it('should create error with message', () => {
      const error = new ParseError('Parsing failed');

      expect(error.name).toBe('ParseError');
      expect(error.message).toBe('Parsing failed');
    });

    it('should store cause', () => {
      const cause = new Error('Original error');
      const error = new ParseError('Parsing failed', cause);

      expect(error.cause).toBe(cause);
    });
  });
});
