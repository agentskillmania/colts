/**
 * @fileoverview User Story: Skill Command Loading via CLI
 *
 * As a CLI user
 * I want to load skills dynamically using the /skill command
 * So that I can switch to specialized workflows on demand
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { App } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import { AgentRunner, createAgentState } from '@agentskillmania/colts';
import { FilesystemSkillProvider } from '@agentskillmania/colts';

/** Capture the TextInput onSubmit callback */
let capturedOnSubmit: ((value: string) => void) | null = null;

vi.mock('@inkjs/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inkjs/ui')>();
  return {
    ...actual,
    TextInput: ({
      onSubmit,
      placeholder,
    }: {
      onSubmit: (v: string) => void;
      placeholder?: string;
    }) => {
      capturedOnSubmit = onSubmit;
      return React.createElement(Text, null, placeholder ?? '');
    },
  };
});

describe('User Story: Skill Command Loading', () => {
  const skillDir = path.join(os.tmpdir(), `colts-cli-skill-cmd-${Date.now()}`);
  const sessionDir = path.join(os.tmpdir(), `colts-cli-skill-session-${Date.now()}`);

  const validConfig: AppConfig = {
    hasValidConfig: true,
    configPath: '/tmp/test.yaml',
    llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
    agent: { name: 'test-agent', instructions: 'Test', tools: [] },
  };

  beforeEach(async () => {
    capturedOnSubmit = null;

    await fs.mkdir(skillDir, { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });

    const poetDir = path.join(skillDir, 'poet');
    await fs.mkdir(poetDir, { recursive: true });
    await fs.writeFile(
      path.join(poetDir, 'SKILL.md'),
      `---
name: poet
description: A poet who writes haikus.
---
You are a poet.`,
      'utf-8'
    );
  });

  afterEach(async () => {
    try {
      await fs.rm(skillDir, { recursive: true, force: true });
      await fs.rm(sessionDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should activate poet skill via /skill poet', async () => {
    const skillProvider = new FilesystemSkillProvider([skillDir]);
    const runner = new AgentRunner({
      model: 'gpt-4o',
      llm: { apiKey: 'sk-test' },
      skillProvider,
    });

    const { lastFrame } = render(
      <App config={validConfig} runner={runner} sessionBaseDir={sessionDir} />
    );

    capturedOnSubmit!('/skill poet');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(lastFrame()).toContain("Skill 'poet' activated");
  });

  it('should list available skills via /skill without argument', async () => {
    const skillProvider = new FilesystemSkillProvider([skillDir]);
    const runner = new AgentRunner({
      model: 'gpt-4o',
      llm: { apiKey: 'sk-test' },
      skillProvider,
    });

    const { lastFrame } = render(
      <App config={validConfig} runner={runner} sessionBaseDir={sessionDir} />
    );

    capturedOnSubmit!('/skill');
    await new Promise((resolve) => setTimeout(resolve, 100));

    const frame = lastFrame();
    expect(frame).toContain('Available skills');
    expect(frame).toContain('poet');
  });

  it('should show not found when skill does not exist', async () => {
    const skillProvider = new FilesystemSkillProvider([skillDir]);
    const runner = new AgentRunner({
      model: 'gpt-4o',
      llm: { apiKey: 'sk-test' },
      skillProvider,
    });

    const { lastFrame } = render(
      <App config={validConfig} runner={runner} sessionBaseDir={sessionDir} />
    );

    capturedOnSubmit!('/skill nonexistent');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(lastFrame()).toContain('not found');
  });
});
