/**
 * @fileoverview Skill Signal 类型测试
 */

import { describe, it, expect } from 'vitest';
import { isSkillSignal, type SkillSignal } from '../../src/skills/types.js';

describe('Skill Signal', () => {
  describe('isSkillSignal', () => {
    it('should return true for SWITCH_SKILL signal', () => {
      const signal: SkillSignal = {
        type: 'SWITCH_SKILL',
        to: 'data-cleaning',
        instructions: '# Instructions',
        task: 'Clean the data',
      };
      expect(isSkillSignal(signal)).toBe(true);
    });

    it('should return true for RETURN_SKILL signal', () => {
      const signal: SkillSignal = {
        type: 'RETURN_SKILL',
        result: 'Cleaned 100 records',
        status: 'success',
      };
      expect(isSkillSignal(signal)).toBe(true);
    });

    it('should return true for SKILL_NOT_FOUND signal', () => {
      const signal: SkillSignal = {
        type: 'SKILL_NOT_FOUND',
        requested: 'unknown-skill',
        available: ['skill-a', 'skill-b'],
      };
      expect(isSkillSignal(signal)).toBe(true);
    });

    it('should return false for non-signal objects', () => {
      expect(isSkillSignal({ type: 'OTHER' })).toBe(false);
      expect(isSkillSignal({ foo: 'bar' })).toBe(false);
      expect(isSkillSignal(null)).toBe(false);
      expect(isSkillSignal(undefined)).toBe(false);
      expect(isSkillSignal('string')).toBe(false);
      expect(isSkillSignal(123)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isSkillSignal(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isSkillSignal(undefined)).toBe(false);
    });
  });
});
