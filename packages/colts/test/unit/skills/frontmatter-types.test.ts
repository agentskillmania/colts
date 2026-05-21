/**
 * @fileoverview Frontmatter type parsing branch coverage tests
 *
 * Covers parseFrontmatter branches for:
 * - null/undefined values (L72)
 * - array values (L77)
 * - object values (L80)
 */

import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../../../src/skills/filesystem-provider.js';

describe('parseFrontmatter type conversions', () => {
  it('should convert null value to empty string', () => {
    const content = '---\nname: null-skill\ndescription: Test\ntags: null\n---\n# Body';
    const result = parseFrontmatter(content);

    expect(result.frontmatter['tags']).toBe('');
    expect(result.body).toBe('# Body');
  });

  it('should convert array value to comma-separated string', () => {
    const content = '---\nname: array-skill\ndescription: Test\ntags: [a, b, c]\n---\n# Body';
    const result = parseFrontmatter(content);

    expect(result.frontmatter['tags']).toBe('a, b, c');
    expect(result.body).toBe('# Body');
  });

  it('should convert object value to JSON string', () => {
    const content =
      '---\nname: object-skill\ndescription: Test\nmeta: {version: "1.0", author: "test"}\n---\n# Body';
    const result = parseFrontmatter(content);

    expect(result.frontmatter['meta']).toBe('{"version":"1.0","author":"test"}');
    expect(result.body).toBe('# Body');
  });
});
