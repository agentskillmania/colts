/**
 * @fileoverview 会话持久化 — 保存、加载、列出、删除会话
 *
 * 会话文件格式 v1：
 * ```json
 * {
 *   "version": 1,
 *   "meta": { "id": "...", "createdAt": ..., "updatedAt": ..., "messageCount": 6, "lastMessage": "..." },
 *   "state": { ... AgentState ... }
 * }
 * ```
 *
 * 向后兼容：没有 version 字段的旧格式（裸 AgentState JSON）也能正确加载和列出。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AgentState } from '@agentskillmania/colts';
import { deserializeState } from '@agentskillmania/colts';

/**
 * 会话元数据
 */
export interface SessionMeta {
  /** 会话唯一标识 */
  id: string;
  /** 创建时间（毫秒时间戳） */
  createdAt: number;
  /** 最后更新时间（毫秒时间戳） */
  updatedAt: number;
  /** 消息数量 */
  messageCount: number;
  /** 最后一条消息预览（截断到 50 字符） */
  lastMessage: string;
}

/**
 * 会话文件格式 v1
 */
interface SessionFile {
  /** 格式版本号 */
  version: number;
  /** 元数据（用于快速列出，不解析完整 state） */
  meta: SessionMeta;
  /** 完整 AgentState 快照 */
  state: AgentState;
}

/** 会话文件默认存储目录 */
const DEFAULT_BASE_DIR = path.join(os.homedir(), '.agentskillmania', 'colts', 'sessions');

/** lastMessage 预览最大长度 */
const PREVIEW_MAX_LENGTH = 50;

/** 当前会话文件格式版本 */
const SESSION_VERSION = 1;

/**
 * 从 AgentState 提取元数据
 *
 * @param state - AgentState 快照
 * @returns 元数据
 */
function extractMeta(state: AgentState): SessionMeta {
  const messages = state.context?.messages ?? [];
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastMessage = lastMsg?.content ?? '';
  const preview =
    lastMessage.length > PREVIEW_MAX_LENGTH
      ? lastMessage.slice(0, PREVIEW_MAX_LENGTH)
      : lastMessage;

  const now = Date.now();
  const createdAt = messages.length > 0 && messages[0].timestamp ? messages[0].timestamp : now;

  return {
    id: state.id,
    createdAt,
    updatedAt: now,
    messageCount: messages.length,
    lastMessage: preview,
  };
}

/**
 * 获取会话存储目录路径
 *
 * @param baseDir - 可选自定义根目录（用于测试隔离）
 * @returns 会话文件存储目录的绝对路径
 */
export function getSessionDir(baseDir?: string): string {
  return baseDir ?? DEFAULT_BASE_DIR;
}

/**
 * 列出所有会话及其元数据
 *
 * 扫描会话目录下的所有 `.json` 文件并提取元数据。
 * 目录不存在时返回空数组。
 *
 * @param baseDir - 可选自定义根目录
 * @returns 按更新时间降序排列的会话元数据列表
 */
export async function listSessions(baseDir?: string): Promise<SessionMeta[]> {
  const sessionDir = getSessionDir(baseDir);

  let files: string[];
  try {
    files = await fs.readdir(sessionDir);
  } catch {
    return [];
  }

  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  const metas: SessionMeta[] = [];

  for (const file of jsonFiles) {
    const filePath = path.join(sessionDir, file);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as Record<string, unknown>;

      if (data.version === SESSION_VERSION && data.meta) {
        // v1 格式：直接读 meta 字段
        metas.push(data.meta as SessionMeta);
      } else {
        // 旧格式（裸 AgentState）：从 state 中提取元数据
        const state = data as unknown as AgentState;
        const messages = state.context?.messages ?? [];
        const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
        const lastMessage = lastMsg?.content ?? '';
        const preview =
          lastMessage.length > PREVIEW_MAX_LENGTH
            ? lastMessage.slice(0, PREVIEW_MAX_LENGTH)
            : lastMessage;
        const createdAt = messages.length > 0 && messages[0].timestamp ? messages[0].timestamp : 0;

        metas.push({
          id: state.id,
          createdAt,
          updatedAt: createdAt,
          messageCount: messages.length,
          lastMessage: preview,
        });
      }
    } catch {
      // 文件损坏或格式异常，跳过
    }
  }

  // 按更新时间降序排列（最新的在前）
  metas.sort((a, b) => b.updatedAt - a.updatedAt);

  return metas;
}

/**
 * 保存会话到文件
 *
 * 将 AgentState 包装为 v1 格式写入文件。
 * 自动创建会话目录。
 *
 * @param state - 要保存的 AgentState
 * @param baseDir - 可选自定义根目录
 */
export async function saveSession(state: AgentState, baseDir?: string): Promise<void> {
  const sessionDir = getSessionDir(baseDir);
  await fs.mkdir(sessionDir, { recursive: true });

  const meta = extractMeta(state);
  const sessionFile: SessionFile = {
    version: SESSION_VERSION,
    meta,
    state,
  };

  const filePath = path.join(sessionDir, `${state.id}.json`);
  const json = JSON.stringify(sessionFile);
  await fs.writeFile(filePath, json, 'utf-8');
}

/**
 * 加载会话
 *
 * 读取并反序列化 AgentState。自动兼容 v1 格式和旧格式。
 *
 * @param sessionId - 要加载的会话 ID
 * @param baseDir - 可选自定义根目录
 * @returns 反序列化后的 AgentState
 * @throws 会话文件不存在时抛出异常
 */
export async function loadSession(sessionId: string, baseDir?: string): Promise<AgentState> {
  const sessionDir = getSessionDir(baseDir);
  const filePath = path.join(sessionDir, `${sessionId}.json`);

  const content = await fs.readFile(filePath, 'utf-8');
  const data = JSON.parse(content) as Record<string, unknown>;

  if (data.version === SESSION_VERSION && data.state) {
    // v1 格式：取 state 字段
    return data.state as AgentState;
  }

  // 旧格式（裸 AgentState）：直接返回
  return deserializeState(content);
}

/**
 * 删除会话
 *
 * 删除会话的持久化文件。文件不存在时静默忽略。
 *
 * @param sessionId - 要删除的会话 ID
 * @param baseDir - 可选自定义根目录
 */
export async function deleteSession(sessionId: string, baseDir?: string): Promise<void> {
  const sessionDir = getSessionDir(baseDir);
  const filePath = path.join(sessionDir, `${sessionId}.json`);

  try {
    await fs.unlink(filePath);
  } catch {
    // 文件不存在，静默忽略
  }
}
