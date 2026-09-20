/**
 * @fileoverview `file:` attachment references — platform-neutral core.
 *
 * Multimodal user messages may carry image parts in reference form
 * (`{ type: 'image', ref: 'file:<relative path>' }`). The archive keeps the
 * reference forever; the wire copy is materialized into inline base64 right
 * before the LLM call (see ./node.ts). This module holds the fs-free parts
 * so the main barrel stays platform-neutral — the fs-touching materializer
 * lives in ./node.ts and is dynamically imported at the call site.
 * (R2P-107, aligned with Rust colts attachments.rs.)
 */

import type { Message } from '@agentskillmania/llm-client';

/** Wire prefix of a session-relative attachment reference. */
export const FILE_REF_PREFIX = 'file:';

/** True when the string is a `file:` attachment reference. */
export function isFileRef(value: string): boolean {
  return value.startsWith(FILE_REF_PREFIX);
}

/**
 * Whether any message carries a `file:` reference part. Cheap guard used by
 * the calling-llm phase to decide whether to load the node materializer at
 * all — the no-attachment fast path stays fs-free.
 */
export function hasFileRefParts(messages: Message[]): boolean {
  for (const message of messages) {
    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === 'image' && part.ref !== undefined && isFileRef(part.ref)) {
        return true;
      }
    }
  }
  return false;
}
