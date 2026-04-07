/**
 * mkdirp unit tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdirp } from '../../src/mkdirp';

describe('mkdirp', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mkdirp-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('basic functionality', () => {
    it('should create single-level directory', async () => {
      const dirPath = path.join(tempDir, 'single');

      await mkdirp(dirPath);

      const stat = await fs.stat(dirPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should create multi-level nested directories', async () => {
      const dirPath = path.join(tempDir, 'a', 'b', 'c', 'd');

      await mkdirp(dirPath);

      const stat = await fs.stat(dirPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should not throw error when directory already exists', async () => {
      const dirPath = path.join(tempDir, 'existing');
      await fs.mkdir(dirPath);

      // Should not throw error
      await expect(mkdirp(dirPath)).resolves.not.toThrow();
    });

    it('should create remaining parts when deep directory partially exists', async () => {
      const existingPath = path.join(tempDir, 'existing');
      await fs.mkdir(existingPath);
      const dirPath = path.join(existingPath, 'new1', 'new2');

      await mkdirp(dirPath);

      const stat = await fs.stat(dirPath);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should not throw error when root directory already exists', async () => {
      // tempDir already exists
      await expect(mkdirp(tempDir)).resolves.not.toThrow();
    });

    it('empty path should be handled by fs.mkdir', async () => {
      // Empty path will be handled by fs.mkdir and may throw error
      // This is expected behavior, mkdirp does not handle empty path
      await expect(mkdirp('')).rejects.toThrow();
    });
  });
});
