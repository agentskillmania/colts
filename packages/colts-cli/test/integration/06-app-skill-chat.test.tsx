/**
 * @fileoverview App-level skill chat with real LLM
 *
 * End-to-end user story: a CLI user loads a skill via /skill and then
 * interacts with the real LLM using the skill's specialized instructions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentRunner, FilesystemSkillProvider } from '@agentskillmania/colts';
import { testConfig, itif } from './config.js';
import { createRealRunner, renderApp, submitMessage, waitForIdle } from './app-helpers.js';

describe('Integration: App skill chat with real LLM', () => {
  const skillDir = path.join(os.tmpdir(), `colts-cli-skill-${Date.now()}`);

  beforeAll(async () => {
    await fs.mkdir(skillDir, { recursive: true });
    await fs.mkdir(path.join(skillDir, 'poet'), { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'poet', 'SKILL.md'),
      [
        '---',
        'name: poet',
        'description: A classical Chinese poet that writes short poems',
        '---',
        '',
        '# Poet',
        '',
        'You are a classical Chinese poet.',
        'Whenever the user asks for a poem, you must respond with exactly three short lines.',
        'Do not add any explanation.',
      ].join('\n')
    );
  });

  afterAll(async () => {
    await fs.rm(skillDir, { recursive: true, force: true });
  });

  itif(testConfig.enabled)(
    '/skill poet loads the skill and the LLM follows its instruction',
    async () => {
      const provider = new FilesystemSkillProvider([skillDir]);
      const runner = createRealRunner({ skillProvider: provider });
      const { lastFrame, unmount } = renderApp({ runner });

      await submitMessage('/skill poet Write a poem about the moon');
      const frame = await waitForIdle(lastFrame, 90000);

      expect(frame).toContain('poet');
      expect(frame).toContain('You:');
      expect(frame).toContain('Write a poem about the moon');
      expect(frame).toContain('Agent:');
      expect(frame.toLowerCase()).toContain('moon');

      unmount();
    },
    120000
  );
});
