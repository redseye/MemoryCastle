import { describe, it, expect, afterEach } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileExists, readJsonFile, writeJsonFile } from '../src/storage/json-file.js';
import { toForwardSlash } from '../src/storage/paths.js';
import { makeTempDir, cleanupTempDir } from './helpers.js';

describe('storage/json-file', () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await cleanupTempDir(dir);
  });

  it('round-trips a record through write then read', async () => {
    dir = await makeTempDir();
    const file = join(dir, 'sub', 'data.json');
    const data = {
      schema: 1,
      entries: [{ id: 'abc', date: '2026-07-06', confidence: 'high', source: 'user', fact: '測試事實', tags: ['t1'] }],
    };
    await writeJsonFile(file, data);
    expect(await fileExists(file)).toBe(true);
    const read = await readJsonFile(file);
    expect(read).toEqual(data);
  });

  it('writes with 2-space indent and a trailing newline', async () => {
    dir = await makeTempDir();
    const file = join(dir, 'data.json');
    await writeJsonFile(file, { a: 1, b: [1, 2] });
    const raw = await readFile(file, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('\n  "a": 1');
  });

  it('does not leave a temp file behind after a successful write', async () => {
    dir = await makeTempDir();
    const file = join(dir, 'data.json');
    await writeJsonFile(file, { a: 1 });
    const files = await readdir(dir);
    expect(files).toEqual(['data.json']);
  });

  it('appending one record only changes the tail of the file (diff-friendly)', async () => {
    dir = await makeTempDir();
    const file = join(dir, 'data.json');
    await writeJsonFile(file, { schema: 1, entries: [{ id: 'a' }] });
    const before = (await readFile(file, 'utf8')).split('\n');
    await writeJsonFile(file, { schema: 1, entries: [{ id: 'a' }, { id: 'b' }] });
    const after = (await readFile(file, 'utf8')).split('\n');

    const firstDiff = before.findIndex((line, i) => line !== after[i]);
    expect(firstDiff).toBeGreaterThan(0);
    expect(before.slice(0, firstDiff)).toEqual(after.slice(0, firstDiff));
  });
});

describe('storage/paths', () => {
  it('normalizes backslashes to forward slashes', () => {
    expect(toForwardSlash('scripts\\foo\\bar.mjs')).toBe('scripts/foo/bar.mjs');
    expect(toForwardSlash('already/forward')).toBe('already/forward');
  });
});
