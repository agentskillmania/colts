/**
 * @fileoverview 对话历史管理 — 会话的持久化存储与加载
 *
 * 提供会话的保存、加载、列举和删除功能。
 * 会话以 JSON 文件形式存储在文件系统中，每个会话对应一个文件。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdirp } from '@agentskillmania/settings-yaml';
import type { AgentState } from '@agentskillmania/colts';
import { serializeState, deserializeState } from '@agentskillmania/colts';

/**
 * 会话元数据
 */
export interface SessionMeta {
  /** 会话唯一标识 */
  id: string;
  /** 创建时间戳（毫秒） */
  createdAt: number;
  /** 消息数量 */
  messageCount: number;
  /** 最后一条消息预览（截断至 50 字符） */
  lastMessage: string;
}

/** 会话文件默认存储根目录 */
const DEFAULT_BASE_DIR = path.join(os.homedir(), '.agentskillmania', 'colts', 'sessions');

/** lastMessage 预览的最大长度 */
const PREVIEW_MAX_LENGTH = 50;

/**
 * 获取会话存储目录路径
 *
 * @param baseDir - 可选的自定义根目录（测试隔离用）
 * @returns 会话文件存储目录的绝对路径
 */
export function getSessionDir(baseDir?: string): string {
  return baseDir ?? DEFAULT_BASE_DIR;
}

/**
 * 列出所有会话及其元数据
 *
 * 扫描会话目录下的所有 `.json` 文件，提取元数据信息。
 * 如果目录不存在则返回空数组。
 *
 * @param baseDir - 可选的自定义根目录
 * @returns 按创建时间降序排列的会话元数据列表
 */
export async function listSessions(baseDir?: string): Promise<SessionMeta[]> {
  const sessionDir = getSessionDir(baseDir);

  let files: string[];
  try {
    files = await fs.readdir(sessionDir);
  } catch {
    // 目录不存在，返回空列表
    return [];
  }

  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  const metas: SessionMeta[] = [];

  for (const file of jsonFiles) {
    const filePath = path.join(sessionDir, file);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as AgentState;

      const messages = data.context?.messages ?? [];
      const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
      const lastMessage = lastMsg?.content ?? '';
      const preview =
        lastMessage.length > PREVIEW_MAX_LENGTH
          ? lastMessage.slice(0, PREVIEW_MAX_LENGTH)
          : lastMessage;

      metas.push({
        id: data.id,
        createdAt: messages.length > 0 && messages[0].timestamp ? messages[0].timestamp : 0,
        messageCount: messages.length,
        lastMessage: preview,
      });
    } catch {
      // 文件损坏或格式不正确，跳过该文件
    }
  }

  // 按创建时间降序排列（最新的在前）
  metas.sort((a, b) => b.createdAt - a.createdAt);

  return metas;
}

/**
 * 保存会话到文件
 *
 * 将 AgentState 序列化为 JSON 并写入文件。
 * 如果会话目录不存在会自动创建。
 *
 * @param state - 要保存的 AgentState
 * @param baseDir - 可选的自定义根目录
 */
export async function saveSession(state: AgentState, baseDir?: string): Promise<void> {
  const sessionDir = getSessionDir(baseDir);
  await mkdirp(sessionDir);

  const filePath = path.join(sessionDir, `${state.id}.json`);
  const json = serializeState(state);
  await fs.writeFile(filePath, json, 'utf-8');
}

/**
 * 加载会话
 *
 * 从文件中读取并反序列化 AgentState。
 *
 * @param sessionId - 要加载的会话 ID
 * @param baseDir - 可选的自定义根目录
 * @returns 反序列化后的 AgentState
 * @throws 如果会话文件不存在
 */
export async function loadSession(sessionId: string, baseDir?: string): Promise<AgentState> {
  const sessionDir = getSessionDir(baseDir);
  const filePath = path.join(sessionDir, `${sessionId}.json`);

  const content = await fs.readFile(filePath, 'utf-8');
  return deserializeState(content);
}

/**
 * 删除会话
 *
 * 删除指定会话的持久化文件。如果文件不存在则静默忽略。
 *
 * @param sessionId - 要删除的会话 ID
 * @param baseDir - 可选的自定义根目录
 */
export async function deleteSession(sessionId: string, baseDir?: string): Promise<void> {
  const sessionDir = getSessionDir(baseDir);
  const filePath = path.join(sessionDir, `${sessionId}.json`);

  try {
    await fs.unlink(filePath);
  } catch {
    // 文件不存在时静默忽略
  }
}
