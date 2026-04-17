/**
 * @fileoverview App 组件单元测试
 *
 * 测试 App 路由逻辑（ConfigPrompt vs MainTUI）、命令拦截、交互行为。
 * mock 策略：只 mock runner 上的 stream 方法返回空 generator，
 * 其余所有代码（App、useAgent、StreamEventConsumer）走真实路径。
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import type { AgentRunner, AgentState } from '@agentskillmania/colts';
import { createAgentState } from '@agentskillmania/colts';

// ── mock runner-setup（createRunnerFromConfig / createInitialStateFromConfig）──
// vi.mock factory 会被 hoist，不能引用外部变量，所以 factory 内部自包含

vi.mock('../../src/runner-setup.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/runner-setup.js')>();
  const { createAgentState: createState } = await import('@agentskillmania/colts');
  const { vi: viModule } = await import('vitest');

  // 空 async generator
  async function* emptyStream() {
    return;
  }

  const mockRunner = {
    runStream: viModule.fn().mockReturnValue(emptyStream()),
    stepStream: viModule.fn().mockReturnValue(emptyStream()),
    advanceStream: viModule.fn().mockReturnValue(emptyStream()),
    chatStream: viModule.fn().mockReturnValue(emptyStream()),
    skillProvider: undefined,
    registerTool: viModule.fn(),
  };

  return {
    ...actual,
    interactionCallbacks: { askHuman: null, confirm: null },
    createRunnerFromConfig: viModule.fn().mockReturnValue(mockRunner),
    createInitialStateFromConfig: viModule
      .fn()
      .mockReturnValue(createState({ name: 'test-agent', instructions: 'Test', tools: [] })),
  };
});

// ── mock setup ──

// mock @inkjs/ui 的 TextInput，捕获 onSubmit
let capturedOnSubmit: ((value: string) => void) | null = null;
let capturedSelectOnChange: ((value: string) => void) | null = null;

vi.mock('@inkjs/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inkjs/ui')>();
  return {
    ...actual,
    TextInput: ({ onSubmit }: { onSubmit: (v: string) => void }) => {
      capturedOnSubmit = onSubmit;
      return React.createElement('text-input-mock');
    },
    Select: ({ onChange }: { onChange: (v: string) => void }) => {
      capturedSelectOnChange = onChange;
      return React.createElement('select-mock');
    },
  };
});

// mock @inkjs/ui 的 Select 一样需要 mock
vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
  };
});

// ── 辅助工具 ──

/** 创建空 async generator，模拟 runStream/stepStream/advanceStream */
async function* emptyStream() {
  // 不 yield 任何事件，直接 return 结果
  return;
}

/** 创建一个 mock runner，stream 方法返回空 generator */
function createMockRunner(overrides?: Partial<AgentRunner>): AgentRunner {
  return {
    runStream: vi.fn().mockReturnValue(emptyStream()),
    stepStream: vi.fn().mockReturnValue(emptyStream()),
    advanceStream: vi.fn().mockReturnValue(emptyStream()),
    chatStream: vi.fn().mockReturnValue(emptyStream()),
    skillProvider: undefined,
    ...overrides,
  } as unknown as AgentRunner;
}

const validConfig: AppConfig = {
  hasValidConfig: true,
  configPath: '/tmp/test.yaml',
  llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
  agent: { name: 'test-agent', instructions: 'Test' },
};

const invalidConfig: AppConfig = {
  hasValidConfig: false,
  configPath: '/tmp/test.yaml',
};

// ── 测试用例 ──

