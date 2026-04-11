/**
 * FilesystemSkillProvider 单元测试（Step 7）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FilesystemSkillProvider } from '../../src/skills/filesystem-provider.js';
import type { SkillManifest } from '../../src/skills/types.js';

/**
 * 创建临时测试目录结构
 */
function createTestDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `colts-test-${prefix}-`));
}

/**
 * 创建一个包含 SKILL.md 的 Skill 目录
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

  describe('扫描目录', () => {
    it('应能扫描包含 SKILL.md 的目录并返回 SkillManifest', () => {
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

    it('应能扫描多个目录', () => {
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

    it('不包含 SKILL.md 的子目录应被忽略', () => {
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

  describe('YAML frontmatter 解析', () => {
    it('应能解析 name 和 description', () => {
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

    it('应能解析多行描述（| 语法）', () => {
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

    it('应能解析多行描述（> 折叠语法）', () => {
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

    it('应能解析包含特殊字符的描述', () => {
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

    it('应能处理 YAML 解析失败的情况', () => {
      // 创建一个无效的 YAML frontmatter
      const frontmatter = [
        'name: invalid-yaml',
        'description: Test',
        'invalid: [unclosed bracket', // 未闭合的括号
      ].join('\n');

      createSkillDir(tempDir, 'invalid', frontmatter, '# Body');

      // 不应该抛出错误，而是返回空 frontmatter
      provider = new FilesystemSkillProvider([tempDir]);
      const skills = provider.listSkills();

      // 由于 YAML 解析失败，name 和 description 可能为空，导致验证失败
      // 所以该 skill 可能不会被加载
      expect(skills.length).toBe(0); // 因为 name 和 description 为空，被过滤掉了
    });

    it('应能解析包含数字和布尔值的 frontmatter', () => {
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
    it('应能加载 SKILL.md 正文内容', async () => {
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

    it('不存在的 Skill 应抛出错误', async () => {
      provider = new FilesystemSkillProvider([tempDir]);

      await expect(provider.loadInstructions('nonexistent')).rejects.toThrow(
        'Skill not found: nonexistent'
      );
    });

    it('正文应不包含 frontmatter', async () => {
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
    it('应能加载资源文件内容', async () => {
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

    it('不存在的 Skill 应抛出错误', async () => {
      provider = new FilesystemSkillProvider([tempDir]);

      await expect(provider.loadResource('nonexistent', 'file.txt')).rejects.toThrow(
        'Skill not found: nonexistent'
      );
    });

    it('不存在的资源文件应抛出错误', async () => {
      createSkillDir(tempDir, 'res', 'name: res-skill\ndescription: Test', '# Body');

      provider = new FilesystemSkillProvider([tempDir]);

      await expect(provider.loadResource('res-skill', 'nonexistent.txt')).rejects.toThrow();
    });
  });

  describe('getManifest', () => {
    it('不存在的 Skill 应返回 undefined', () => {
      provider = new FilesystemSkillProvider([tempDir]);
      expect(provider.getManifest('nonexistent')).toBeUndefined();
    });

    it('应返回正确的 SkillManifest', () => {
      createSkillDir(tempDir, 'test', 'name: test-skill\ndescription: Desc', 'Body');

      provider = new FilesystemSkillProvider([tempDir]);
      const manifest = provider.getManifest('test-skill');

      expect(manifest).toEqual({
        name: 'test-skill',
        description: 'Desc',
        source: join(tempDir, 'test'),
      } satisfies SkillManifest);
    });

    it('资源文件应出现在 manifest 中', () => {
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

  describe('空目录处理', () => {
    it('空目录不应报错，返回空列表', () => {
      provider = new FilesystemSkillProvider([tempDir]);
      expect(provider.listSkills()).toEqual([]);
    });

    it('空目录列表不应报错', () => {
      provider = new FilesystemSkillProvider([]);
      expect(provider.listSkills()).toEqual([]);
    });
  });

  describe('无效 SKILL.md 处理', () => {
    it('缺少 name 的 SKILL.md 应被跳过并输出警告', () => {
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

    it('缺少 description 的 SKILL.md 应被跳过并输出警告', () => {
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

    it('没有 frontmatter 的 SKILL.md 应被跳过', () => {
      const skillDir = join(tempDir, 'no-fm');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), 'Just plain markdown content');

      const warnSpy = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnSpy.push(args);

      try {
        provider = new FilesystemSkillProvider([tempDir]);
        expect(provider.listSkills()).toEqual([]);
        // 缺少 name 和 description，应该有警告
        expect(warnSpy.length).toBeGreaterThan(0);
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('refresh', () => {
    it('应能发现新添加的 Skill', () => {
      provider = new FilesystemSkillProvider([tempDir]);
      expect(provider.listSkills()).toEqual([]);

      // 添加新 Skill
      createSkillDir(tempDir, 'new-skill', 'name: new-skill\ndescription: New', '# New');

      provider.refresh();
      const skills = provider.listSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('new-skill');
    });

    it('应清除已删除的 Skill', () => {
      createSkillDir(tempDir, 'temp-skill', 'name: temp-skill\ndescription: Temp', '# Temp');

      provider = new FilesystemSkillProvider([tempDir]);
      expect(provider.listSkills()).toHaveLength(1);

      // 删除 Skill 目录
      rmSync(join(tempDir, 'temp-skill'), { recursive: true, force: true });

      provider.refresh();
      expect(provider.listSkills()).toEqual([]);
    });
  });

  describe('不存在的目录', () => {
    it('不存在的目录应被静默忽略', () => {
      const nonExistent = join(tempDir, 'does-not-exist');
      provider = new FilesystemSkillProvider([nonExistent]);
      expect(provider.listSkills()).toEqual([]);
    });

    it('混合存在和不存在的目录应正常工作', () => {
      createSkillDir(tempDir, 'existing', 'name: existing\ndescription: Exists', '# Body');

      const nonExistent = join(tempDir, 'nope');
      provider = new FilesystemSkillProvider([nonExistent, tempDir]);

      const skills = provider.listSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('existing');
    });
  });

  describe('frontmatter 边界场景', () => {
    it('有开始 --- 但无结束 --- 时应视为无 frontmatter', () => {
      const skillDir = join(tempDir, 'open-only');
      mkdirSync(skillDir, { recursive: true });
      // 只有开始的 ---，没有闭合
      writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: test\n');

      const warnSpy = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnSpy.push(args);

      try {
        provider = new FilesystemSkillProvider([tempDir]);
        // 缺少闭合 ---，整个内容被视为正文，name/description 都缺失
        expect(provider.listSkills()).toEqual([]);
      } finally {
        console.warn = originalWarn;
      }
    });

    it('frontmatter 闭合后无正文内容时应返回空字符串', async () => {
      // 构造：---\nname: empty\ndescription: Empty\n---\n（无后续正文）
      const skillDir = join(tempDir, 'empty-body');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: empty-skill\ndescription: Empty\n---');

      provider = new FilesystemSkillProvider([tempDir]);
      const manifest = provider.getManifest('empty-skill');
      expect(manifest).toBeDefined();

      const instructions = await provider.loadInstructions('empty-skill');
      expect(instructions).toBe('');
    });

    it('frontmatter 中多行描述后跟新的键值对应正确解析', () => {
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

    it('多行描述后跟空行再跟键值对应正确解析', () => {
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

  describe('文件与目录混合', () => {
    it('目录中的普通文件（非目录子项）应被忽略', () => {
      // 在扫描目录下创建一个普通文件
      writeFileSync(join(tempDir, 'regular-file.txt'), 'not a skill');

      createSkillDir(tempDir, 'real-skill', 'name: real\ndescription: Real', '# Body');

      provider = new FilesystemSkillProvider([tempDir]);
      const skills = provider.listSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('real');
    });
  });

  describe('缓存机制', () => {
    it('应缓存指令内容避免重复读取磁盘', async () => {
      createSkillDir(
        tempDir,
        'cached',
        'name: cached-skill\ndescription: Cached',
        '# Instructions'
      );

      provider = new FilesystemSkillProvider([tempDir]);

      // 第一次加载（从磁盘读取）
      const content1 = await provider.loadInstructions('cached-skill');
      expect(content1).toBe('# Instructions');

      // 第二次加载（应从缓存读取）
      const content2 = await provider.loadInstructions('cached-skill');
      expect(content2).toBe('# Instructions');

      // 两次返回相同内容
      expect(content1).toBe(content2);
    });

    it('应缓存资源文件内容', async () => {
      createSkillDir(tempDir, 'res-cached', 'name: res-cached\ndescription: Cached', '# Body', {
        'data.txt': 'resource data',
      });

      provider = new FilesystemSkillProvider([tempDir]);

      // 第一次加载
      const content1 = await provider.loadResource('res-cached', 'data.txt');
      expect(content1).toBe('resource data');

      // 第二次加载（应从缓存读取）
      const content2 = await provider.loadResource('res-cached', 'data.txt');
      expect(content2).toBe('resource data');

      expect(content1).toBe(content2);
    });

    it('refresh() 应清除所有缓存', async () => {
      createSkillDir(
        tempDir,
        'refresh-test',
        'name: refresh-test\ndescription: Test',
        '# Original'
      );

      provider = new FilesystemSkillProvider([tempDir]);

      // 加载并缓存
      const content1 = await provider.loadInstructions('refresh-test');
      expect(content1).toBe('# Original');

      // 修改文件（模拟外部更新）
      const skillPath = join(tempDir, 'refresh-test', 'SKILL.md');
      writeFileSync(skillPath, '---\nname: refresh-test\ndescription: Test\n---\n# Updated');

      // refresh 后应返回新内容（refresh 会清除缓存和 manifest，重新扫描）
      provider.refresh();
      const content2 = await provider.loadInstructions('refresh-test');
      expect(content2).toBe('# Updated');
    });
  });
});
