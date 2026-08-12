/**
 * @fileoverview Branch coverage tests for runner/advance.ts
 *
 * Covers:
 * - createRouter with customHandlers
 * - buildMessagesFromCtx delegation
 */

import { describe, it, expect, vi } from 'vitest';
import { createRouter, buildMessagesFromCtx } from '../../../src/runner/advance.js';
import { PhaseRouter } from '../../../src/execution-engine/router.js';
import type { IPhaseHandler } from '../../../src/execution-engine/types.js';
import type { AgentState } from '../../../src/types.js';
import type { RunnerContext } from '../../../src/runner/advance.js';

describe('createRouter', () => {
  it('should create a new PhaseRouter when customHandlers are provided', async () => {
    const customHandler: IPhaseHandler = {
      canHandle: (type: string) => type === 'idle',
      execute: vi.fn().mockResolvedValue({
        state: {} as AgentState,
        execState: { phase: { type: 'idle' } },
        phase: { type: 'idle' },
        done: false,
      }),
    };

    const router1 = createRouter([customHandler]);
    const router2 = createRouter([customHandler]);

    // Each call with customHandlers should create a new instance
    expect(router1).toBeInstanceOf(PhaseRouter);
    expect(router2).toBeInstanceOf(PhaseRouter);
    expect(router1).not.toBe(router2);
  });

  it('should return the singleton when no customHandlers are provided', async () => {
    const router1 = createRouter();
    const router2 = createRouter();

    // Without customHandlers, should return the same singleton instance
    expect(router1).toBe(router2);
  });
});

describe('buildMessagesFromCtx', () => {
  it('should delegate to messageAssembler.build with correct options', async () => {
    const mockBuild = vi.fn().mockReturnValue([
      { role: 'system', content: 'Test system' },
      { role: 'user', content: 'Hello' },
    ]);

    const mockState = { id: 'test-state' } as unknown as AgentState;

    const ctx = {
      messageAssembler: {
        build: mockBuild,
      },
      options: {
        model: 'gpt-4-test',
        systemPrompt: 'Custom system prompt',
        enablePromptThinking: true,
      },
      skillProvider: undefined,
    } as unknown as RunnerContext;

    const messages = await buildMessagesFromCtx(ctx, mockState);

    expect(mockBuild).toHaveBeenCalledWith(mockState, {
      systemPrompt: 'Custom system prompt',
      model: 'gpt-4-test',
      skillProvider: undefined,
      enablePromptThinking: true,
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
  });

  it('should pass skillProvider when present', async () => {
    const mockBuild = vi.fn().mockReturnValue([]);
    const mockSkillProvider = { listSkills: vi.fn() };

    const ctx = {
      messageAssembler: {
        build: mockBuild,
      },
      options: {
        model: 'gpt-4',
        systemPrompt: undefined,
        enablePromptThinking: false,
      },
      skillProvider: mockSkillProvider,
    } as unknown as RunnerContext;

    await buildMessagesFromCtx(ctx, {} as AgentState);

    expect(mockBuild).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        skillProvider: mockSkillProvider,
      })
    );
  });
});
