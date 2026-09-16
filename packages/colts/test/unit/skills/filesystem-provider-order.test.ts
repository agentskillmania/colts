/**
 * R2P-101b: skill catalog ordering determinism (aligned with Rust 5e238bc).
 *
 * In Rust the FilesystemSkillProvider kept manifests in a HashMap — its
 * per-instance random iteration order reshuffled the system document's
 * `## Available Skills` catalog on every runner rebuild, invalidating the
 * provider prefix cache from the first message on. The fix made ordering a
 * structural property (BTreeMap).
 *
 * TS counterpart: manifests live in a Map keyed by skill name (insertion
 * order = scan order, and readdir order is NOT guaranteed alphabetical), so
 * determinism must come from the enumeration — listSkills() sorts by name.
 * All consumers (colts default-assembler catalog, wrangler `## Available
 * Skills`, /skills routes) are then automatically immune.
 */

import { describe, it, expect } from 'vitest';
import { FilesystemSkillProvider } from '../../../src/skills/filesystem-provider.js';
import type { SkillFsOps } from '../../../src/skills/fs-ops.js';

/** Skill names used by the fake backend. */
const SKILL_NAMES = ['zeta', 'alpha', 'mid-skill', 'bravo', 'yankee', 'kilo'];

/**
 * In-memory SkillFsOps whose readdir returns the given (possibly shuffled)
 * order — simulates filesystem-dependent / backend-dependent scan order,
 * the TS analogue of Rust HashMap's random iteration order.
 */
function fakeFsOps(dirOrder: string[]): SkillFsOps {
  const dir = '/skills';
  const stats = (isDirectory: boolean) => ({
    mtimeMs: 1,
    isDirectory: () => isDirectory,
  });
  return {
    readFile: async (path) => {
      if (path.endsWith('SKILL.md')) {
        const name = path.split('/').slice(-2, -1)[0];
        return `---\nname: ${name}\ndescription: d\n---\nbody`;
      }
      return '';
    },
    readdir: async (path) => {
      if (path === dir) return [...dirOrder];
      return [];
    },
    exists: async (path) => {
      if (path === dir) return true;
      if (path.endsWith('SKILL.md')) {
        const name = path.split('/').slice(-2, -1)[0];
        return SKILL_NAMES.includes(name);
      }
      return false;
    },
    stat: async (path) => stats(!path.endsWith('SKILL.md')),
    join: (...parts) => parts.join('/'),
    homeDir: () => '/home',
  };
}

describe('R2P-101b: listSkills ordering determinism (prefix cache)', () => {
  it('is sorted by skill name regardless of scan order', async () => {
    const provider = new FilesystemSkillProvider(['/skills'], fakeFsOps(SKILL_NAMES));
    const names = (await provider.listSkills()).map((m) => m.name);
    expect(names).toEqual(['alpha', 'bravo', 'kilo', 'mid-skill', 'yankee', 'zeta']);
  });

  it('is identical across provider instances with different scan orders', async () => {
    // Two fresh instances (= two consecutive turns rebuilding the provider)
    // with different readdir orders must produce identical catalogs — the
    // system document is the request's first user message, so any wobble
    // invalidates the provider prefix cache wholesale.
    const shuffled = [...SKILL_NAMES].reverse();
    const a = new FilesystemSkillProvider(['/skills'], fakeFsOps(SKILL_NAMES));
    const b = new FilesystemSkillProvider(['/skills'], fakeFsOps(shuffled));
    const la = (await a.listSkills()).map((m) => m.name);
    const lb = (await b.listSkills()).map((m) => m.name);
    expect(la).toEqual(lb);
    expect(la).toEqual([...la].sort());
  });
});
