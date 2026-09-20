/**
 * @fileoverview `file:` attachment references (R2P-107, aligned with Rust
 * colts attachments.rs).
 *
 * Coverage mirrors the Rust suite plus the TS-specific guarantees:
 * - materializeFileRefs: ref → inline base64 on the wire copy only
 *   (input purity), traversal/absolute/missing-file rejections naming the
 *   ref, inline parts and plain text untouched, unknown ext → png
 * - hasFileRefParts guard
 * - estimateContentTokens: text/thinking estimated, image flat 1000,
 *   toolCall by name+args
 * - addUserMessage: parts accepted, maxLength measured on the plain-text
 *   form, tokenCount includes the per-image constant
 * - runner end-to-end: llm:request event carries the placeholder (never
 *   base64), the wire stream call sees materialized base64, and the state
 *   keeps the ref forever
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, it, expect, afterEach, vi } from 'vitest';

import type { Message, ImageContent, TextContent } from '@agentskillmania/llm-client';

import { hasFileRefParts } from '../../src/attachments/core.js';
import { materializeFileRefs } from '../../src/attachments/node.js';
import { estimateContentTokens, IMAGE_PART_TOKEN_ESTIMATE } from '../../src/compressor/index.js';
import { addUserMessage } from '../../src/state/index.js';
import { createAgentState } from '../../src/state/index.js';
import { AgentRunner } from '../../src/runner/index.js';
import { createCallOnlyMockLLMClient } from '../helpers/mock-llm.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'colts-attachments-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function userPartsMessage(parts: (TextContent | ImageContent)[]): Message {
  return { role: 'user', content: parts, timestamp: 0 };
}

function imagePart(part: Partial<ImageContent> & { type: 'image' }): ImageContent {
  return part;
}

describe('materializeFileRefs', () => {
  it('materializes a file: png ref into inline base64 on a new copy', async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, 'img-1.png'), Buffer.from('ABC'));
    const input = [
      userPartsMessage([
        { type: 'text', text: '看这张图' },
        imagePart({ type: 'image', ref: 'file:img-1.png' }),
      ]),
    ];

    const out = await materializeFileRefs(input, dir);

    const parts = out[0].content as (TextContent | ImageContent)[];
    expect(parts[0]).toEqual({ type: 'text', text: '看这张图' });
    expect(parts[1]).toEqual({
      type: 'image',
      data: Buffer.from('ABC').toString('base64'),
      mimeType: 'image/png',
    });
    // Input purity: the original keeps the ref form.
    expect((input[0].content as ImageContent[])[1].ref).toBe('file:img-1.png');
    expect(out).not.toBe(input);
  });

  it('resolves refs in nested subdirectories with the right mime', async () => {
    const dir = await makeTempDir();
    await mkdir(path.join(dir, 'media'), { recursive: true });
    await writeFile(path.join(dir, 'media', 'img-2.jpg'), Buffer.from('J'));
    const out = await materializeFileRefs(
      [userPartsMessage([imagePart({ type: 'image', ref: 'file:media/img-2.jpg' })])],
      dir
    );
    expect(((out[0].content as ImageContent[])[0] as ImageContent).mimeType).toBe('image/jpeg');
  });

  it('defaults unknown extensions to image/png', async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, 'pic.tiff'), Buffer.from('T'));
    const out = await materializeFileRefs(
      [userPartsMessage([imagePart({ type: 'image', ref: 'file:pic.tiff' })])],
      dir
    );
    expect(((out[0].content as ImageContent[])[0] as ImageContent).mimeType).toBe('image/png');
  });

  it('rejects .. traversal, naming the ref', async () => {
    const dir = await makeTempDir();
    await expect(
      materializeFileRefs(
        [userPartsMessage([imagePart({ type: 'image', ref: 'file:../secret.png' })])],
        dir
      )
    ).rejects.toThrow(/secret\.png/);
  });

  it('rejects absolute paths, naming the ref', async () => {
    const dir = await makeTempDir();
    await expect(
      materializeFileRefs(
        [userPartsMessage([imagePart({ type: 'image', ref: 'file:/etc/passwd' })])],
        dir
      )
    ).rejects.toThrow(/etc\/passwd/);
  });

  it('rejects an empty ref path', async () => {
    const dir = await makeTempDir();
    await expect(
      materializeFileRefs([userPartsMessage([imagePart({ type: 'image', ref: 'file:' })])], dir)
    ).rejects.toThrow(/empty path/);
  });

  it('rejects missing files, naming the ref', async () => {
    const dir = await makeTempDir();
    await expect(
      materializeFileRefs(
        [userPartsMessage([imagePart({ type: 'image', ref: 'file:img-gone.png' })])],
        dir
      )
    ).rejects.toThrow(/img-gone\.png/);
  });

  it('errors when no attachment dir is configured', async () => {
    await expect(
      materializeFileRefs(
        [userPartsMessage([imagePart({ type: 'image', ref: 'file:img-1.png' })])],
        undefined
      )
    ).rejects.toThrow(/no attachment dir/);
  });

  it('leaves inline image parts and plain text untouched', async () => {
    const dir = await makeTempDir();
    const inline: ImageContent = { type: 'image', data: 'QUJD', mimeType: 'image/png' };
    const input: Message[] = [
      userPartsMessage([{ type: 'text', text: '纯文本附件' }, inline]),
      { role: 'user', content: '纯文本消息', timestamp: 0 },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }], timestamp: 0 },
    ];
    const out = await materializeFileRefs(input, dir);
    expect(out[0].content).toEqual(input[0].content);
    expect(out[1].content).toBe('纯文本消息');
    expect(out[2]).toBe(input[2]);
  });
});

describe('hasFileRefParts', () => {
  it('detects refs and ignores inline/plain forms', () => {
    expect(
      hasFileRefParts([userPartsMessage([imagePart({ type: 'image', ref: 'file:a.png' })])])
    ).toBe(true);
    expect(
      hasFileRefParts([
        userPartsMessage([imagePart({ type: 'image', data: 'QQ==', mimeType: 'image/png' })]),
      ])
    ).toBe(false);
    expect(hasFileRefParts([{ role: 'user', content: 'text only', timestamp: 0 }])).toBe(false);
  });
});

describe('estimateContentTokens', () => {
  it('estimates strings directly', () => {
    expect(estimateContentTokens('hello')).toBeGreaterThan(0);
  });

  it('estimates text/thinking parts by text, images flat, toolCall by name+args', () => {
    const textOnly = estimateContentTokens([{ type: 'text', text: 'hello world' }]);
    const withImage = estimateContentTokens([
      { type: 'text', text: 'hello world' },
      { type: 'image', data: 'QQ==', mimeType: 'image/png' },
    ]);
    expect(withImage - textOnly).toBe(IMAGE_PART_TOKEN_ESTIMATE);

    const thinking = estimateContentTokens([{ type: 'thinking', thinking: 'hmm' }]);
    expect(thinking).toBeGreaterThan(0);

    const toolCall = estimateContentTokens([
      { type: 'toolCall', id: '1', name: 'read_file', arguments: { path: '/x' } },
    ]);
    expect(toolCall).toBeGreaterThan(0);
  });
});

describe('addUserMessage multimodal', () => {
  it('accepts parts, measures maxLength on plain text, counts images flat', () => {
    const state = createAgentState({ name: 't', instructions: '', tools: [] });
    const next = addUserMessage(state, [
      { type: 'text', text: 'hi' },
      imagePart({ type: 'image', ref: 'file:img.png' }),
    ]);
    const msg = next.context.messages[0];
    expect(Array.isArray(msg.content)).toBe(true);
    // tokenCount = estimate('hi') + 1000, never base64-derived
    const textTokens = estimateContentTokens('hi');
    expect(msg.tokenCount).toBe(textTokens + IMAGE_PART_TOKEN_ESTIMATE);
    // state keeps the ref — materialization never happens here
    expect((msg.content as ImageContent[])[1].ref).toBe('file:img.png');
  });

  it('enforces maxLength on the plain-text form (image → [image])', () => {
    const state = createAgentState({ name: 't', instructions: '', tools: [] });
    // '[image]' is 7 chars; the text part is what pushes over the limit.
    expect(() => addUserMessage(state, [{ type: 'text', text: 'a'.repeat(11) }], 10)).toThrow(
      /maximum length of 10/
    );
    // Image alone degrades to '[image]' (7 chars) — fits.
    const ok = addUserMessage(state, [imagePart({ type: 'image', ref: 'file:img.png' })], 10);
    expect(ok.context.messages).toHaveLength(1);
  });
});

describe('runner end-to-end wire materialization', () => {
  it('llm:request degrades parts to [image]; wire carries base64; state keeps the ref', async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, 'img-1.png'), Buffer.from('ABC'));

    const llmClient = createCallOnlyMockLLMClient([{ content: '看到了', toolCalls: [] }]);
    const runner = new AgentRunner({
      model: 'test-model',
      llmClient,
      attachmentDir: dir,
      maxSteps: 1,
    });

    const llmRequestEvents: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    runner.on('llm:request', (e) => llmRequestEvents.push(e));

    let state = createAgentState({ name: 't', instructions: '', tools: [] });
    state = addUserMessage(state, [
      { type: 'text', text: '看这张图' },
      imagePart({ type: 'image', ref: 'file:img-1.png' }),
    ]);

    const { state: finalState } = await runner.run(state);

    // Event payload: placeholder form, never base64.
    expect(llmRequestEvents).toHaveLength(1);
    const contents = llmRequestEvents[0].messages.map((m) => m.content);
    expect(contents).toContain('看这张图\n[image]');
    for (const c of contents) expect(c).not.toContain('base64');

    // Wire call: the materialized copy (pi-ai data URL body parts).
    const streamArg = (llmClient.stream as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const wireUser = streamArg.messages.find((m: Message) => m.role === 'user');
    const wireImage = (wireUser.content as ImageContent[]).find(
      (p) => p.type === 'image'
    ) as ImageContent;
    expect(wireImage.data).toBe(Buffer.from('ABC').toString('base64'));
    expect(wireImage.mimeType).toBe('image/png');
    expect(wireImage.ref).toBeUndefined();

    // State after the run: still the ref — the archive never inlines base64.
    expect(finalState.context.messages[0].content).toEqual([
      { type: 'text', text: '看这张图' },
      { type: 'image', ref: 'file:img-1.png' },
    ]);
  });

  it('routes materialization failure to the error phase, naming the ref', async () => {
    const llmClient = createCallOnlyMockLLMClient([{ content: 'x', toolCalls: [] }]);
    // attachmentDir left unset → ref cannot resolve.
    const runner = new AgentRunner({ model: 'test-model', llmClient, maxSteps: 1 });
    const errorEvents: Array<{ error: Error }> = [];
    runner.on('error', (e) => errorEvents.push(e));

    let state = createAgentState({ name: 't', instructions: '', tools: [] });
    state = addUserMessage(state, [imagePart({ type: 'image', ref: 'file:img-1.png' })]);

    await runner.run(state);

    expect(errorEvents.length).toBeGreaterThan(0);
    expect(errorEvents[0].error.message).toContain('img-1.png');
    expect((llmClient.stream as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

describe('AgentRunner.setAttachmentDir late binding', () => {
  it('binds after construction and reaches the calling-llm phase', async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, 'late.png'), Buffer.from('L'));

    const llmClient = createCallOnlyMockLLMClient([{ content: 'ok', toolCalls: [] }]);
    const runner = new AgentRunner({ model: 'test-model', llmClient, maxSteps: 1 });
    // Bound AFTER construction — daemon standard sessions know the session
    // dir only once the session id exists (post-runner).
    runner.setAttachmentDir(dir);

    const requestEvents: Array<{ messages: Array<{ content: string }> }> = [];
    runner.on('llm:request', (e) => requestEvents.push(e));

    let state = createAgentState({ name: 't', instructions: '', tools: [] });
    state = addUserMessage(state, [imagePart({ type: 'image', ref: 'file:late.png' })]);
    await runner.run(state);

    expect(requestEvents[0].messages.map((m) => m.content)).toContain('[image]');
    const streamArg = (llmClient.stream as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const wireImage = (streamArg.messages[0].content as ImageContent[]).find(
      (p) => p.type === 'image'
    ) as ImageContent;
    expect(wireImage.data).toBe(Buffer.from('L').toString('base64'));
  });

  it('clearing with undefined makes refs fail with a named error', async () => {
    const llmClient = createCallOnlyMockLLMClient([{ content: 'ok', toolCalls: [] }]);
    const runner = new AgentRunner({ model: 'm', llmClient, maxSteps: 1 });
    runner.setAttachmentDir(undefined);
    const errors: Array<{ error: Error }> = [];
    runner.on('error', (e) => errors.push(e));
    let state = createAgentState({ name: 't', instructions: '', tools: [] });
    state = addUserMessage(state, [imagePart({ type: 'image', ref: 'file:x.png' })]);
    await runner.run(state);
    expect(errors[0].error.message).toContain('x.png');
  });
});
