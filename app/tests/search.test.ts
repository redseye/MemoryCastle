import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initCastle, makeChronicleCollection, makeKeepCollection, makeRoomsCollection, search } from '../src/core/index.js';
import { makeTempDir, cleanupTempDir } from './helpers.js';

describe('search', () => {
  let dir: string;
  let castleDir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    castleDir = await initCastle(dir);

    const keep = makeKeepCollection(castleDir);
    await keep.append('core', { confidence: 'high', source: 'user', fact: 'build 前必須先跑 codegen', tags: ['build'] });

    const chronicle = makeChronicleCollection(castleDir);
    await chronicle.append({ confidence: 'med', source: 'user', fact: '使用者要求改用 codegen v2', tags: ['build', 'v2'] });

    const rooms = makeRoomsCollection(castleDir);
    const room = await rooms.append({ name: 'Deploy Room' });
    await rooms.appendRecord(room.slug, { confidence: 'high', source: 'user', fact: '部署順序：先 build 再 deploy', tags: ['deploy'] });
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('finds substring matches across keep, chronicle, and rooms', async () => {
    const results = await search(castleDir, 'codegen');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.location).sort()).toEqual(['chronicle', 'keep:core']);
  });

  it('is case-insensitive for substring search', async () => {
    const results = await search(castleDir, 'BUILD');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('supports regex search', async () => {
    const results = await search(castleDir, 'codegen\\s*v2', { regex: true });
    expect(results).toHaveLength(1);
    expect(results[0].location).toBe('chronicle');
  });

  it('filters by tag', async () => {
    const results = await search(castleDir, '', { tags: ['deploy'] });
    expect(results).toHaveLength(1);
    expect(results[0].location).toMatch(/^room:/);
  });

  it('combines a query with a tag filter (both must match)', async () => {
    const results = await search(castleDir, 'codegen', { tags: ['v2'] });
    expect(results).toHaveLength(1);
    expect(results[0].location).toBe('chronicle');
  });

  it('returns no results for an unmatched query', async () => {
    expect(await search(castleDir, '完全不存在的詞')).toEqual([]);
  });

  it('never returns everything: no query and no tag yields nothing', async () => {
    expect(await search(castleDir, '')).toEqual([]);
    expect(await search(castleDir, '', { tags: [] })).toEqual([]);
  });

  it('caps results at 20 by default, honors a smaller limit, and never exceeds 100', async () => {
    const chronicle = makeChronicleCollection(castleDir);
    for (let i = 0; i < 105; i++) await chronicle.append({ confidence: 'med', source: 'session', fact: `批次 ${i}` });
    expect(await search(castleDir, '批次')).toHaveLength(20);
    expect(await search(castleDir, '批次', { limit: 5 })).toHaveLength(5);
    expect(await search(castleDir, '批次', { limit: 1000 })).toHaveLength(100);
  }, 30000);
});
