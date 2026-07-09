import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  countBudgets,
  initCastle,
  makeChronicleCollection,
  makeKeepCollection,
  makeRoomsCollection,
  patrolDue,
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
    const chronicle = makeChronicleCollection(castleDir);
    for (let i = 0; i < 20; i++) {
      await chronicle.append({ confidence: 'high', source: 'user', fact: `c${i}` });
    }
    const result = await patrolDue(castleDir, new Date());
    expect(result.due).toBe(true);
    expect(result.reasons).toContain('chronicle>=20');
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
  });

  it('triggers when keep exceeds 30 records', async () => {
    const keep = makeKeepCollection(castleDir);
    for (let i = 0; i < 31; i++) {
      await keep.append('core', { confidence: 'high', source: 'user', fact: `k${i}` });
    }
    const result = await patrolDue(castleDir, new Date());
    expect(result.due).toBe(true);
    expect(result.reasons).toContain('keep>30');
  });

  it('triggers when more than 30 days have passed since the last patrol', async () => {
    await setLastPatrolAt(castleDir, '2026-01-01');
    const result = await patrolDue(castleDir, new Date('2026-07-06T00:00:00Z'));
    expect(result.due).toBe(true);
    expect(result.reasons).toContain('daysSincePatrol>30');
  });
});
