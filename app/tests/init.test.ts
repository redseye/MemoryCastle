import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CastleExistsError, initCastle } from '../src/core/index.js';
import { makeTempDir, cleanupTempDir } from './helpers.js';

describe('initCastle', () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await cleanupTempDir(dir);
  });

  it('scaffolds castle.json/keep.json/chronicle.json/routes.json plus rooms/ and archive/', async () => {
    dir = await makeTempDir();
    const castleDir = await initCastle(dir, '測試專案');

    const meta = JSON.parse(await readFile(join(castleDir, 'castle.json'), 'utf8'));
    expect(meta.schema).toBe(1);
    expect(meta.projectName).toBe('測試專案');
    expect(meta.budgets).toEqual({
      keepMax: 30,
      roomMax: 120,
      chronicleSweep: 20,
      patrolDays: 30,
      stalenessDays: 90,
      factMaxChars: 200,
    });
    expect(meta.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meta.lastPatrolAt).toBe(meta.createdAt);

    const keep = JSON.parse(await readFile(join(castleDir, 'keep.json'), 'utf8'));
    expect(keep).toEqual({ schema: 1, sections: { identity: [], constraints: [], core: [] } });

    const chronicle = JSON.parse(await readFile(join(castleDir, 'chronicle.json'), 'utf8'));
    expect(chronicle).toEqual({ schema: 1, entries: [] });

    const routes = JSON.parse(await readFile(join(castleDir, 'routes.json'), 'utf8'));
    expect(routes.routes.map((r: { name: string }) => r.name)).toEqual([
      'session-start',
      'before-release',
      'patrol',
    ]);
    // Contract C5 default session-start order.
    expect(routes.routes[0].stops).toEqual([
      { target: 'patrol-check', read: 'due' },
      { target: 'keep', read: 'all' },
      { target: 'chronicle', read: 'last-handover' },
      { target: 'rooms-by-locus', read: 'all' },
    ]);

    expect(existsSync(join(castleDir, 'rooms'))).toBe(true);
    expect(existsSync(join(castleDir, 'archive'))).toBe(true);
  });

  it('defaults projectName to the directory basename when --name is omitted', async () => {
    dir = await makeTempDir();
    const castleDir = await initCastle(dir);
    const meta = JSON.parse(await readFile(join(castleDir, 'castle.json'), 'utf8'));
    expect(meta.projectName).toBe(dir.split(/[\\/]/).pop());
  });

  it('refuses to overwrite an existing castle', async () => {
    dir = await makeTempDir();
    await initCastle(dir);
    await expect(initCastle(dir)).rejects.toThrow(CastleExistsError);
  });

  it('rejects a missing target directory', async () => {
    await expect(initCastle('C:/definitely/not/a/real/path/xyz-does-not-exist')).rejects.toThrow();
  });
});
