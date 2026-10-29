import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  countBudgets,
  initCastle,
  makeChronicleCollection,
  makeKeepCollection,
  makeRoomsCollection,
  markPatrolled,
  patrolDue,
  patrolTriggerLine,
  readCastleMeta,
} from '../src/core/index.js';
import { readJsonFile, writeJsonFile } from '../src/storage/json-file.js';
import { castleJsonPath } from '../src/core/layout.js';
import { makeTempDir, cleanupTempDir } from './helpers.js';
import type { CastleMeta } from '../src/core/types.js';

async function setLastPatrolAt(castleDir: string, date: string) {
  const path = castleJsonPath(castleDir);
  const meta = await readJsonFile<CastleMeta>(path);
  await writeJsonFile(path, { ...meta, lastPatrolAt: date } satisfies CastleMeta);
}

describe('countBudgets / patrolDue', () => {
  let dir: string;
  let castleDir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    castleDir = await initCastle(dir);
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('counts keep/chronicle/room sizes', async () => {
    const keep = makeKeepCollection(castleDir);
    await keep.append('core', { confidence: 'high', source: 'user', fact: 'k1' });
    const chronicle = makeChronicleCollection(castleDir);
    await chronicle.append({ confidence: 'high', source: 'user', fact: 'c1' });
    const rooms = makeRoomsCollection(castleDir);
    const room = await rooms.append({ name: 'Room One' });
    await rooms.appendRecord(room.slug, { confidence: 'high', source: 'user', fact: 'r1' });

    const counts = await countBudgets(castleDir);
    expect(counts.keepCount).toBe(1);
    expect(counts.chronicleCount).toBe(1);
    expect(counts.rooms).toEqual([{ slug: room.slug, count: 1 }]);
    expect(counts.maxRoomCount).toBe(1);
  });

  it('is not due right after init with nothing over budget', async () => {
    const result = await patrolDue(castleDir, new Date());
    expect(result.due).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('triggers when chronicle has >=20 unswept entries', async () => {
    await setLastPatrolAt(castleDir, '2026-07-01');
    const chronicle = makeChronicleCollection(castleDir);
    for (let i = 0; i < 20; i++) {
      await chronicle.append({ date: '2026-07-02', confidence: 'high', source: 'user', fact: `c${i}` });
    }
    const result = await patrolDue(castleDir, new Date('2026-07-06T00:00:00Z'));
    expect(result.due).toBe(true);
    expect(result.reasons).toEqual(['chronicle>=20']);
  });

  it('chronicle trigger counts only entries dated strictly after lastPatrolAt (contract v0.5.1)', async () => {
    await setLastPatrolAt(castleDir, '2026-07-01');
    const chronicle = makeChronicleCollection(castleDir);
    // 19 survivors of the last patrol (on or before its date) + 19 new ones.
    for (let i = 0; i < 19; i++) await chronicle.append({ date: i < 10 ? '2026-06-20' : '2026-07-01', confidence: 'high', source: 'user', fact: `old${i}` });
    for (let i = 0; i < 19; i++) await chronicle.append({ date: '2026-07-02', confidence: 'high', source: 'user', fact: `new${i}` });
    const now = new Date('2026-07-06T00:00:00Z');
    expect((await patrolDue(castleDir, now)).due).toBe(false);

    await chronicle.append({ date: '2026-07-05', confidence: 'high', source: 'user', fact: 'new19' });
    const due = await patrolDue(castleDir, now);
    expect(due.reasons).toEqual(['chronicle>=20']);
    expect(due.triggers[0].count).toBe(20);
  }, 30000);

  it('20 chronicle entries with only some dated after lastPatrolAt do not fire trigger 1', async () => {
    await setLastPatrolAt(castleDir, '2026-07-01');
    const chronicle = makeChronicleCollection(castleDir);
    for (let i = 0; i < 20; i++) {
      await chronicle.append({ date: i < 12 ? '2026-06-15' : '2026-07-03', confidence: 'high', source: 'user', fact: `c${i}` });
    }
    const due = await patrolDue(castleDir, new Date('2026-07-06T00:00:00Z'));
    expect((await countBudgets(castleDir)).chronicleCount).toBe(20);
    expect(due.due).toBe(false);
    expect(due.reasons).toEqual([]);
  });

  it('chronicle trigger counts every entry when there was never a patrol (lastPatrolAt null)', async () => {
    const path = castleJsonPath(castleDir);
    const meta = await readJsonFile<CastleMeta>(path);
    await writeJsonFile(path, { ...meta, lastPatrolAt: null } satisfies CastleMeta);
    const chronicle = makeChronicleCollection(castleDir);
    for (let i = 0; i < 20; i++) await chronicle.append({ date: '2020-01-01', confidence: 'high', source: 'user', fact: `c${i}` });
    const due = await patrolDue(castleDir, new Date('2026-07-06T00:00:00Z'));
    expect(due.reasons).toEqual(['chronicle>=20', 'neverPatrolled']);
  });

  it('a null lastPatrolAt fires the date trigger on its own (§4 trigger 4: never patrolled)', async () => {
    const path = castleJsonPath(castleDir);
    const meta = await readJsonFile<CastleMeta>(path);
    await writeJsonFile(path, { ...meta, createdAt: '2026-07-01', lastPatrolAt: null } satisfies CastleMeta);
    const due = await patrolDue(castleDir, new Date('2026-07-06T00:00:00Z'));
    expect(due.due).toBe(true);
    expect(due.reasons).toEqual(['neverPatrolled']);
    expect(due.triggers).toEqual([{ kind: 'days', target: 'patrol', count: 5, limit: 30, reason: 'neverPatrolled' }]);
    expect(patrolTriggerLine(due.triggers[0])).toBe('巡查到期：從未巡查（城堡建立 5 天）');
  });

  it('triggers when a room exceeds 120 records', async () => {
    const rooms = makeRoomsCollection(castleDir);
    const room = await rooms.append({ name: 'Big Room' });
    for (let i = 0; i < 121; i++) {
      await rooms.appendRecord(room.slug, { confidence: 'high', source: 'user', fact: `r${i}` });
    }
    const result = await patrolDue(castleDir, new Date());
    expect(result.due).toBe(true);
    expect(result.reasons).toContain(`room:${room.slug}>120`);
  }, 30000); // 121 sequential atomic writes

  it('triggers when keep exceeds 30 records', async () => {
    const keep = makeKeepCollection(castleDir);
    for (let i = 0; i < 31; i++) {
      await keep.append('core', { confidence: 'high', source: 'user', fact: `k${i}` });
    }
    const result = await patrolDue(castleDir, new Date());
    expect(result.due).toBe(true);
    expect(result.reasons).toContain('keep>30');
  });

  it('lists every fired trigger and every over-budget room, not just the first', async () => {
    const path = castleJsonPath(castleDir);
    const meta = await readJsonFile<CastleMeta>(path);
    await writeJsonFile(path, { ...meta, lastPatrolAt: '2026-01-01', budgets: { ...meta.budgets, roomMax: 1, keepMax: 1, chronicleSweep: 1 } });
    const rooms = makeRoomsCollection(castleDir);
    for (const name of ['Room A', 'Room B', 'Room C']) {
      const room = await rooms.append({ name });
      await rooms.appendRecord(room.slug, { confidence: 'high', source: 'user', fact: 'r1' });
      if (name !== 'Room B') await rooms.appendRecord(room.slug, { confidence: 'high', source: 'user', fact: 'r2' });
    }
    const keep = makeKeepCollection(castleDir);
    await keep.append('core', { confidence: 'high', source: 'user', fact: 'k1' });
    await keep.append('core', { confidence: 'high', source: 'user', fact: 'k2' });
    await makeChronicleCollection(castleDir).append({ confidence: 'high', source: 'user', fact: 'c1' });

    const result = await patrolDue(castleDir, new Date('2026-07-06T00:00:00Z'));
    expect(result.reasons).toEqual(['chronicle>=1', 'room:room-a>1', 'room:room-c>1', 'keep>1', 'daysSincePatrol>30']);
    expect(result.triggers.map((t) => [t.kind, t.target, t.count, t.limit])).toEqual([
      ['chronicle', 'chronicle', 1, 1],
      ['room', 'room:room-a', 2, 1],
      ['room', 'room:room-c', 2, 1],
      ['keep', 'keep', 2, 1],
      ['days', 'patrol', 186, 30],
    ]);
  });

  it('readCastleMeta fills factMaxChars=200 for a castle.json written before the budget existed', async () => {
    const path = castleJsonPath(castleDir);
    const raw = await readJsonFile<CastleMeta & { budgets: Record<string, number> }>(path);
    delete raw.budgets.factMaxChars;
    await writeJsonFile(path, raw);
    expect((await readCastleMeta(castleDir)).budgets.factMaxChars).toBe(200);
  });

  it('markPatrolled stamps lastPatrolAt with today and nothing else (contract C6)', async () => {
    await setLastPatrolAt(castleDir, '2026-01-01');
    const before = await readJsonFile<CastleMeta>(castleJsonPath(castleDir));
    await markPatrolled(castleDir, new Date(2026, 9, 28, 12));
    const after = await readJsonFile<CastleMeta>(castleJsonPath(castleDir));
    expect(after).toEqual({ ...before, lastPatrolAt: '2026-10-28' });
  });

  it('triggers when more than 30 days have passed since the last patrol', async () => {
    await setLastPatrolAt(castleDir, '2026-01-01');
    const result = await patrolDue(castleDir, new Date('2026-07-06T00:00:00Z'));
    expect(result.due).toBe(true);
    expect(result.reasons).toContain('daysSincePatrol>30');
  });
});
