/**
 * @fileoverview `file:` attachment materializer (Node fs).
 *
 * Runs at the last moment before the LLM call, on the wire copy of the
 * messages only — the agent state and the session archive keep the `file:`
 * reference forever, so base64 never lands in persisted history or event
 * payloads. Dynamically imported by the calling-llm phase handler; not
 * re-exported through the platform-neutral main barrel.
 * (R2P-107, aligned with Rust colts attachments.rs.)
 */

import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import type {
  ImageContent,
  Message,
  TextContent,
  ThinkingContent,
  ToolCallContent,
} from '@agentskillmania/llm-client';

import { FILE_REF_PREFIX, isFileRef } from './core.js';

const SUPPORTED_IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** Mime from file extension; unknown extensions default to png (Rust parity). */
function mimeFromExtension(filePath: string): string {
  return SUPPORTED_IMAGE_MIME[path.extname(filePath).toLowerCase()] ?? 'image/png';
}

/**
 * Resolve a `file:<relative>` reference against the attachment dir.
 *
 * Rejects empty refs, absolute paths, `..` components, and — as a second
 * line of defense — anything that escapes the dir after realpath
 * canonicalization (symlinks included). Every error names the offending ref.
 */
async function resolveRef(ref: string, dir: string): Promise<string> {
  const rel = ref.slice(FILE_REF_PREFIX.length);
  if (rel.length === 0) {
    throw new Error(`attachment reference '${ref}' has an empty path`);
  }
  if (path.isAbsolute(rel)) {
    throw new Error(`attachment reference '${ref}' must be a relative path`);
  }
  if (rel.split(/[\\/]/).includes('..')) {
    throw new Error(`attachment reference '${ref}' must not traverse outside the session dir`);
  }
  const resolved = path.resolve(dir, rel);
  // Double defense: canonicalize both sides and re-verify containment —
  // a symlink inside the dir pointing outside must not slip through.
  const [resolvedReal, dirReal] = await Promise.all([realpath(resolved), realpath(dir)]);
  if (resolvedReal !== dirReal && !resolvedReal.startsWith(dirReal + path.sep)) {
    throw new Error(`attachment reference '${ref}' resolves outside the session dir`);
  }
  return resolved;
}

/**
 * Materialize `file:` reference parts into inline base64 on a copy of the
 * messages. Pure with respect to the input: only the returned wire copy
 * carries base64. Throws (Error, message names the ref) on unreadable or
 * escaping refs — callers treat it as an LLM-call failure.
 *
 * @param messages - Wire messages built for the LLM request
 * @param dir - Attachment anchor dir (usually the session dir). Required
 *   whenever any `file:` ref is present.
 */
export async function materializeFileRefs(messages: Message[], dir?: string): Promise<Message[]> {
  // Wire parts union: user/toolResult messages carry Text|Image (that's
  // where refs live); assistant shapes never do — they pass through as-is.
  type WirePart = TextContent | ImageContent | ThinkingContent | ToolCallContent;
  const result: Message[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      result.push(message);
      continue;
    }
    let changed = false;
    const content: WirePart[] = [];
    for (const part of message.content as WirePart[]) {
      if (part.type !== 'image' || part.ref === undefined || !isFileRef(part.ref)) {
        content.push(part);
        continue;
      }
      if (dir === undefined) {
        throw new Error(
          `attachment reference '${part.ref}' cannot be resolved: no attachment dir configured`
        );
      }
      const filePath = await resolveRef(part.ref, dir);
      let bytes: Buffer;
      try {
        bytes = await readFile(filePath);
      } catch {
        throw new Error(`attachment reference '${part.ref}' could not be read`);
      }
      changed = true;
      const inline: ImageContent = {
        type: 'image',
        data: bytes.toString('base64'),
        mimeType: mimeFromExtension(filePath),
      };
      content.push(inline);
    }
    // Wire Message is a per-role union; only user/toolResult rows can change
    // (refs live there). The broadened parts array narrows back on push.
    result.push(changed ? ({ ...message, content } as Message) : message);
  }
  return result;
}
