/**
 * @fileoverview useSession hook integration tests — covering hook's internal save/restore logic
 *
 * ink-testing-library does not have act, so we use wait-for-render approach to test async logic.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { useSession } from '../../src/hooks/use-session.js';
import { createAgentState } from '@agentskillmania/colts';
import type { AgentState } from '@agentskillmania/colts';

/**
 * Test wrapper component that exposes hook return values
 */
function createWrapper() {
  const container: { current: ReturnType<typeof useSession> | null } = { current: null };

  function Wrapper({ baseDir }: { baseDir?: string }) {
    container.current = useSession(baseDir);
    return null;
  }

  return {
    Wrapper,
    getHook: () => container.current!,
  };
}

describe('useSession hook', () => {
  const testDir = path.join(os.tmpdir(), `colts-session-hook-${Date.now()}`);

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('initial sessionId should be null', () => {
    const { Wrapper, getHook } = createWrapper();
    render(<Wrapper baseDir={testDir} />);
    expect(getHook().sessionId).toBeNull();
  });

  it('should update sessionId after save succeeds', async () => {
    const { Wrapper, getHook } = createWrapper();
    render(<Wrapper baseDir={testDir} />);

    const state = createAgentState({
      name: 'test',
      instructions: 'test',
      tools: [],
    });

    await getHook().save(state);

    expect(getHook().sessionId).toBe(state.id);
    expect(getHook().isSaving).toBe(false);

    // Verify file actually exists
    const filePath = path.join(testDir, `${state.id}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    expect(JSON.parse(content).id).toBe(state.id);
  });

  it('should return null when restoreLatest has no sessions', async () => {
    const { Wrapper, getHook } = createWrapper();
    render(<Wrapper baseDir={testDir} />);

    const result = await getHook().restoreLatest();

    expect(result).toBeNull();
    expect(getHook().sessionId).toBeNull();
  });

  it('should restore the most recent session with restoreLatest', async () => {
    const state = createAgentState({
      name: 'test',
      instructions: 'test',
      tools: [],
    });

    // First manually save a session
    const { saveSession } = await import('../../src/session.js');
    await saveSession(state, testDir);

    const { Wrapper, getHook } = createWrapper();
    render(<Wrapper baseDir={testDir} />);

    const result = await getHook().restoreLatest();

    expect(result).not.toBeNull();
    expect(result!.id).toBe(state.id);
    expect(getHook().sessionId).toBe(state.id);
  });

  it('should update sessionId with setSessionId', () => {
    const { Wrapper, getHook } = createWrapper();
    render(<Wrapper baseDir={testDir} />);

    getHook().setSessionId('test-id');

    expect(getHook().sessionId).toBe('test-id');
  });

  it('should handle save failure silently (no throw)', async () => {
    // Use an unwritable path to trigger failure
    const badDir = '/nonexistent/path/that/cannot/be/written';

    const { Wrapper, getHook } = createWrapper();
    render(<Wrapper baseDir={badDir} />);

    const state = createAgentState({
      name: 'test',
      instructions: 'test',
      tools: [],
    });

    // Should not throw
    await getHook().save(state);

    expect(getHook().isSaving).toBe(false);
  });
});
