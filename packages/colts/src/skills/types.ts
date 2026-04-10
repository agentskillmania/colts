/**
 * @fileoverview Skill 类型定义
 *
 * 定义 Skill 系统的核心接口和元数据结构。
 */

/**
 * Skill 元数据（Level 1，始终加载）
 *
 * 描述一个 Skill 的基本信息，无需加载完整内容即可获取。
 */
export interface SkillManifest {
  /** Skill 名称（唯一标识符） */
  name: string;
  /** Skill 描述 */
  description: string;
  /** Skill 源目录路径 */
  source: string;
  /** 资源文件相对路径列表 */
  resources?: string[];
  /** 脚本文件相对路径列表 */
  scripts?: string[];
}

/**
 * Skill 提供者接口
 *
 * 定义 Skill 发现、加载和资源访问的抽象接口，
 * 支持不同的存储后端实现（文件系统、远程服务等）。
 */
export interface ISkillProvider {
  /**
   * 获取指定 Skill 的元数据
   *
   * @param name - Skill 名称
   * @returns Skill 元数据，未找到时返回 undefined
   */
  getManifest(name: string): SkillManifest | undefined;

  /**
   * 加载指定 Skill 的指令内容（SKILL.md 正文部分）
   *
   * @param name - Skill 名称
   * @returns SKILL.md 正文内容
   * @throws Error 当 Skill 不存在时抛出
   */
  loadInstructions(name: string): Promise<string>;

  /**
   * 加载指定 Skill 的资源文件内容
   *
   * @param name - Skill 名称
   * @param relativePath - 相对于 Skill 目录的资源文件路径
   * @returns 资源文件内容
   * @throws Error 当 Skill 不存在或资源文件无法读取时抛出
   */
  loadResource(name: string, relativePath: string): Promise<string>;

  /**
   * 列出所有已发现的 Skill 元数据
   *
   * @returns 所有 Skill 元数据数组
   */
  listSkills(): SkillManifest[];

  /**
   * 重新扫描目录，刷新 Skill 缓存
   */
  refresh(): void;
}
