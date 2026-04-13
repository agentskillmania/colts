/**
 * FilesystemSkillProvider unit tests (Step 7)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FilesystemSkillProvider } from '../../src/skills/filesystem-provider.js';
import type { SkillManifest } from '../../src/skills/types.js';

/**
 * Create temporary test directory structure
 */
function createTestDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `colts-test-${prefix}-`));
}

/**
 * Create a Skill directory containing SKILL.md
 */
function createSkillDir(
  parentDir: string,
  name: string,
  frontmatter: string,
  body: string,
  extraFiles?: Record<string, string>
): string {
  const skillDir = join(parentDir, name);
  mkdirSync(skillDir, { recursive: true });

  const content = `---\n${frontmatter}\n---\n${body}`;
  writeFileSync(join(skillDir, 'SKILL.md'), content);

  if (extraFiles) {
    for (const [fileName, fileContent] of Object.entries(extraFiles)) {
      writeFileSync(join(skillDir, fileName), fileContent);
    }
  }

  return skillDir;
}

describe('FilesystemSkillProvider (Step 7)', () => {
  let tempDir: string;
  let provider: FilesystemSkillProvider;

  beforeEach(() => {
    tempDir = createTestDir('skills');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Directory scanning', () => {
    it('should scan directories containing SKILL.md and return SkillManifest', () => {
      createSkillDir(
        tempDir,
        'my-skill',
        'name: my-skill\ndescription: A test skill',
        '# Instructions'
      );

      provider = new FilesystemSkillProvider([tempDir]);
      const skills = provider.listSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('my-skill');
      expect(skills[0].description).toBe('A test skill');
      expect(skills[0].source).toBe(join(tempDir, 'my-skill'));
    });

    it('should scan multiple directories', () => {
      const dir1 = join(tempDir, 'dir1');
      const dir2 = join(tempDir, 'dir2');
      mkdirSync(dir1, { recursive: true });
      mkdirSync(dir2, { recursive: true });

      createSkillDir(dir1, 'skill-a', 'name: skill-a\ndescription: Skill A', 'Body A');
      createSkillDir(dir2, 'skill-b', 'name: skill-b\ndescription: Skill B', 'Body B');

      provider = new FilesystemSkillProvider([dir1, dir2]);
      const skills = provider.listSkills();

      expect(skills).toHaveLength(2);
      const names = skills.map((s) => s.name);
      expect(names).toContain('skill-a');
      expect(names).toContain('skill-b');
    });

    it('subdirectories without SKILL.md should be ignored', () => {
      createSkillDir(tempDir, 'valid-skill', 'name: valid\ndescription: Valid', 'Body');
      const noSkillDir = join(tempDir, 'no-skill');
      mkdirSync(noSkillDir, { recursive: true });
      writeFileSync(join(noSkillDir, 'README.md'), 'Not a skill');

      provider = new FilesystemSkillProvider([tempDir]);
      const skills = provider.listSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('valid');
    });
  });

  describe('YAML frontmatter parsing', () => {
    it('should parse name and description', () => {
      createSkillDir(
        tempDir,
        'test',
        'name: my-awesome-skill\ndescription: This is an awesome skill',
        '# Body'
      );

      provider = new FilesystemSkillProvider([tempDir]);
      const manifest = provider.getManifest('my-awesome-skill');

      expect(manifest).toBeDefined();
      expect(manifest!.name).toBe('my-awesome-skill');
      expect(manifest!.description).toBe('This is an awesome skill');
    });

    it('should parse multi-line descriptions (| syntax)', () => {
      const frontmatter = [
        'name: multi-line-skill',
        'description: |',
        '  This is a multi-line',
        '  description for testing',
      ].join('\n');

      createSkillDir(tempDir, 'multi', frontmatter, '# Body');

      provider = new FilesystemSkillProvider([tempDir]);
      const manifest = provider.getManifest('multi-line-skill');

      expect(manifest).toBeDefined();
      expect(manifest!.description).toContain('This is a multi-line');
      expect(manifest!.description).toContain('description for testing');
    });

    it('should parse multi-line descriptions (> folded syntax)', () => {
      const frontmatter = [
        'name: folded-skill',
        'description: >',
        '  This is a folded',
        '  description',
      ].join('\n');

      createSkillDir(tempDir, 'folded', frontmatter, '# Body');

      provider = new FilesystemSkillProvider([tempDir]);
      const manifest = provider.getManifest('folded-skill');

      expect(manifest).toBeDefined();
      expect(manifest!.description).toContain('This is a folded');
      expect(manifest!.description).toContain('description');
    });

    it('should parse descriptions containing special characters', () => {
      const frontmatter = [
        'name: special-skill',
        'description: "Skill with: colons, \\"quotes\\", and [brackets]"',
      ].join('\n');

      createSkillDir(tempDir, 'special', frontmatter, '# Body');

      provider = new FilesystemSkillProvider([tempDir]);
      const manifest = provider.getManifest('special-skill');

      expect(manifest).toBeDefined();
      expect(manifest!.description).toContain('colons');
      expect(manifest!.description).toContain('quotes');
      expect(manifest!.description).toContain('brackets');
    });

    it('should handle YAML parsing failures', () => {
      // Create an invalid YAML frontmatter
      const frontmatter = [
        'name: invalid-yaml',
        'description: Test',
        'invalid: [unclosed bracket', // unclosed bracket
      ].join('\n');

      createSkillDir(tempDir, 'invalid', frontmatter, '# Body');

      // Should not throw, but return empty frontmatter
      provider = new FilesystemSkillProvider([tempDir]);
      const skills = provider.listSkills();

      // Because YAML parsing failed, name and description may be empty, causing validation failure
      // So this skill may not be loaded
      expect(skills.length).toBe(0); // filtered out because name and description are empty
    });

    it('should parse frontmatter containing numbers and booleans', () => {
      const frontmatter = [
        'name: numeric-skill',
        'description: Version 2.5 skill',
        'version: 2.5',
        'enabled: true',
      ].join('\n');

      createSkillDir(tempDir, 'numeric', frontmatter, '# Body');

      provider = new FilesystemSkillProvider([tempDir]);
      const manifest = provider.getManifest('numeric-skill');

      expect(manifest).toBeDefined();
      expect(manifest!.name).toBe('numeric-skill');
      expect(manifest!.description).toBe('Version 2.5 skill');
    });
  });

  describe('loadInstructions', () => {
    it('should load SKILL.md body content', async () => {
      createSkillDir(
        tempDir,
        'instr',
        'name: instr-skill\ndescription: Test',
        '# My Instructions\n\nDo something useful.'
      );

      provider = new FilesystemSkillProvider([tempDir]);
      const instructions = await provider.loadInstructions('instr-skill');

      expect(instructions).toContain('# My Instructions');
      expect(instructions).toContain('Do something useful.');
    });

    it('should throw error for non-existent Skill', async () => {
      provider = new FilesystemSkillProvider([tempDir]);

      await expect(provider.loadInstructions('nonexistent')).rejects.toThrow(
        'Skill not found: nonexistent'
      );
    });

    it('body should not contain frontmatter', async () => {
      createSkillDir(
        tempDir,
        'clean',
        'name: clean-skill\ndescription: Test',
        'Only body content here'
      );

      provider = new FilesystemSkillProvider([tempDir]);
      const instructions = await provider.loadInstructions('clean-skill');

      expect(instructions).not.toContain('name:');
      expect(instructions).not.toContain('description:');
      expect(instructions).toContain('Only body content here');
    });
  });

  describe('loadResource', () => {
    it('should load resource file content', async () => {
      createSkillDir(
        tempDir,
        'resource',
        'name: resource-skill\ndescription: Test',
        '# Instructions',
        {
          'template.txt': 'Hello, World!',
          'config.json': '{"key": "value"}',
        }
      );

      provider = new FilesystemSkillProvider([tempDir]);

      const txt = await provider.loadResource('resource-skill', 'template.txt');
      expect(txt).toBe('Hello, World!');

      const json = await provider.loadResource('resource-skill', 'config.json');
      expect(json).toBe('{"key": "value"}');
    });

    it('should throw error for non-existent Skill', async () => {
      provider = new FilesystemSkillProvider([tempDir]);

      await expect(provider.loadResource('nonexistent', 'file.txt')).rejects.toThrow(
        'Skill not found: nonexistent'
      );
    });

    it('should throw error for non-existent resource file', async () => {
      createSkillDir(tempDir, 'res', 'name: res-skill\ndescription: Test', '# Body');

      provider = new FilesystemSkillProvider([tempDir]);

      await expect(provider.loadResource('res-skill', 'nonexistent.txt')).rejects.toThrow();
    });
  });

  describe('getManifest', () => {
    it('should return undefined for non-existent Skill', () => {
      provider = new FilesystemSkillProvider([tempDir]);
      expect(provider.getManifest('nonexistent')).toBeUndefined();
    });

    it('should return correct SkillManifest', () => {
      createSkillDir(tempDir, 'test', 'name: test-skill\ndescription: Desc', 'Body');

      provider = new FilesystemSkillProvider([tempDir]);
      const manifest = provider.getManifest('test-skill');

      expect(manifest).toEqual({
        name: 'test-skill',
        description: 'Desc',
        source: join(tempDir, 'test'),
      } satisfies SkillManifest);
    });

    it('resource files should appear in manifest', () => {
      createSkillDir(
        tempDir,
        'with-resources',
        'name: res-skill\ndescription: Has resources',
        '# Body',
        {
          'data.txt': 'data',
          'helper.js': 'export {}',
        }
      );

      provider = new FilesystemSkillProvider([tempDir]);
      const manifest = provider.getManifest('res-skill');

      expect(manifest!.resources).toBeDefined();
      expect(manifest!.resources).toContain('data.txt');
      expect(manifest!.resources).toContain('helper.js');
      expect(manifest!.scripts).toBeDefined();
      expect(manifest!.scripts).toContain('helper.js');
    });
  });

  describe('Empty directory handling', () => {
    it('empty directory should not throw, returns empty list', () => {
      provider = new FilesystemSkillProvider([tempDir]);
      expect(provider.listSkills()).toEqual([]);
    });

    it('empty directory list should not throw', () => {
      provider = new FilesystemSkillProvider([]);
      expect(provider.listSkills()).toEqual([]);
    });
  });

  describe('Invalid SKILL.md handling', () => {
    it('SKILL.md missing name should be skipped with warning', () => {
      const skillDir = join(tempDir, 'no-name');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '---\ndescription: Only description\n---\nBody');

      const warnSpy = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnSpy.push(args);

      try {
        provider = new FilesystemSkillProvider([tempDir]);
        expect(provider.listSkills()).toEqual([]);
        expect(warnSpy.length).toBeGreaterThan(0);
        expect(warnSpy.some((args) => String(args).includes('name'))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });

    it('SKILL.md missing description should be skipped with warning', () => {
      const skillDir = join(tempDir, 'no-desc');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: only-name\n---\nBody');

      const warnSpy = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnSpy.push(args);

      try {
        provider = new FilesystemSkillProvider([tempDir]);
        expect(provider.listSkills()).toEqual([]);
        expect(warnSpy.length).toBeGreaterThan(0);
        expect(warnSpy.some((args) => String(args).includes('description'))).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });

    it('SKILL.md without frontmatter should be skipped', () => {
      const skillDir = join(tempDir, 'no-fm');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), 'Just plain markdown content');

      const warnSpy = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnSpy.push(args);

      try {
        provider = new FilesystemSkillProvider([tempDir]);
        expect(provider.listSkills()).toEqual([]);
        // Missing name and description, should have warnings
        expect(warnSpy.length).toBeGreaterThan(0);
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('refresh', () => {
    it('should discover newly added Skills', () => {
      provider = new FilesystemSkillProvider([tempDir]);
      expect(provider.listSkills()).toEqual([]);

      // Add new Skill
      createSkillDir(tempDir, 'new-skill', 'name: new-skill\ndescription: New', '# New');

      provider.refresh();
      const skills = provider.listSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('new-skill');
    });

    it('should clear deleted Skills', () => {
      createSkillDir(tempDir, 'temp-skill', 'name: temp-skill\ndescription: Temp', '# Temp');

      provider = new FilesystemSkillProvider([tempDir]);
      expect(provider.listSkills()).toHaveLength(1);

      // Delete Skill directory
      rmSync(join(tempDir, 'temp-skill'), { recursive: true, force: true });

      provider.refresh();
      expect(provider.listSkills()).toEqual([]);
    });
  });

  describe('Non-existent directories', () => {
    it('non-existent directories should be silently ignored', () => {
      const nonExistent = join(tempDir, 'does-not-exist');
      provider = new FilesystemSkillProvider([nonExistent]);
      expect(provider.listSkills()).toEqual([]);
    });

    it('mix of existing and non-existent directories should work normally', () => {
      createSkillDir(tempDir, 'existing', 'name: existing\ndescription: Exists', '# Body');

      const nonExistent = join(tempDir, 'nope');
      provider = new FilesystemSkillProvider([nonExistent, tempDir]);

      const skills = provider.listSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('existing');
    });
  });

  describe('frontmatter edge cases', () => {
    it('should be treated as no frontmatter when there is opening --- but no closing ---', () => {
      const skillDir = join(tempDir, 'open-only');
      mkdirSync(skillDir, { recursive: true });
      // Only opening ---, no closing
      writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: test\n');

      const warnSpy = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnSpy.push(args);

      try {
        provider = new FilesystemSkillProvider([tempDir]);
        // Missing closing ---, entire content treated as body, name/description missing
        expect(provider.listSkills()).toEqual([]);
      } finally {
        console.warn = originalWarn;
      }
    });

    it('should return empty string when there is no body content after frontmatter closing', async () => {
      // Construct: ---\nname: empty\ndescription: Empty\n---\n (no following body)
      const skillDir = join(tempDir, 'empty-body');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: empty-skill\ndescription: Empty\n---');

      provider = new FilesystemSkillProvider([tempDir]);
      const manifest = provider.getManifest('empty-skill');
      expect(manifest).toBeDefined();

      const instructions = await provider.loadInstructions('empty-skill');
      expect(instructions).toBe('');
    });

    it('should correctly parse frontmatter with multi-line description followed by new key-value pairs', () => {
      const frontmatter = [
        'name: complex-skill',
        'description: |',
        '  Line one',
        '  Line two',
        'extra: value',
      ].join('\n');

      createSkillDir(tempDir, 'complex', frontmatter, '# Body');

      provider = new FilesystemSkillProvider([tempDir]);
      const manifest = provider.getManifest('complex-skill');

      expect(manifest).toBeDefined();
      expect(manifest!.name).toBe('complex-skill');
      expect(manifest!.description).toContain('Line one');
      expect(manifest!.description).toContain('Line two');
    });

    it('should correctly parse multi-line description followed by empty line then key-value pairs', () => {
      const frontmatter = [
        'name: gap-skill',
        'description: |',
        '  First line',
        '',
        'extra: value',
      ].join('\n');

      createSkillDir(tempDir, 'gap', frontmatter, '# Body');

      provider = new FilesystemSkillProvider([tempDir]);
      const manifest = provider.getManifest('gap-skill');

      expect(manifest).toBeDefined();
      expect(manifest!.name).toBe('gap-skill');
      expect(manifest!.description).toContain('First line');
    });
  });

  describe('Mixed files and directories', () => {
    it('regular files in directory (non-directory items) should be ignored', () => {
      // Create a regular file under the scan directory
      writeFileSync(join(tempDir, 'regular-file.txt'), 'not a skill');

      createSkillDir(tempDir, 'real-skill', 'name: real\ndescription: Real', '# Body');

      provider = new FilesystemSkillProvider([tempDir]);
      const skills = provider.listSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('real');
    });
  });

  describe('Caching mechanism', () => {
    it('should cache instruction content to avoid repeated disk reads', async () => {
      createSkillDir(
        tempDir,
        'cached',
        'name: cached-skill\ndescription: Cached',
        '# Instructions'
      );

      provider = new FilesystemSkillProvider([tempDir]);

      // First load (from disk)
      const content1 = await provider.loadInstructions('cached-skill');
      expect(content1).toBe('# Instructions');

      // Second load (should read from cache)
      const content2 = await provider.loadInstructions('cached-skill');
      expect(content2).toBe('# Instructions');

      // Both returns same content
      expect(content1).toBe(content2);
    });

    it('should cache resource file content', async () => {
      createSkillDir(tempDir, 'res-cached', 'name: res-cached\ndescription: Cached', '# Body', {
        'data.txt': 'resource data',
      });

      provider = new FilesystemSkillProvider([tempDir]);

      // First load
      const content1 = await provider.loadResource('res-cached', 'data.txt');
      expect(content1).toBe('resource data');

      // Second load (should read from cache)
      const content2 = await provider.loadResource('res-cached', 'data.txt');
      expect(content2).toBe('resource data');

      expect(content1).toBe(content2);
    });

    it('refresh() should clear all caches', async () => {
      createSkillDir(
        tempDir,
        'refresh-test',
        'name: refresh-test\ndescription: Test',
        '# Original'
      );

      provider = new FilesystemSkillProvider([tempDir]);

      // Load and cache
      const content1 = await provider.loadInstructions('refresh-test');
      expect(content1).toBe('# Original');

      // Modify file (simulate external update)
      const skillPath = join(tempDir, 'refresh-test', 'SKILL.md');
      writeFileSync(skillPath, '---\nname: refresh-test\ndescription: Test\n---\n# Updated');

      // After refresh should return new content (refresh clears cache and manifest, rescans)
      provider.refresh();
      const content2 = await provider.loadInstructions('refresh-test');
      expect(content2).toBe('# Updated');
    });
  });

  describe('Tilde path expansion', () => {
    it('should expand ~/ paths to HOME directory and scan correctly', () => {
      const home = process.env.HOME!;
      // Create skill in a temporary location under HOME
      const testSubDir = `.colts-test-tilde-${Date.now()}`;
      const fullDir = join(home, testSubDir);
      mkdirSync(fullDir, { recursive: true });

      createSkillDir(fullDir, 'tilde-skill', 'name: tilde-skill\ndescription: Tilde', '# Body');

      // Reference with ~/ prefix
      provider = new FilesystemSkillProvider([`~/${testSubDir}`]);
      const skills = provider.listSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('tilde-skill');

      rmSync(fullDir, { recursive: true, force: true });
    });

    it('non-existent ~/ paths should be silently ignored', () => {
      provider = new FilesystemSkillProvider(['~/__colts_nonexistent_test__']);
      expect(provider.listSkills()).toEqual([]);
    });
  });
});
