/**
 * R2P-114: bundled-files inventory delivery (aligned with Rust c78cfcc/f1096cc).
 *
 * Evolution chain (Rust): the model had no channel to learn what a skill
 * directory contains — read_skill_resource / run_skill_script paths had to be
 * guessed. c78cfcc attached the manifest's resources/scripts lists to the
 * SWITCH_SKILL result and appended them to the formatted tool output as a
 * '--- bundled files ---' suffix; f1096cc then aligned the /skill: slash
 * command's synthesized result through the SAME formatter so both paths emit
 * identical inventory text.
 *
 * colts-side boundary contract (this file pins it):
 * - createLoadSkillTool always carries resources/scripts on the SWITCH_SKILL
 *   signal (empty arrays when the manifest has none — Rust unwrap_or_default).
 * - formatSkillToolResult appends the Rust-shaped suffix, partitioned into
 *   'resources:' / 'scripts:' lines of exact relative paths; nothing appended
 *   when both lists are empty.
 * - formatSkillToolResult is pure on the signal: any two callers that build
 *   the same signal payload (the load_skill tool path; the slash-path
 *   synthesized signal the wrangler /skill: handler must build) format
 *   identically. The wrangler handler itself is out of this repo — handover
 *   item, not exercised here.
 * - Real FilesystemSkillProvider inventory flows end-to-end into the formatted
 *   result (exact relative paths).
 */

import { describe, it, expect } from 'vitest';
import { createLoadSkillTool } from '../../../src/skills/load-skill-tool.js';
import { formatSkillToolResult } from '../../../src/skills/signal-handler.js';
import { FilesystemSkillProvider } from '../../../src/skills/filesystem-provider.js';
import type { SkillFsOps } from '../../../src/skills/fs-ops.js';
import type { ISkillProvider, SkillManifest, SkillSignal } from '../../../src/skills/types.js';

const RUST_SUFFIX_HEADER =
  '--- bundled files (use these exact paths with read_skill_resource / run_skill_script) ---';

/** Mock provider with an explicit manifest map (delivery-layer tests). */
function createMockProvider(manifests: SkillManifest[]): ISkillProvider {
  const map = new Map(manifests.map((m) => [m.name, m]));
  return {
    getManifest: async (name) => map.get(name),
    loadInstructions: async (name) => {
      const m = map.get(name);
      if (!m) throw new Error(`Skill not found: ${name}`);
      return `# ${name} instructions`;
    },
    loadResource: async () => '',
    listSkills: async () => manifests,
    refresh: async () => {},
  } as unknown as ISkillProvider;
}

/** In-memory SkillFsOps: one skill dir with the given top-level files. */
function fakeFsOps(topLevelFiles: string[]): SkillFsOps {
  const skillDir = '/skills/create-image';
  const stats = (isDirectory: boolean) => ({
    mtimeMs: 1,
    isDirectory: () => isDirectory,
  });
  return {
    readFile: async (path) => {
      if (path.endsWith('SKILL.md')) {
        return '---\nname: create-image\ndescription: generate images\n---\n\nRun generate.js.';
      }
      return '';
    },
    readdir: async (path) => {
      if (path === '/skills') return ['create-image'];
      if (path === skillDir) return topLevelFiles;
      return [];
    },
    exists: async (path) => {
      if (path === '/skills' || path === skillDir) return true;
      return topLevelFiles.includes(path.split('/').pop()!);
    },
    stat: async (path) =>
      stats(path === '/skills' || !topLevelFiles.includes(path.split('/').pop()!)),
    join: (...parts) => parts.join('/'),
    homeDir: () => '/home',
  };
}

describe('R2P-114: load_skill delivers the manifest inventory', () => {
  it('carries resources/scripts from the manifest on the SWITCH_SKILL signal', async () => {
    const manifest: SkillManifest = {
      name: 'create-image',
      description: 'generate images',
      source: '/skills/create-image',
      resources: ['reference/catalog.md', 'assets/palette.json'],
      scripts: ['generate.js'],
    };
    const tool = createLoadSkillTool(createMockProvider([manifest]));

    const result = (await tool.execute({ name: 'create-image' })) as SkillSignal;

    expect(result).toMatchObject({
      type: 'SWITCH_SKILL',
      to: 'create-image',
      resources: ['reference/catalog.md', 'assets/palette.json'],
      scripts: ['generate.js'],
    });
  });

  it('defaults to empty arrays when the manifest has no inventory (Rust unwrap_or_default)', async () => {
    const manifest: SkillManifest = {
      name: 'bare-skill',
      description: 'no files',
      source: '/skills/bare-skill',
    };
    const tool = createLoadSkillTool(createMockProvider([manifest]));

    const result = (await tool.execute({ name: 'bare-skill' })) as SkillSignal & {
      resources?: string[];
      scripts?: string[];
    };

    expect(result.type).toBe('SWITCH_SKILL');
    expect(result.resources).toEqual([]);
    expect(result.scripts).toEqual([]);
  });
});

