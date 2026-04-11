/**
 * @fileoverview Conversation history management — session persistence and loading
 *
 * Provides save, load, list, and delete operations for sessions.
 * Sessions are stored as JSON files on the filesystem, one file per session.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AgentState } from '@agentskillmania/colts';
import { serializeState, deserializeState } from '@agentskillmania/colts';

/**
 * Session metadata
 */
export interface SessionMeta {
  /** Unique session identifier */
  id: string;
  /** Creation timestamp in milliseconds */
  createdAt: number;
  /** Message count */
  messageCount: number;
  /** Last message preview (truncated to 50 characters) */
  lastMessage: string;
}

/** Default session storage root directory */
const DEFAULT_BASE_DIR = path.join(os.homedir(), '.agentskillmania', 'colts', 'sessions');

/** Maximum length for lastMessage preview */
const PREVIEW_MAX_LENGTH = 50;

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
 * List all sessions with metadata
 *
 * Scans all `.json` files in the session directory and extracts metadata.
 * Returns an empty array if the directory does not exist.
 *
 * @param baseDir - Optional custom root directory
 * @returns Session metadata list sorted by creation time (newest first)
 */
export async function listSessions(baseDir?: string): Promise<SessionMeta[]> {
  const sessionDir = getSessionDir(baseDir);

  let files: string[];
  try {
    files = await fs.readdir(sessionDir);
  } catch {
    // Directory does not exist, return empty list
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
      // File is corrupted or malformed, skip it
    }
  }

  // Sort by creation time descending (newest first)
  metas.sort((a, b) => b.createdAt - a.createdAt);

  return metas;
}

/**
 * Save a session to file
 *
 * Serializes an AgentState to JSON and writes it to a file.
 * Creates the session directory if it doesn't exist.
 *
 * @param state - AgentState to save
 * @param baseDir - Optional custom root directory
 */
export async function saveSession(state: AgentState, baseDir?: string): Promise<void> {
  const sessionDir = getSessionDir(baseDir);
  await fs.mkdir(sessionDir, { recursive: true });

  const filePath = path.join(sessionDir, `${state.id}.json`);
  const json = serializeState(state);
  await fs.writeFile(filePath, json, 'utf-8');
}

/**
 * Load a session
 *
 * Reads and deserializes an AgentState from a file.
 *
 * @param sessionId - Session ID to load
 * @param baseDir - Optional custom root directory
 * @returns Deserialized AgentState
 * @throws If session file does not exist
 */
export async function loadSession(sessionId: string, baseDir?: string): Promise<AgentState> {
  const sessionDir = getSessionDir(baseDir);
  const filePath = path.join(sessionDir, `${sessionId}.json`);

  const content = await fs.readFile(filePath, 'utf-8');
  return deserializeState(content);
}

/**
 * Delete a session
 *
 * Deletes the persisted file for a session. Silently ignores if the file doesn't exist.
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
    // File doesn't exist, silently ignore
  }
}
