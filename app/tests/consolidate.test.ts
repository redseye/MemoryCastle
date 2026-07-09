import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readJsonFile, readJsonFileIfExists } from '../src/storage/json-file.js';
import { archiveChroniclePath, supersededJsonPath } from '../src/core/layout.js';
import {
  initCastle,
  makeChronicleCollection,
  makeKeepCollection,
  sweepChronicle,
  supersede,
} from '../src/core/index.js';
import { makeTempDir, cleanupTempDir } from './helpers.js';
import type { ChronicleArchiveFile, SupersededFile } from '../src/core/types.js';

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

    const swept = await sweepChronicle(castleDir, [jan.id, feb.id]);
    expect(swept.map((r) => r.id).sort()).toEqual([feb.id, jan.id].sort());

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

  it('moves the loser to archive/superseded.json and removes it from its origin collection', async () => {
    const keep = makeKeepCollection(castleDir);
    const loser = await keep.append('core', { confidence: 'med', source: 'user', fact: '舊事實：用 X' });
    const winner = await keep.append('core', { confidence: 'high', source: 'user', fact: '新事實：改用 Y' });

    const entry = await supersede(castleDir, loser.id, winner.id, '新版取代舊版');
    expect(entry.record.id).toBe(loser.id);
    expect(entry.supersededById).toBe(winner.id);
    expect(entry.reason).toBe('新版取代舊版');
    expect(entry.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(await keep.get(loser.id)).toBeUndefined();
    expect(await keep.get(winner.id)).toBeDefined();

    const file = await readJsonFileIfExists<SupersededFile>(supersededJsonPath(castleDir));
    expect(file?.entries).toHaveLength(1);
    expect(file?.entries[0].record.id).toBe(loser.id);
  });

  it('throws when the loser id does not exist anywhere', async () => {
    await expect(supersede(castleDir, 'no-such-id', 'winner-id', 'reason')).rejects.toThrow();
  });
});
