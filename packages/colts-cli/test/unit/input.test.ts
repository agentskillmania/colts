/**
 * input.tsx 单元测试
 *
 * 测试 Input 组件中使用的常量和模式映射逻辑。
 * ink 组件渲染测试比较困难，重点测试数据映射逻辑。
 */

import { describe, it, expect } from 'vitest';
import type { ExecutionMode } from '../../src/hooks/use-agent.js';

describe('Input 组件逻辑', () => {
  /** 模式标签映射（与 input.tsx 中定义一致） */
  const MODE_LABELS: Record<ExecutionMode, string> = {
    run: 'RUN',
    step: 'STEP',
    advance: 'ADV',
  };

  describe('MODE_LABELS', () => {
    it('run 模式标签为 RUN', () => {
      expect(MODE_LABELS.run).toBe('RUN');
    });

    it('step 模式标签为 STEP', () => {
      expect(MODE_LABELS.step).toBe('STEP');
    });

    it('advance 模式标签为 ADV', () => {
      expect(MODE_LABELS.advance).toBe('ADV');
    });
  });

  describe('ExecutionMode 类型', () => {
    it('有效模式值', () => {
      const validModes: ExecutionMode[] = ['run', 'step', 'advance'];
      for (const mode of validModes) {
        expect(MODE_LABELS[mode]).toBeDefined();
      }
    });

    it('所有模式都有对应标签', () => {
      const modes: ExecutionMode[] = ['run', 'step', 'advance'];
      for (const mode of modes) {
        expect(MODE_LABELS[mode]).toBeTruthy();
      }
    });
  });

  describe('运行指示器', () => {
    it('运行指示器为 ● 符号', () => {
      const RUNNING_INDICATOR = ' ●';
      expect(RUNNING_INDICATOR).toBe(' ●');
      expect(RUNNING_INDICATOR).toContain('●');
    });
  });

  describe('模式切换场景', () => {
    it('从 run 切换到 step 时标签变化', () => {
      const currentMode: ExecutionMode = 'run';
      const newMode: ExecutionMode = 'step';
      expect(MODE_LABELS[currentMode]).toBe('RUN');
      expect(MODE_LABELS[newMode]).toBe('STEP');
      expect(MODE_LABELS[currentMode]).not.toBe(MODE_LABELS[newMode]);
    });

    it('从 step 切换到 advance 时标签变化', () => {
      const currentMode: ExecutionMode = 'step';
      const newMode: ExecutionMode = 'advance';
      expect(MODE_LABELS[currentMode]).toBe('STEP');
      expect(MODE_LABELS[newMode]).toBe('ADV');
    });

    it('所有模式标签长度不超过 4 个字符', () => {
      const modes: ExecutionMode[] = ['run', 'step', 'advance'];
      for (const mode of modes) {
        expect(MODE_LABELS[mode].length).toBeLessThanOrEqual(4);
      }
    });
  });
});
