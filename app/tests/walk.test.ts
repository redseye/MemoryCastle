import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initCastle,
  makeKeepCollection,
  makeRoomsCollection,
  makeRoutesCollection,
  planWalk,
  walkReport,
} from '../src/core/index.js';
import { makeTempDir, cleanupTempDir } from './helpers.js';

describe('planWalk / walkReport', () => {
  let dir: string;
  let castleDir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    castleDir = await initCastle(dir);
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('session-start with no rooms yet: 0/0, valid', async () => {
    const plan = await planWalk(castleDir, 'session-start');
    const report = walkReport(plan);
    expect(report.total).toBe(0);
    expect(report.visited).toBe(0);
    expect(report.valid).toBe(true);
    expect(report.text).toBe('巡行 0/0 房，發現 0 項注意');
  });

  it('patrol route visits every room via all-rooms expansion: N/N complete', async () => {
    const rooms = makeRoomsCollection(castleDir);
    await rooms.append({ name: 'Room A' });
    await rooms.append({ name: 'Room B' });

    const plan = await planWalk(castleDir, 'patrol');
    const report = walkReport(plan);
    expect(report.total).toBe(2);
    expect(report.visited).toBe(2);
    expect(report.valid).toBe(true);
    expect(report.text).toBe('巡行 2/2 房，發現 0 項注意');
  });

  it('a stop targeting a room that does not exist is skipped and invalidates the walk', async () => {
    const rooms = makeRoomsCollection(castleDir);
    const existing = await rooms.append({ name: 'Existing Room' });
    const routes = makeRoutesCollection(castleDir);
    await routes.append({
      name: 'custom',
      occasion: 'test',
      stops: [
        { target: `room:${existing.slug}`, read: 'all' },
        { target: 'room:ghost-room', read: 'all' },
      ],
    });

    const plan = await planWalk(castleDir, 'custom');
    const report = walkReport(plan);
    expect(report.total).toBe(2);
    expect(report.visited).toBe(1);
    expect(report.valid).toBe(false);
    expect(report.text).toBe('巡行 1/2 房，發現 0 項注意');
  });

  it('rooms-by-locus expands to rooms matching the given paths (Windows backslash input)', async () => {
    const rooms = makeRoomsCollection(castleDir);
    await rooms.append({ name: 'Scripts Room', locus: ['scripts/**'] });
    await rooms.append({ name: 'Other Room', locus: ['other/**'] });

    const plan = await planWalk(castleDir, 'session-start', { paths: ['scripts\\build.mjs'] });
    const report = walkReport(plan);
    expect(report.total).toBe(1);
    expect(report.visited).toBe(1);
  });

  it("counts route-warnings lines as the report's warning count", async () => {
    const keep = makeKeepCollection(castleDir);
    await keep.append('constraints', {
      confidence: 'high',
      source: 'user',
      fact: '出貨前必須先跑測試',
      routeWarning: 'ship-check',
    });
    await keep.append('constraints', {
      confidence: 'high',
      source: 'user',
      fact: '這條不是 ship-check 的注意事項',
    });

    const routes = makeRoutesCollection(castleDir);
    await routes.append({ name: 'ship-check', occasion: 'test', stops: [{ target: 'keep', read: 'route-warnings' }] });

    const plan = await planWalk(castleDir, 'ship-check');
    const report = walkReport(plan);
    expect(report.warnings).toBe(1);
    expect(report.text).toBe('巡行 0/0 房，發現 1 項注意');
  });

  it('throws for an unknown route name', async () => {
    await expect(planWalk(castleDir, 'no-such-route')).rejects.toThrow();
  });
});
