/**
 * @fileoverview FilesystemSkillProvider error branch coverage tests
 *
 * Covers:
 * - readFileSync failure warning (L155)
 * - statSync failure in collectFiles (L213-214)
 * - readdirSync failure in collectFiles (L218)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  chmodSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FilesystemSkillProvider } from '../../../src/skills/filesystem-provider.js';

function createTestDir(): string {
  return mkdtempSync(join(tmpdir(), 'colts-fsp-error-test-'));
}

describe('FilesystemSkillProvider error branches', () => {
  let tempDir: string;
  const warnings: string[] = [];
  const originalWarn = console.warn;

  beforeEach(() => {
    tempDir = createTestDir();
    warnings.length = 0;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(' '));
    };
  });

  afterEach(() => {
    console.warn = originalWarn;
    // Restore permissions before cleanup
    try {
      chmodSync(tempDir, 0o755);
    } catch {
      // Ignore
    }
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should warn and skip when SKILL.md cannot be read', () => {
    // Create a directory with a SKILL.md that exists but is unreadable
    const skillDir = join(tempDir, 'unreadable-skill');
    mkdirSync(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    writeFileSync(skillFile, '---\nname: unreadable\ndescription: Test\n---\n# Body');

    // Make file unreadable
    try {
      chmodSync(skillFile, 0o000);

      const provider = new FilesystemSkillProvider([tempDir]);
      const skills = provider.listSkills();

      // Should warn about unreadable file and skip the skill
      expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining('Cannot read')]));
      expect(skills.map((s) => s.name)).not.toContain('unreadable');
    } finally {
      // Restore permissions for cleanup
      try {
        chmodSync(skillFile, 0o644);
      } catch {
        // Ignore
      }
    }
  });

  it('should skip entries when statSync fails in collectFiles', () => {
    // Create a valid skill directory with a broken symlink
    const skillDir = join(tempDir, 'stat-fail-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: stat-fail\ndescription: Test\n---\n# Body'
    );

    // Create a symlink to a non-existent file — statSync will throw ENOENT
    symlinkSync(join(skillDir, 'nonexistent.txt'), join(skillDir, 'broken-link.txt'));

    const provider = new FilesystemSkillProvider([tempDir]);
    const manifest = provider.getManifest('stat-fail');

    // Should still find the skill (SKILL.md read succeeds)
    expect(manifest).toEqual(expect.objectContaining({ name: 'stat-fail' }));
    // Resource should be empty because stat failed on broken symlink
    expect(manifest?.resources).toBeUndefined();
  });

  it('should skip entries when statSync fails in scanDirectory', () => {
    // Create a valid skill directory
    const skillDir = join(tempDir, 'valid-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: valid\ndescription: Test\n---\n# Body');

    // Create a broken symlink in the top-level directory
    // statSync in scanDirectory will throw ENOENT and skip it
    symlinkSync(join(tempDir, 'nonexistent'), join(tempDir, 'broken-symlink'));

    const provider = new FilesystemSkillProvider([tempDir]);
    const skills = provider.listSkills();

    // Should find only the valid skill (broken symlink skipped)
    expect(skills.map((s) => s.name)).toEqual(['valid']);
  });

  it('should return empty manifests when readdirSync fails on a directory', () => {
    // Create a subdirectory that will be unreadable
    const unreadableDir = join(tempDir, 'unreadable');
    mkdirSync(unreadableDir, { recursive: true });

    // Make the top-level tempDir unreadable
    chmodSync(tempDir, 0o000);

    const provider = new FilesystemSkillProvider([tempDir]);
    const skills = provider.listSkills();

    // Should return empty because readdirSync threw on tempDir
    expect(skills).toHaveLength(0);
  });
});
