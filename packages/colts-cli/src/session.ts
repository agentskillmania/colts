/**
 * @fileoverview Session persistence — save, load, list, delete sessions
 *
 * Session file format v1:
 * ```json
 * {
 *   "version": 1,
 *   "meta": { "id": "...", "createdAt": ..., "updatedAt": ..., "messageCount": 6, "lastMessage": "..." },
 *   "state": { ... AgentState ... }
 * }
 * ```
 *
 * Backward compatible: old format without version field (raw AgentState JSON) can also be loaded and listed correctly.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AgentState } from '@agentskillmania/colts';
import { deserializeState } from '@agentskillmania/colts';

/**
 * Session metadata
 */
export interface SessionMeta {
  /** Session unique identifier */
  id: string;
  /** Creation time (millisecond timestamp) */
  createdAt: number;
  /** Last update time (millisecond timestamp) */
  updatedAt: number;
  /** Message count */
  messageCount: number;
  /** Preview of last message (truncated to 50 characters) */
  lastMessage: string;
}

/**
 * Session file format v1
 */
interface SessionFile {
  /** Format version number */
  version: number;
  /** Metadata (for fast listing without parsing full state) */
  meta: SessionMeta;
  /** Full AgentState snapshot */
  state: AgentState;
}

/** Default session file storage directory */
const DEFAULT_BASE_DIR = path.join(os.homedir(), '.agentskillmania', 'colts', 'sessions');

/** Maximum length of lastMessage preview */
const PREVIEW_MAX_LENGTH = 50;

/** Current session file format version */
const SESSION_VERSION = 1;

/**
 * Extract metadata from AgentState
 *
 * @param state - AgentState snapshot
 * @returns Metadata
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
 * Get session storage directory path
 *
 * @param baseDir - Optional custom root directory (for test isolation)
 * @returns Absolute path to session file storage directory
 */
export function getSessionDir(baseDir?: string): string {
  return baseDir ?? DEFAULT_BASE_DIR;
}

/**
 * List all sessions and their metadata
 *
 * Scans all `.json` files in the session directory and extracts metadata.
 * Returns empty array when directory does not exist.
 *
 * @param baseDir - Optional custom root directory
 * @returns Session metadata list sorted by update time descending
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
        // v1 format: read meta field directly
        metas.push(data.meta as SessionMeta);
      } else {
        // Old format (raw AgentState): extract metadata from state
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
      // File corrupted or format abnormal, skip
    }
  }

  // Sort by update time descending (newest first)
  metas.sort((a, b) => b.updatedAt - a.updatedAt);

  return metas;
}

/**
 * Save session to file
 *
 * Wraps AgentState as v1 format and writes to file.
 * Auto-creates session directory.
 *
 * @param state - AgentState to save
 * @param baseDir - Optional custom root directory
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
 * Load session
 *
 * Reads and deserializes AgentState. Automatically compatible with v1 and old formats.
 *
 * @param sessionId - Session ID to load
 * @param baseDir - Optional custom root directory
 * @returns Deserialized AgentState
 * @throws When session file does not exist
 */
export async function loadSession(sessionId: string, baseDir?: string): Promise<AgentState> {
  const sessionDir = getSessionDir(baseDir);
  const filePath = path.join(sessionDir, `${sessionId}.json`);

  const content = await fs.readFile(filePath, 'utf-8');
  const data = JSON.parse(content) as Record<string, unknown>;

  if (data.version === SESSION_VERSION && data.state) {
    // v1 format: take state field
    return data.state as AgentState;
  }

  // Old format (raw AgentState): return directly
  return deserializeState(content);
}

/**
 * Delete session
 *
 * Deletes session persistence file. Silently ignored when file does not exist.
 *
 * @param sessionId - Session ID to delete
 * @param baseDir - Optional custom root directory
 */
export async function deleteSession(sessionId: string, baseDir?: string): Promise<void> {
  const sessionDir = getSessionDir(baseDir);
  const filePath = path.join(sessionDir, `${sessionId}.json`);

  try {
    await fs.unlink(filePath);
  } catch {
    // File does not exist, silently ignore
  }
}
