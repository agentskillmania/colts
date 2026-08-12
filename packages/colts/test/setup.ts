/**
 * Vitest global setup — register the Node SkillFsOps default before any test.
 *
 * FilesystemSkillProvider now resolves its default backend via the global
 * registration point (setDefaultSkillFsOps), so every test that constructs
 * one without an explicit fsOps needs nodeFsOps registered. This setup runs
 * once per test worker before all unit and integration tests.
 */

import { setDefaultSkillFsOps } from '../src/skills/fs-ops.js';
import { nodeFsOps } from '../src/skills/node-fs-ops.js';

setDefaultSkillFsOps(nodeFsOps);
