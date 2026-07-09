// Golden test (plan M2 checkpoint): imports a copy of MemoryCastle's own real
// castle (tests/fixtures/memorycastle-castle/) and asserts the exact counts
// spot-checked against the live castle: keep 6 records across 3 sections,
// chronicle 16, routes 3, rooms 0, 0 warnings, lastPatrolAt 2026-07-06.

import { describe, it, expect, afterEach } from 'vitest';
import { cp, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CastleExistsError } from '../src/core/errors.js';
import { importApply, importPreview } from '../src/importer/index.js';
import { makeTempDir, cleanupTempDir } from './helpers.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_ROOT = join(here, 'fixtures', 'memorycastle-castle');

async function listFilesRecursive(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFilesRecursive(full)));
    else out.push(full);
  }
  return out.sort();
}

async function copyFixture(container: string): Promise<string> {
  const projectRoot = join(container, 'project');
  await cp(FIXTURE_ROOT, projectRoot, { recursive: true });
  return projectRoot;
}

describe('importer golden test (real MemoryCastle castle)', () => {
  let container: string;
  afterEach(async () => {
    if (container) await cleanupTempDir(container);
  });

  it('importPreview reports keep 6/chronicle 16/routes 3/rooms 0/0 warnings/lastPatrolAt 2026-07-06', async () => {
    container = await makeTempDir();
    const projectRoot = await copyFixture(container);

    const result = await importPreview(projectRoot);
    expect(result.counts).toEqual({ keep: 6, chronicle: 16, routes: 3, rooms: 0, archiveMonths: 0 });
    expect(result.warnings).toEqual([]);
  });

  it('importPreview writes nothing to disk', async () => {
    container = await makeTempDir();
    const projectRoot = await copyFixture(container);

    const before = await listFilesRecursive(projectRoot);
    await importPreview(projectRoot);
    const after = await listFilesRecursive(projectRoot);

    expect(after).toEqual(before);
    expect(existsSync(join(projectRoot, '.claude', 'castle', 'castle.json'))).toBe(false);
  });

  it('importApply produces schema-valid JSON and archives the original markdown, including the en-original file', async () => {
    container = await makeTempDir();
    const projectRoot = await copyFixture(container);
    const castleDir = join(projectRoot, '.claude', 'castle');

    const summary = await importApply(projectRoot);
    expect(summary.counts).toEqual({ keep: 6, chronicle: 16, routes: 3, rooms: 0, archiveMonths: 0 });
    expect(summary.warnings).toEqual([]);

    const meta = JSON.parse(await readFile(join(castleDir, 'castle.json'), 'utf8'));
    expect(meta.schema).toBe(1);
    expect(meta.lastPatrolAt).toBe('2026-07-06');
    expect(meta.createdAt).toBe('2026-07-05'); // earliest chronicle record date
    expect(meta.budgets).toEqual({ keepMax: 30, roomMax: 120, chronicleSweep: 20, patrolDays: 30, stalenessDays: 90 });

    const keep = JSON.parse(await readFile(join(castleDir, 'keep.json'), 'utf8'));
    expect(keep.schema).toBe(1);
    expect(keep.sections.identity).toHaveLength(2);
    expect(keep.sections.constraints).toHaveLength(3);
    expect(keep.sections.core).toHaveLength(1);

    const chronicle = JSON.parse(await readFile(join(castleDir, 'chronicle.json'), 'utf8'));
    expect(chronicle.entries).toHaveLength(16);

    const routes = JSON.parse(await readFile(join(castleDir, 'routes.json'), 'utf8'));
    expect(routes.routes.map((r: { name: string }) => r.name)).toEqual(['session-start', 'before-release', 'patrol']);

    // Original markdown must be gone from its source location...
    expect(existsSync(join(castleDir, 'keep.md'))).toBe(false);
    expect(existsSync(join(castleDir, 'chronicle.md'))).toBe(false);
    expect(existsSync(join(castleDir, 'routes.md'))).toBe(false);
    expect(existsSync(join(castleDir, 'archive', 'chronicle-2026-07-en-original.md'))).toBe(false);

    // ...and present, untouched, under archive/markdown-original/.
    const archivedEnOriginal = join(castleDir, 'archive', 'markdown-original', 'chronicle-2026-07-en-original.md');
    expect(existsSync(archivedEnOriginal)).toBe(true);
    const originalContent = await readFile(join(FIXTURE_ROOT, '.claude', 'castle', 'archive', 'chronicle-2026-07-en-original.md'), 'utf8');
    expect(await readFile(archivedEnOriginal, 'utf8')).toBe(originalContent);
    expect(existsSync(join(castleDir, 'archive', 'markdown-original', 'keep.md'))).toBe(true);
    expect(existsSync(join(castleDir, 'archive', 'markdown-original', 'chronicle.md'))).toBe(true);
    expect(existsSync(join(castleDir, 'archive', 'markdown-original', 'routes.md'))).toBe(true);
  });

  it('importApply refuses when a JSON castle already exists, with no partial writes', async () => {
    container = await makeTempDir();
    const projectRoot = await copyFixture(container);

    await importApply(projectRoot);
    const castleDir = join(projectRoot, '.claude', 'castle');
    const before = await listFilesRecursive(castleDir);

    await expect(importApply(projectRoot)).rejects.toThrow(CastleExistsError);

    const after = await listFilesRecursive(castleDir);
    expect(after).toEqual(before);
  });
});