describe('R2P-114: formatSkillToolResult appends the bundled-files suffix', () => {
  it('renders both partitions in the Rust suffix shape', () => {
    const result = formatSkillToolResult({
      type: 'SWITCH_SKILL',
      to: 'create-image',
      instructions: 'Draw things.',
      task: 'draw',
      resources: ['reference/catalog.md', 'assets/palette.json'],
      scripts: ['generate.js'],
    });
    expect(result).toBe(
      'Draw things.\n\n' +
        RUST_SUFFIX_HEADER +
        '\nresources: reference/catalog.md, assets/palette.json\nscripts: generate.js'
    );
  });

  it('renders only the scripts line when there are no resources', () => {
    const result = formatSkillToolResult({
      type: 'SWITCH_SKILL',
      to: 's',
      instructions: 'Do stuff.',
      task: 't',
      scripts: ['run.py'],
    });
    expect(result).toBe('Do stuff.\n\n' + RUST_SUFFIX_HEADER + '\nscripts: run.py');
  });

  it('appends nothing when both lists are empty (byte-identical to bare instructions)', () => {
    const result = formatSkillToolResult({
      type: 'SWITCH_SKILL',
      to: 's',
      instructions: 'Do stuff.',
      task: 't',
      resources: [],
      scripts: [],
    });
    expect(result).toBe('Do stuff.');
  });

  it('treats a missing inventory the same as empty (legacy signals)', () => {
    const result = formatSkillToolResult({
      type: 'SWITCH_SKILL',
      to: 's',
      instructions: 'Do stuff.',
      task: 't',
    });
    expect(result).toBe('Do stuff.');
  });

  it('formatter output is a pure function of the signal shape (tool payload vs synthesized payload)', async () => {
    // What this actually pins: formatSkillToolResult is pure on the signal —
    // callers that build the same signal payload get byte-identical output,
    // so the wrangler /skill: handler (another repo, the handover consumer of
    // this contract) cannot drift as long as it passes the same signal fields.
    // It does NOT exercise the wrangler handler itself.
    const manifest: SkillManifest = {
      name: 'create-image',
      description: 'generate images',
      source: '/skills/create-image',
      resources: ['reference/catalog.md'],
      scripts: ['generate.js'],
    };
    const toolResult = await createLoadSkillTool(createMockProvider([manifest])).execute({
      name: 'create-image',
    });
    const toolPath = formatSkillToolResult(toolResult as SkillSignal);
    const slashPath = formatSkillToolResult({
      type: 'SWITCH_SKILL',
      to: 'create-image',
      instructions: '# create-image instructions',
      task: 'draw a sunset',
      resources: manifest.resources,
      scripts: manifest.scripts,
    });
    expect(toolPath).toBe(slashPath);
    expect(toolPath).toContain('resources: reference/catalog.md');
    expect(toolPath).toContain('scripts: generate.js');
  });
});

describe('R2P-114: filesystem provider inventory flows into the tool result', () => {
  it('formats exact top-level relative paths from a real provider manifest', async () => {
    const provider = new FilesystemSkillProvider(
      ['/skills'],
      fakeFsOps(['SKILL.md', 'reference.md', 'generate.js'])
    );
    const tool = createLoadSkillTool(provider);

    const result = formatSkillToolResult(
      (await tool.execute({ name: 'create-image' })) as SkillSignal
    );

    expect(result).toContain(RUST_SUFFIX_HEADER);
    // Exact relative paths (not absolute), partitioned per section.
    expect(result).toContain('scripts: generate.js');
    expect(result).toMatch(/resources: [^\n]*reference\.md/);
    expect(result).not.toContain('/skills/create-image/reference.md');
  });
});
