import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readJsonFile, readJsonFileIfExists } from '../src/storage/json-file.js';
import { archiveChroniclePath, archivedRoomRecordsPath } from '../src/core/layout.js';
import {
  initCastle,
  localDate,
  makeChronicleCollection,
  makeKeepCollection,
  makeRoomsCollection,
  SweepRefusedError,
  sweepBlockers,
  sweepChronicle,
  supersede,
} from '../src/core/index.js';
import { makeTempDir, cleanupTempDir } from './helpers.js';
import type { ArchivedRecordsFile, ChronicleArchiveFile } from '../src/core/types.js';

describe('sweepChronicle', () => {
  let dir: string;
  let castleDir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    castleDir = await initCastle(dir);
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('moves swept entries out of chronicle.json into archive/chronicle-YYYY-MM.json, bucketed by month', async () => {
    const chronicle = makeChronicleCollection(castleDir);
    const jan = await chronicle.append({ date: '2026-01-15', confidence: 'high', source: 'user', fact: '一月的事' });
    const feb = await chronicle.append({ date: '2026-02-10', confidence: 'high', source: 'user', fact: '二月的事' });
    const keep = await chronicle.append({ date: '2026-07-01', confidence: 'high', source: 'user', fact: '不掃這條' });

    const result = await sweepChronicle(castleDir, [jan.id, feb.id]);
    expect(result.swept.map((r) => r.id).sort()).toEqual([feb.id, jan.id].sort());
    expect(result).toMatchObject({ unknownIds: [], refusedIds: [], unknownPromotedTo: [] });

    const remaining = await chronicle.list();
    expect(remaining.map((r) => r.id)).toEqual([keep.id]);

    const janArchive = await readJsonFile<ChronicleArchiveFile>(archiveChroniclePath(castleDir, '2026-01'));
    expect(janArchive.month).toBe('2026-01');
    expect(janArchive.entries).toHaveLength(1);
    expect(janArchive.entries[0].id).toBe(jan.id);
    expect(janArchive.entries[0].sweptAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const febArchive = await readJsonFile<ChronicleArchiveFile>(archiveChroniclePath(castleDir, '2026-02'));
    expect(febArchive.entries).toHaveLength(1);
    expect(febArchive.entries[0].id).toBe(feb.id);
  });

  it('records promotedTo on archived entries that patrol promoted, and only on those (contract C2)', async () => {
    const chronicle = makeChronicleCollection(castleDir);
    const promoted = await chronicle.append({ date: '2026-07-01', confidence: 'high', source: 'session', fact: '升級到房間' });
    const toKeep = await chronicle.append({ date: '2026-07-02', confidence: 'high', source: 'session', fact: '升級到 keep' });
    const plain = await chronicle.append({ date: '2026-07-03', confidence: 'high', source: 'session', fact: '單純封存' });
    await makeRoomsCollection(castleDir).append({ name: 'Web UI', slug: 'web-ui' });

    await sweepChronicle(castleDir, [promoted.id, toKeep.id, plain.id], { [promoted.id]: 'web-ui', [toKeep.id]: 'keep' });
    const archive = await readJsonFile<ChronicleArchiveFile>(archiveChroniclePath(castleDir, '2026-07'));
    const byId = new Map(archive.entries.map((e) => [e.id, e]));
    expect(byId.get(promoted.id)?.promotedTo).toBe('web-ui');
    expect(byId.get(toKeep.id)?.promotedTo).toBe('keep');
    expect(byId.get(plain.id)).not.toHaveProperty('promotedTo');
  });

  it('reports unknown ids to the caller and sweeps nothing (all-or-nothing, like castle.mjs sweep)', async () => {
    const chronicle = makeChronicleCollection(castleDir);
    const real = await chronicle.append({ date: '2026-07-01', confidence: 'high', source: 'session', fact: '真的條目' });

    const result = await sweepChronicle(castleDir, [real.id, 'ghost1', 'ghost2']);
    expect(result).toEqual({ swept: [], unknownIds: ['ghost1', 'ghost2'], refusedIds: [], unknownPromotedTo: [] });
    expect((await chronicle.list()).map((e) => e.id)).toEqual([real.id]);
    expect(await readJsonFileIfExists(archiveChroniclePath(castleDir, '2026-07'))).toBeUndefined();
  });

  it('refuses to sweep the newest handover (same-day tie → the later entry), but sweeps an older one', async () => {
    const chronicle = makeChronicleCollection(castleDir);
    const older = await chronicle.append({ date: '2026-07-01', confidence: 'high', source: 'session', fact: '狀態：一', tags: ['handover'] });
    const sameDayFirst = await chronicle.append({ date: '2026-07-05', confidence: 'high', source: 'session', fact: '狀態：二 #handover' });
    const newest = await chronicle.append({ date: '2026-07-05', confidence: 'high', source: 'session', fact: '狀態：三', tags: ['handover'] });

    const refused = await sweepChronicle(castleDir, [older.id, newest.id]);
    expect(refused).toEqual({ swept: [], unknownIds: [], refusedIds: [newest.id], unknownPromotedTo: [] });
    expect(await chronicle.list()).toHaveLength(3);

    const ok = await sweepChronicle(castleDir, [older.id, sameDayFirst.id]);
    expect(ok.swept.map((e) => e.id)).toEqual([older.id, sameDayFirst.id]);
    expect((await chronicle.list()).map((e) => e.id)).toEqual([newest.id]);
  });

  it('reports a promotedTo naming no room and sweeps nothing', async () => {
    const chronicle = makeChronicleCollection(castleDir);
    const e = await chronicle.append({ date: '2026-07-01', confidence: 'high', source: 'session', fact: '條目' });
    const result = await sweepChronicle(castleDir, [e.id], { [e.id]: 'no-such-room' });
    expect(result).toEqual({ swept: [], unknownIds: [], refusedIds: [], unknownPromotedTo: ['no-such-room'] });
    expect(await chronicle.get(e.id)).toBeDefined();
  });

  it('sweepBlockers is a dry run of the same checks and writes nothing', async () => {
    const chronicle = makeChronicleCollection(castleDir);
    const h = await chronicle.append({ date: '2026-07-01', confidence: 'high', source: 'session', fact: '狀態', tags: ['handover'] });
    expect(await sweepBlockers(castleDir, [h.id, 'ghost'])).toEqual({ unknownIds: ['ghost'], refusedIds: [h.id], unknownPromotedTo: [] });
    expect(await chronicle.get(h.id)).toBeDefined();
  });

  it('appends to an existing month archive rather than overwriting it', async () => {
    const chronicle = makeChronicleCollection(castleDir);
    const first = await chronicle.append({ date: '2026-03-01', confidence: 'high', source: 'user', fact: '第一批' });
    await sweepChronicle(castleDir, [first.id]);

    const second = await chronicle.append({ date: '2026-03-20', confidence: 'high', source: 'user', fact: '第二批' });
    await sweepChronicle(castleDir, [second.id]);

    const archive = await readJsonFile<ChronicleArchiveFile>(archiveChroniclePath(castleDir, '2026-03'));
    expect(archive.entries.map((e) => e.id)).toEqual([first.id, second.id]);
  });
});

describe('supersede', () => {
  let dir: string;
  let castleDir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    castleDir = await initCastle(dir);
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('archives a keep or room loser to archive/room-records-YYYY-MM.json with a "superseded by" note (architecture §2/§4 step 3)', async () => {
    const keep = makeKeepCollection(castleDir);
    const rooms = makeRoomsCollection(castleDir);
    const room = await rooms.append({ name: 'Src' });
    const loser = await keep.append('core', { confidence: 'med', source: 'user', fact: '舊事實：用 X' });
    const winner = await keep.append('core', { confidence: 'high', source: 'user', fact: '新事實：改用 Y' });
    const roomLoser = await rooms.appendRecord(room.slug, { confidence: 'low', source: 'session', fact: '房間舊說法' });

    const entry = await supersede(castleDir, loser.id, winner.id, '新版取代舊版');
    expect(entry).toEqual({ ...loser, archivedAt: localDate(), archivedFrom: 'keep', archiveNote: `superseded by ${winner.id}: 新版取代舊版` });
    await supersede(castleDir, roomLoser.id, winner.id, '同上');

    expect(await keep.get(loser.id)).toBeUndefined();
    expect(await keep.get(winner.id)).toBeDefined();
    expect((await rooms.get(room.slug))!.records).toEqual([]);

    const month = localDate().slice(0, 7);
    const file = await readJsonFile<ArchivedRecordsFile>(archivedRoomRecordsPath(castleDir, month));
    expect(file.month).toBe(month);
    expect(file.entries.map((e) => [e.id, e.archivedFrom])).toEqual([
      [loser.id, 'keep'],
      [roomLoser.id, `room:${room.slug}`],
    ]);
    expect(file.entries.every((e) => e.archiveNote.startsWith('superseded'))).toBe(true);
  });

  it('sweeps a chronicle loser to its monthly chronicle archive instead', async () => {
    const chronicle = makeChronicleCollection(castleDir);
    const loser = await chronicle.append({ date: '2026-07-01', confidence: 'med', source: 'agent', fact: '過時條目' });

    const entry = await supersede(castleDir, loser.id, 'winner-id', '過時');
    expect(entry).toMatchObject({ id: loser.id, sweptAt: localDate() });
    expect(await chronicle.get(loser.id)).toBeUndefined();
    const archive = await readJsonFileIfExists<ChronicleArchiveFile>(archiveChroniclePath(castleDir, '2026-07'));
    expect(archive?.entries.map((e) => e.id)).toEqual([loser.id]);
  });

  it('refuses a chronicle loser that is the newest handover (SweepRefusedError) and leaves it in place', async () => {
    const chronicle = makeChronicleCollection(castleDir);
    const handover = await chronicle.append({ date: '2026-07-01', confidence: 'med', source: 'session', fact: '狀態：x', tags: ['handover'] });
    await expect(supersede(castleDir, handover.id, 'winner-id', '過時')).rejects.toThrow(SweepRefusedError);
    expect(await chronicle.get(handover.id)).toBeDefined();
  });

  it('throws when the loser id does not exist anywhere', async () => {
    await expect(supersede(castleDir, 'no-such-id', 'winner-id', 'reason')).rejects.toThrow();
  });
});
