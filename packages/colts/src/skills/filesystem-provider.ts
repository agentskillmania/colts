/**
 * @fileoverview 文件系统 Skill 提供者
 *
 * 从文件系统目录扫描和加载 Skill，支持 YAML frontmatter 解析。
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SkillManifest, ISkillProvider } from './types.js';

/**
 * SKILL.md 文件名常量
 */
const SKILL_FILE = 'SKILL.md';

/**
 * 从 SKILL.md 内容解析 YAML frontmatter
 *
 * 支持格式：
 * - 简单键值对：`name: value`
 * - 多行字符串：`description: |` 或 `description: >`
 *
 * @param content - SKILL.md 文件完整内容
 * @returns 解析结果，包含 frontmatter 字段和正文内容
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const result: { frontmatter: Record<string, string>; body: string } = {
    frontmatter: {},
    body: '',
  };

  // 匹配以 --- 开头的 frontmatter 块
  const frontmatterRegex = /^---\s*\n/;
  if (!frontmatterRegex.test(content)) {
    // 没有 frontmatter，整个内容作为正文
    result.body = content;
    return result;
  }

  // 去掉第一个 ---，查找第二个 ---
  const afterFirstDelimiter = content.replace(frontmatterRegex, '');
  const secondDelimiterIndex = afterFirstDelimiter.indexOf('\n---');

  if (secondDelimiterIndex === -1) {
    // 没有闭合的 ---，整个内容作为正文
    result.body = content;
    return result;
  }

  const frontmatterText = afterFirstDelimiter.substring(0, secondDelimiterIndex);
  const bodyStart = afterFirstDelimiter.indexOf('\n', secondDelimiterIndex + 4);
  result.body = bodyStart === -1 ? '' : afterFirstDelimiter.substring(bodyStart + 1);

  // 解析 YAML 键值对
  const lines = frontmatterText.split('\n');
  let currentKey = '';
  let currentValue = '';
  let inMultiline = false;
  // 注：multiline indicator（| 或 >）不存储，当前统一按折叠多行处理

  for (const line of lines) {
    if (inMultiline) {
      // 多行值收集：遇到缩进减少或空行时结束
      if (line === '' || (!line.startsWith(' ') && !line.startsWith('\t'))) {
        // 结束多行值
        result.frontmatter[currentKey] = currentValue.trim();
        inMultiline = false;
        // 继续处理当前行（可能是新的键值对）
        const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
        if (kvMatch) {
          currentKey = kvMatch[1];
          const value = kvMatch[2].trim();
          if (value === '|' || value === '>') {
            inMultiline = true;
            // 不需要区分 | 和 >，统一处理
            currentValue = '';
          } else {
            result.frontmatter[currentKey] = value;
          }
        }
      } else {
        // 收集多行内容（去掉一级缩进）
        const trimmedLine = line.replace(/^ (\s?.*)/, '$1');
        currentValue += (currentValue ? '\n' : '') + trimmedLine;
      }
    } else {
      const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
      if (kvMatch) {
        currentKey = kvMatch[1];
        const value = kvMatch[2].trim();
        if (value === '|' || value === '>') {
          inMultiline = true;
          // 不需要区分 | 和 >，统一处理
          currentValue = '';
        } else {
          result.frontmatter[currentKey] = value;
        }
      }
    }
  }

  // 处理最后一个多行值
  if (inMultiline && currentKey) {
    result.frontmatter[currentKey] = currentValue.trim();
  }

  return result;
}

/**
 * 扫描指定目录，发现包含 SKILL.md 的子目录
 *
 * @param directory - 要扫描的根目录
 * @returns 发现的 Skill 元数据数组
 */
