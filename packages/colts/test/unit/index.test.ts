import { describe, it, expect } from 'vitest';
import * as colts from '../../src/index.js';

describe('barrel export surface (0.5.0-alpha.2)', () => {
  it('exports the host-facing skill-signal vocabulary and shared formatter', () => {
    expect(typeof colts.isSkillSignal).toBe('function');
    expect(typeof colts.formatSkillToolResult).toBe('function');
    expect(typeof colts.compareByCodeUnit).toBe('function');
  });

  it('compareByCodeUnit is the engine comparator (code-unit order, not locale)', () => {
    expect(['zebra', 'Alpha', 'mid'].sort(colts.compareByCodeUnit)).toEqual([
      'Alpha',
      'mid',
      'zebra',
    ]);
  });

  it('formatSkillToolResult appends the bundled-files suffix for a SWITCH_SKILL signal', () => {
    const out = colts.formatSkillToolResult({
      type: 'SWITCH_SKILL',
      to: 'demo-skill',
      instructions: 'do it',
      task: 'fix the bug',
      resources: ['a.md'],
      scripts: [],
    });
    expect(out).toContain('bundled files');
    expect(out).toContain('resources: a.md');
  });
});
