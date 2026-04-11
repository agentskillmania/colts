/**
 * CLI 里程碑集成测试
 *
 * User Story: CLI Milestone
 * 验证：启动 → 渲染 → 退出 的完整流程。
 * （不含真正的 LLM 调用，仅验证组件 + hooks + session 串联正确）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import { AgentRunner, createAgentState } from '@agentskillmania/colts';
import { saveSession, listSessions, loadSession } from '../../src/session.js';

// Mock AgentRunner
vi.mock('@agentskillmania/colts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentskillmania/colts')>();
  return {
    ...actual,
    AgentRunner: vi.fn().mockImplementation(() => ({
      chatStream: vi.fn(),
      stepStream: vi.fn(),
      advanceStream: vi.fn(),
    })),
  };
});

describe('CLI 里程碑集成', () => {
  const testSessionDir = path.join(os.tmpdir(), `colts-cli-milestone-${Date.now()}`);

  beforeEach(async () => {
    await fs.mkdir(testSessionDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testSessionDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  /**
   * 场景 1: 首次启动（无配置）显示配置提示
   */
  it('首次启动无配置时显示配置提示', () => {
    const noConfig: AppConfig = { hasValidConfig: false, configPath: '/tmp/test.yaml' };
    const { lastFrame } = render(<App config={noConfig} runner={null} />);
    const frame = lastFrame();
    expect(frame).toContain('AI Key Configuration Required');
    expect(frame).toContain('/tmp/test.yaml');
  });

  /**
   * 场景 2: 有效配置启动显示欢迎屏幕
   */
  it('有效配置启动显示欢迎屏幕', () => {
    const config: AppConfig = {
      hasValidConfig: true,
      configPath: '/tmp/test.yaml',
      llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
      agent: { name: 'test-agent', instructions: 'Test' },
    };
    const runner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });
    const { lastFrame } = render(<App config={config} runner={runner} />);
    const frame = lastFrame();
    expect(frame).toContain('Welcome to colts-cli');
    expect(frame).toContain('test-agent');
    expect(frame).toContain('gpt-4o');
    expect(frame).toContain('RUN');
  });

  /**
   * 场景 3: 带初始 state 启动
   */
  it('带初始 AgentState 启动正常渲染', () => {
    const config: AppConfig = {
      hasValidConfig: true,
      configPath: '/tmp/test.yaml',
      llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
      agent: { name: 'test-agent', instructions: 'Test' },
    };
    const runner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });
    const initialState = createAgentState({
      name: 'test-agent',
      instructions: 'Test',
      tools: [],
    });
    const { lastFrame } = render(<App config={config} runner={runner} initialState={initialState} />);
    const frame = lastFrame();
    expect(frame).toContain('colts-cli');
    expect(frame).toContain('gpt-4o');
  });

  /**
   * 场景 4: Session 持久化验证 — 保存 + 加载
   */
  it('Session 保存后可加载', async () => {
    const state = createAgentState({
      name: 'test-agent',
      instructions: 'Test',
      tools: [],
    });

    // 保存
    await saveSession(state, testSessionDir);

    // 加载
    const loaded = await loadSession(state.id, testSessionDir);
    expect(loaded.id).toBe(state.id);

    // 列表
    const sessions = await listSessions(testSessionDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(state.id);
  });

  /**
   * 场景 5: 多次渲染不报错（组件稳定性）
   */
  it('多次渲染不报错', () => {
    const config: AppConfig = {
      hasValidConfig: true,
      configPath: '/tmp/test.yaml',
      llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
      agent: { name: 'test-agent', instructions: 'Test' },
    };
    const runner = new AgentRunner({ model: 'gpt-4o', llm: { apiKey: 'sk-test' } });

    // 连续渲染 3 次
    for (let i = 0; i < 3; i++) {
      const { unmount } = render(<App config={config} runner={runner} />);
      expect(() => unmount()).not.toThrow();
    }
  });
});