function scanDirectory(directory: string): SkillManifest[] {
  const manifests: SkillManifest[] = [];
  const resolvedDir = resolve(directory);

  if (!existsSync(resolvedDir)) {
    return manifests;
  }

  let entries;
  try {
    entries = readdirSync(resolvedDir);
  } catch {
    // 无法读取目录，静默跳过
    return manifests;
  }

  for (const entry of entries) {
    const entryPath = join(resolvedDir, entry);

    // 只处理目录
    let stat;
    try {
      stat = statSync(entryPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) {
      continue;
    }

    // 检查是否包含 SKILL.md
    const skillFilePath = join(entryPath, SKILL_FILE);
    if (!existsSync(skillFilePath)) {
      continue;
    }

    // 读取并解析 SKILL.md
    let content: string;
    try {
      content = readFileSync(skillFilePath, 'utf-8');
    } catch {
      // 无法读取文件，跳过
      console.warn(`[colts] 无法读取 ${skillFilePath}，已跳过`);
      continue;
    }

    const { frontmatter } = parseFrontmatter(content);

    // 验证必需字段
    const name = frontmatter['name'];
    const description = frontmatter['description'];

    if (!name || !description) {
      console.warn(`[colts] ${skillFilePath} 缺少必需的 name 或 description 字段，已跳过`);
      continue;
    }

    // 收集资源文件列表
    const resources = collectFiles(entryPath, (fileName) => {
      return fileName !== SKILL_FILE;
    });

    // 收集脚本文件列表
    const scripts = collectFiles(entryPath, (fileName) => {
      return fileName.endsWith('.js') || fileName.endsWith('.ts') || fileName.endsWith('.mjs');
    });

    manifests.push({
      name,
      description,
      source: entryPath,
      resources: resources.length > 0 ? resources : undefined,
      scripts: scripts.length > 0 ? scripts : undefined,
    });
  }

  return manifests;
}

/**
 * 收集目录下的文件相对路径列表
 *
 * 只收集顶层文件，不递归子目录。
 *
 * @param dirPath - 目录绝对路径
 * @param filter - 文件名过滤函数
 * @returns 符合条件的文件相对路径数组
 */
function collectFiles(dirPath: string, filter: (fileName: string) => boolean): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      const entryPath = join(dirPath, entry);
      try {
        const stat = statSync(entryPath);
        if (stat.isFile() && filter(entry)) {
          files.push(entry);
        }
      } catch {
        continue;
      }
    }
  } catch {
    // 无法读取目录
  }
  return files;
}

/**
 * 文件系统 Skill 提供者
 *
 * 从指定的目录列表中扫描包含 SKILL.md 的子目录，
 * 解析 YAML frontmatter 获取元数据，按需加载指令和资源。
 *
 * @example
 * ```typescript
 * const provider = new FilesystemSkillProvider(['/path/to/skills']);
 *
 * // 列出所有已发现的 Skill
 * const skills = provider.listSkills();
 *
 * // 加载某个 Skill 的指令
 * const instructions = await provider.loadInstructions('my-skill');
 * ```
 */
export class FilesystemSkillProvider implements ISkillProvider {
  /** 已发现的 Skill 元数据缓存（name -> manifest） */
  private manifests = new Map<string, SkillManifest>();

  /** 要扫描的目录列表 */
  private directories: string[];

  /**
   * 创建文件系统 Skill 提供者
   *
   * @param directories - 要扫描的目录路径列表
   */
  constructor(directories: string[]) {
    this.directories = directories;
    this.discover();
  }

  /**
   * 获取指定 Skill 的元数据
   *
   * @param name - Skill 名称
   * @returns Skill 元数据，未找到时返回 undefined
   */
  getManifest(name: string): SkillManifest | undefined {
    return this.manifests.get(name);
  }

  /**
   * 加载指定 Skill 的指令内容（SKILL.md 正文部分，不含 frontmatter）
   *
   * @param name - Skill 名称
   * @returns SKILL.md 正文内容
   * @throws Error 当 Skill 不存在时抛出
   */
  async loadInstructions(name: string): Promise<string> {
    const manifest = this.manifests.get(name);
    if (!manifest) {
      throw new Error(`Skill not found: ${name}`);
    }

    const skillFilePath = join(manifest.source, SKILL_FILE);
    const content = readFileSync(skillFilePath, 'utf-8');
    const { body } = parseFrontmatter(content);

    return body;
  }

  /**
   * 加载指定 Skill 的资源文件内容
   *
   * @param name - Skill 名称
   * @param relativePath - 相对于 Skill 目录的资源文件路径
   * @returns 资源文件内容
   * @throws Error 当 Skill 不存在或资源文件无法读取时抛出
   */
  async loadResource(name: string, relativePath: string): Promise<string> {
    const manifest = this.manifests.get(name);
    if (!manifest) {
      throw new Error(`Skill not found: ${name}`);
    }

    const resourcePath = join(manifest.source, relativePath);
    return readFileSync(resourcePath, 'utf-8');
  }

  /**
   * 列出所有已发现的 Skill 元数据
   *
   * @returns 所有 Skill 元数据数组
   */
  listSkills(): SkillManifest[] {
    return Array.from(this.manifests.values());
  }

  /**
   * 重新扫描目录，刷新 Skill 缓存
   *
   * 清空现有缓存并重新发现所有目录中的 Skill。
   */
  refresh(): void {
    this.manifests.clear();
    this.discover();
  }

  /**
   * 执行目录扫描，发现所有 Skill
   */
  private discover(): void {
    for (const dir of this.directories) {
      const found = scanDirectory(dir);
      for (const manifest of found) {
        this.manifests.set(manifest.name, manifest);
      }
    }
  }
}