describe('App', () => {
  beforeEach(() => {
    capturedOnSubmit = null;
    capturedSelectOnChange = null;
  });

  // ── 路由逻辑 ──

  describe('无有效配置', () => {
    it('显示 SetupWizard 而不是 MainTUI', () => {
      const { lastFrame } = render(<App config={invalidConfig} runner={null} />);
      const frame = lastFrame();
      expect(frame).toContain('colts-cli Setup');
      expect(frame).toContain('Step 1/3');
      expect(frame).not.toContain('RUN');
    });

    it('显示 Provider 选择提示', () => {
      const { lastFrame } = render(<App config={invalidConfig} runner={null} />);
      expect(lastFrame()).toContain('Select your LLM provider');
    });
  });

  describe('有效配置 + runner', () => {
    it('显示 WelcomeScreen（无消息时）', () => {
      const runner = createMockRunner();
      const { lastFrame } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );
      expect(lastFrame()).toContain('Welcome to colts-cli');
    });

    it('显示模型名称', () => {
      const runner = createMockRunner();
      const { lastFrame } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );
      expect(lastFrame()).toContain('gpt-4o');
    });

    it('显示 agent 名称', () => {
      const runner = createMockRunner();
      const { lastFrame } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );
      expect(lastFrame()).toContain('test-agent');
    });

    it('显示输入区域（RUN 模式）', () => {
      const runner = createMockRunner();
      const { lastFrame } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );
      expect(lastFrame()).toContain('RUN');
    });

    it('unmount 不报错', () => {
      const runner = createMockRunner();
      const { unmount } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );
      expect(() => unmount()).not.toThrow();
    });
  });

  // ── 命令拦截 ──

  describe('handleSubmit 命令拦截', () => {
    it('/step 切换到 STEP 模式', async () => {
      const runner = createMockRunner();
      const { lastFrame } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );

      expect(capturedOnSubmit).not.toBeNull();
      capturedOnSubmit!('/step');

      // handleSubmit 是 async（内部 await import），需要等渲染
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('STEP');
      });
    });

    it('/advance 切换到 ADVANCE 模式', async () => {
      const runner = createMockRunner();
      const { lastFrame } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );

      capturedOnSubmit!('/advance');
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('ADV');
      });
    });

    it('/run 切换回 RUN 模式', async () => {
      const runner = createMockRunner();
      const { lastFrame } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );

      capturedOnSubmit!('/step');
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('STEP');
      });

      capturedOnSubmit!('/run');
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('RUN');
      });
    });

    it('/clear 不报错', () => {
      const runner = createMockRunner();
      render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );

      expect(() => capturedOnSubmit!('/clear')).not.toThrow();
    });

    it('普通消息触发 sendMessage（调用 runStream）', async () => {
      const runner = createMockRunner();
      render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );

      capturedOnSubmit!('hello');

      // 等 async 操作完成
      await vi.waitFor(() => {
        expect(runner.runStream).toHaveBeenCalled();
      });
    });

    it('空消息不触发 sendMessage', async () => {
      const runner = createMockRunner();
      render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );

      capturedOnSubmit!('   ');

      // 给一点时间确保不会触发
      await new Promise((r) => setTimeout(r, 50));
      expect(runner.runStream).not.toHaveBeenCalled();
    });

    it('/help 被 useAgent 拦截为命令，不触发 runStream', async () => {
      const runner = createMockRunner();
      render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );

      capturedOnSubmit!('/help');

      // /help 在 useAgent.sendMessage 里被拦截为命令，不走 runStream
      await vi.waitFor(() => {
        expect(runner.runStream).not.toHaveBeenCalled();
      });
    });
  });

  // ── 边界场景 ──

  describe('边界场景', () => {
    it('runner 为 null 但 config 有效时不崩溃', () => {
      // 这种组合不应该出现，但测试防御性
      const { lastFrame } = render(
        <App config={validConfig} runner={null} sessionBaseDir="/tmp/colts-test-sessions" />
      );
      // config 有效但 runner null → 走 SetupWizard 分支
      expect(lastFrame()).toContain('colts-cli Setup');
    });

    it('多次模式切换不崩溃', () => {
      const runner = createMockRunner();
      const { lastFrame } = render(
        <App config={validConfig} runner={runner} sessionBaseDir="/tmp/colts-test-sessions" />
      );

      for (let i = 0; i < 5; i++) {
        capturedOnSubmit!('/step');
        capturedOnSubmit!('/advance');
        capturedOnSubmit!('/run');
      }

      expect(lastFrame()).toContain('RUN');
    });
  });

  // ── SetupWizard 自动切换到 MainTUI ──

  describe('SetupWizard 自动切换 MainTUI', () => {
    it('SetupWizard 完成后切换到 MainTUI 显示 WelcomeScreen', async () => {
      const { lastFrame } = render(<App config={invalidConfig} runner={null} />);

      // 初始显示 SetupWizard
      expect(lastFrame()).toContain('colts-cli Setup');

      // Step 1: 选择 provider
      await vi.waitFor(() => {
        expect(capturedSelectOnChange).not.toBeNull();
      });
      capturedSelectOnChange!('openai');

      // 等待 step 2，TextInput 出现
      await vi.waitFor(() => {
        expect(capturedOnSubmit).not.toBeNull();
      });

      // Step 2: 输入 API key
      capturedOnSubmit!('sk-test-key');

      // 等待 step 3，新的 TextInput 出现
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('Step 3/3');
        expect(capturedOnSubmit).not.toBeNull();
      });

      // Step 3: 输入 model（触发 onComplete → handleSetupComplete → 切换到 MainTUI）
      capturedOnSubmit!('gpt-4o');

      // 等待状态切换完成，应该显示 MainTUI 的 WelcomeScreen
      await vi.waitFor(
        () => {
          expect(lastFrame()).toContain('Welcome to colts-cli');
        },
        { timeout: 5000 }
      );

      // 不应再包含 SetupWizard
      expect(lastFrame()).not.toContain('colts-cli Setup');
    });
  });
});
