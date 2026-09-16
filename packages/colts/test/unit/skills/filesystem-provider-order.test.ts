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
import { DefaultMessageAssembler } from '../../../src/message-assembler/default-assembler.js';
import { FilesystemSkillProvider } from '../../../src/skills/filesystem-provider.js';
import type { SkillFsOps } from '../../../src/skills/fs-ops.js';
import type { AgentState } from '../../../src/types.js';

/**
 * Skill names used by the fake backend. `Zulu` is deliberate: UTF-16
 * code-unit order puts it BEFORE the lowercase names ('Z' = 0x5A < 'a'),
 * while localeCompare collation puts it last — so the pinned order fails if
 * the comparator is ever swapped for a locale-aware one.
 */
const SKILL_NAMES = ['zeta', 'alpha', 'mid-skill', 'bravo', 'yankee', 'kilo', 'Zulu'];

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
    // Non-localeCompare pin: 'Zulu' sorts first by code unit (and last under
    // localeCompare).
    expect(names).toEqual(['Zulu', 'alpha', 'bravo', 'kilo', 'mid-skill', 'yankee', 'zeta']);
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

  it('assembler-level: the built system document is byte-identical across scan orders', async () => {
    // Provider-level equality is necessary but not sufficient: the catalog
    // order surfaces in the assembled system document (request's first user
    // message), so pin the built bytes, not just the manifest list.
    // (R2P-101b, aligned with Rust 5e238bc's assembler-level test.)
    const state = {
      id: 'test',
      config: { name: 'test', instructions: '', tools: [] },
      context: { messages: [], stepCount: 0, totalTokens: { input: 0, output: 0 } },
    } as unknown as AgentState;
    const assembler = new DefaultMessageAssembler();
    const buildSystemDoc = async (order: string[]) => {
      const messages = await assembler.build(state, {
        systemPrompt: 'You are helpful.',
        model: 'test-model',
        skillProvider: new FilesystemSkillProvider(['/skills'], fakeFsOps(order)),
      });
      return messages[0];
    };

    const a = await buildSystemDoc(SKILL_NAMES);
    const b = await buildSystemDoc([...SKILL_NAMES].reverse());

    expect(a.role).toBe('user');
    expect(String(a.content)).toContain('Available skills:');
    expect(String(a.content)).toContain('- Zulu: d');
    // Byte-for-byte on the document content: any catalog-order wobble would
    // invalidate the provider prefix cache at this very first message.
    // (timestamps are per-build wall clock and intentionally not compared)
    expect(a.content).toBe(b.content);
    expect(a.content).toBe(
      '[System Instructions]\n' +
        'You are helpful.\n\n' +
        'Available skills:\n' +
        '- Zulu: d\n- alpha: d\n- bravo: d\n- kilo: d\n- mid-skill: d\n- yankee: d\n- zeta: d\n' +
        'Use the load_skill tool to load detailed instructions when needed.'
    );
  });
});
