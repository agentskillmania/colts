/**
 * @fileoverview FilesystemSkillProvider cache coverage tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FilesystemSkillProvider } from '../../../src/skills/filesystem-provider.js';

function createTestDir(): string {
  return mkdtempSync(join(tmpdir(), 'colts-cache-test-'));
}

function createSkillDir(parentDir: string, name: string, frontmatter: string, body: string): void {
  const skillDir = join(parentDir, name);
  mkdirSync(skillDir, { recursive: true });
  const content = `---\n${frontmatter}\n---\n${body}`;
  writeFileSync(join(skillDir, 'SKILL.md'), content);
}

describe('FilesystemSkillProvider cache coverage', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTestDir();
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should return cached instructions when mtime matches', async () => {
    createSkillDir(tempDir, 'cached', 'name: cached\ndescription: Test', '# Body');

    const provider = new FilesystemSkillProvider([tempDir]);

    // First load - cache miss
    const content1 = await provider.loadInstructions('cached');
    expect(content1).toBe('# Body');

    // Second load - cache hit (same mtime)
    const content2 = await provider.loadInstructions('cached');
    expect(content2).toBe('# Body');
  });

  it('should re-read when mtime changes (cache stale)', async () => {
    createSkillDir(tempDir, 'stale', 'name: stale\ndescription: Test', '# Old');

    const provider = new FilesystemSkillProvider([tempDir]);

    // First load
    await provider.loadInstructions('stale');

    // Modify file and update mtime
    const skillPath = join(tempDir, 'stale', 'SKILL.md');
    writeFileSync(skillPath, '---\nname: stale\ndescription: Test\n---\n# New');
    const now = Date.now() / 1000 + 1;
    utimesSync(skillPath, now, now);

    // Second load - cache stale, re-read
    const content2 = await provider.loadInstructions('stale');
    expect(content2).toBe('# New');
  });

  it('should use cache fallback when stat fails but cache exists', async () => {
    createSkillDir(tempDir, 'broken', 'name: broken\ndescription: Test', '# Cached');

    const provider = new FilesystemSkillProvider([tempDir]);

    // Prime cache
    await provider.loadInstructions('broken');

    // Delete file but keep cache entry
    rmSync(join(tempDir, 'broken', 'SKILL.md'));

    // Should return cached content when stat fails
    const content = await provider.loadInstructions('broken');
    expect(content).toBe('# Cached');
  });

  it('should throw when stat fails and no cache exists', async () => {
    createSkillDir(tempDir, 'missing', 'name: missing\ndescription: Test', '# Body');

    const provider = new FilesystemSkillProvider([tempDir]);
    provider.refresh(); // Load manifest

    // Delete file without priming cache
    rmSync(join(tempDir, 'missing', 'SKILL.md'));

    await expect(provider.loadInstructions('missing')).rejects.toThrow(
      'Failed to load instructions'
    );
  });

  it('should return cached resource when mtime matches', async () => {
    createSkillDir(tempDir, 'res', 'name: res\ndescription: Test', '# Body');
    writeFileSync(join(tempDir, 'res', 'data.txt'), 'resource data');

    const provider = new FilesystemSkillProvider([tempDir]);

    // First load - cache miss
    const content1 = await provider.loadResource('res', 'data.txt');
    expect(content1).toBe('resource data');

    // Second load - cache hit
    const content2 = await provider.loadResource('res', 'data.txt');
    expect(content2).toBe('resource data');
  });

  it('should use resource cache fallback when stat fails but cache exists', async () => {
    createSkillDir(tempDir, 'res-broken', 'name: res-broken\ndescription: Test', '# Body');
    writeFileSync(join(tempDir, 'res-broken', 'data.txt'), 'cached resource');

    const provider = new FilesystemSkillProvider([tempDir]);

    // Prime cache
    await provider.loadResource('res-broken', 'data.txt');

    // Delete file
    rmSync(join(tempDir, 'res-broken', 'data.txt'));

    // Should return cached content
    const content = await provider.loadResource('res-broken', 'data.txt');
    expect(content).toBe('cached resource');
  });

  it('should throw when resource stat fails and no cache exists', async () => {
    createSkillDir(tempDir, 'res-missing', 'name: res-missing\ndescription: Test', '# Body');
    writeFileSync(join(tempDir, 'res-missing', 'data.txt'), 'data');

    const provider = new FilesystemSkillProvider([tempDir]);
    provider.refresh();

    rmSync(join(tempDir, 'res-missing', 'data.txt'));

    await expect(provider.loadResource('res-missing', 'data.txt')).rejects.toThrow(
      'Failed to load resource'
    );
  });
});
