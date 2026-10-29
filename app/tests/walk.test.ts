import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import {
  HYPOTHESIS_MARK,
  initCastle,
  makeChronicleCollection,
  makeKeepCollection,
  makeRoomsCollection,
  makeRoutesCollection,
  planWalk,
  walkReport,
} from '../src/core/index.js';
import { castleJsonPath } from '../src/core/layout.js';
import { readJsonFile, writeJsonFile } from '../src/storage/json-file.js';
import type { CastleMeta } from '../src/core/types.js';
import { makeTempDir, cleanupTempDir } from './helpers.js';

async function setLastPatrolAt(castleDir: string, date: string) {
  const path = castleJsonPath(castleDir);
  const meta = await readJsonFile<CastleMeta>(path);
  await writeJsonFile(path, { ...meta, lastPatrolAt: date } satisfies CastleMeta);
}

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

  it('session-start with no paths: rooms-by-locus is deferred — not passed, not skipped, walk stays valid', async () => {
    const rooms = makeRoomsCollection(castleDir);
    await rooms.append({ name: 'Scripts Room', locus: ['scripts/**'] });
    const plan = await planWalk(castleDir, 'session-start');
    const report = walkReport(plan);
    expect(report.total).toBe(0);
    expect(report.visited).toBe(0);
    expect(report.deferred).toBe(1);
    expect(report.valid).toBe(true);
    expect(report.text).toBe('巡行 0/0 房，發現 0 項注意；延後 1 站');
    const deferredStop = plan.stops.find((s) => s.target === 'rooms-by-locus');
    expect(deferredStop).toMatchObject({ deferred: true, skipped: false, lines: [] });
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

describe('planWalk v0.5 whitelist, deferral, unmatched paths, hypothesis marks (contract C3/C5)', () => {
  let dir: string;
  let castleDir: string;
  const today = new Date('2026-10-28T00:00:00Z');

  beforeEach(async () => {
    dir = await makeTempDir();
    castleDir = await initCastle(dir);
    await setLastPatrolAt(castleDir, '2026-10-28');
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  async function customRoute(stops: { target: string; read: string }[]) {
    await makeRoutesCollection(castleDir).append({ name: 'custom', occasion: 'test', stops });
    return walkReport(await planWalk(castleDir, 'custom', { now: today }));
  }

  it.each([
    ['keep', 'everything'],
    ['keep', 'section:secrets'],
    ['chronicle', 'section:core'],
    ['keep', 'last-handover'],
    ['keep', 'due'],
    ['patrol-check', 'last-handover'],
  ])('read %s/%s is outside the whitelist: stop skipped, walk invalid', async (target, read) => {
    const report = await customRoute([{ target, read }]);
    expect(report.valid).toBe(false);
  });

  it('an unknown stop target is skipped (walk invalid) instead of throwing', async () => {
    const plan = await (async () => {
      await makeRoutesCollection(castleDir).append({ name: 'custom', occasion: 'test', stops: [{ target: 'basement', read: 'all' }] });
      return planWalk(castleDir, 'custom', { now: today });
    })();
    expect(plan.stops).toEqual([{ target: 'basement', read: 'all', lines: [], skipped: true }]);
    expect(walkReport(plan).valid).toBe(false);
  });

  it.each([
    ['keep', 'section:identity'],
    ['chronicle', 'last-handover'],
    ['patrol-check', 'due'],
    ['routes', 'all'],
    ['all-rooms', 'route-warnings'],
  ])('read %s/%s is whitelisted: walk valid', async (target, read) => {
    expect((await customRoute([{ target, read }])).valid).toBe(true);
  });

  it('chronicle/last-handover returns only the newest #handover entry', async () => {
    const chronicle = makeChronicleCollection(castleDir);
    await chronicle.append({ date: '2026-10-01', confidence: 'high', source: 'session', fact: '舊交接', tags: ['handover'] });
    await chronicle.append({ date: '2026-10-27', confidence: 'high', source: 'session', fact: '新交接', tags: ['handover'] });
    await chronicle.append({ date: '2026-10-28', confidence: 'high', source: 'session', fact: '不是交接', tags: ['lesson'] });
    await makeRoutesCollection(castleDir).append({ name: 'custom', occasion: 'test', stops: [{ target: 'chronicle', read: 'last-handover' }] });
    const plan = await planWalk(castleDir, 'custom', { now: today });
    expect(plan.stops[0].lines).toEqual(['新交接']);
  });

  it('patrol-check/due emits one line per fired trigger, counted as attention items', async () => {
    await setLastPatrolAt(castleDir, '2026-01-01');
    const chronicle = makeChronicleCollection(castleDir);
    for (let i = 0; i < 20; i++) await chronicle.append({ date: '2026-10-01', confidence: 'high', source: 'user', fact: `c${i}` });
    const plan = await planWalk(castleDir, 'session-start', { now: today });
    const patrolStop = plan.stops.find((s) => s.target === 'patrol-check');
    expect(patrolStop?.lines).toEqual(['巡查到期：chronicle 未整理 20 筆 ≥ 20', '巡查到期：距上次巡查 300 天 > 30']);
    expect(walkReport(plan).text).toBe('巡行 0/0 房，發現 2 項注意；延後 1 站');
  });

  it('patrol-check/due stays silent for chronicle entries that survived the last patrol (v0.5.1)', async () => {
    const chronicle = makeChronicleCollection(castleDir);
    for (let i = 0; i < 25; i++) await chronicle.append({ date: '2026-10-28', confidence: 'high', source: 'user', fact: `s${i}` });
    const plan = await planWalk(castleDir, 'session-start', { now: today });
    expect(plan.stops.find((s) => s.target === 'patrol-check')?.lines).toEqual([]);
  });

  it('patrol-check/due emits nothing when no trigger fired', async () => {
    const plan = await planWalk(castleDir, 'session-start', { now: today });
    expect(plan.stops.find((s) => s.target === 'patrol-check')?.lines).toEqual([]);
  });

  it('session-start visits stops in the C5 default order', async () => {
    const plan = await planWalk(castleDir, 'session-start', { now: today, paths: ['x.ts'] });
    expect(plan.stops.map((s) => `${s.target}/${s.read}`)).toEqual(['patrol-check/due', 'keep/all', 'chronicle/last-handover']);
  });

  it('given paths no room owns are listed explicitly in the report', async () => {
    const rooms = makeRoomsCollection(castleDir);
    await rooms.append({ name: 'App Room', locus: ['app/**'] });
    const plan = await planWalk(castleDir, 'session-start', { now: today, paths: ['app/src/a.ts', 'docs/x.md', './README.md'] });
    const report = walkReport(plan);
    expect(report.unmatchedPaths).toEqual(['docs/x.md', 'README.md']);
    expect(report.text).toBe('巡行 1/1 房，發現 0 項注意；無對應房間：docs/x.md、README.md');
    expect(report.deferred).toBe(0);
  });

  it('an absolute, case-variant path inside the project root loads the owning room', async () => {
    const rooms = makeRoomsCollection(castleDir);
    await rooms.append({ name: 'App Room', locus: ['app/**'] });
    const abs = join(dir, 'APP', 'src', 'core', 'locus.ts');
    const report = walkReport(await planWalk(castleDir, 'session-start', { now: today, paths: [abs] }));
    expect(report.text).toBe('巡行 1/1 房，發現 0 項注意');
  });

  it('an absolute path outside the project root never matches and is reported unmatched', async () => {
    const rooms = makeRoomsCollection(castleDir);
    await rooms.append({ name: 'App Room', locus: ['app/**'] });
    const outside = join(dir, '..', 'other-project', 'app', 'x.ts');
    const report = walkReport(await planWalk(castleDir, 'session-start', { now: today, paths: [outside] }));
    expect(report.total).toBe(0);
    expect(report.unmatchedPaths).toHaveLength(1);
  });

  it('marks hypothesis lines (C3) with the token-cheap prefix; user directives and fresh facts stay bare', async () => {
    const keep = makeKeepCollection(castleDir);
    await keep.append('core', { date: '2026-01-01', confidence: 'high', source: 'session', fact: '舊觀察' });
    await keep.append('core', { date: '2026-01-01', confidence: 'high', source: 'session', fact: '已複驗', verifiedAt: '2026-10-01' });
    await keep.append('core', { date: '2026-01-01', confidence: 'high', source: 'user', fact: '使用者指示' });
    await keep.append('core', { date: '2026-10-28', confidence: 'low', source: 'user', fact: '推測' });
    await keep.append('core', { date: '2026-10-28', confidence: 'med', source: 'session', fact: '新事實' });
    const plan = await planWalk(castleDir, 'session-start', { now: today });
    expect(plan.stops.find((s) => s.target === 'keep')?.lines).toEqual([
      `${HYPOTHESIS_MARK}舊觀察`,
      '已複驗',
      '使用者指示',
      `${HYPOTHESIS_MARK}推測`,
      '新事實',
    ]);
    expect(HYPOTHESIS_MARK).toBe('（待驗證）');
  });
});
