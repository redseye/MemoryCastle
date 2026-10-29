// Pins the on-disk shape of archive/room-records-YYYY-MM.json (architecture
// §2): the record's own fields in canonical order, then archivedAt,
// archivedFrom, archiveNote — and byte-for-byte what `scripts/castle.mjs
// archive` writes, so the app and the model-run patrol leave the same files.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveRecord, initCastle, localDate, makeRoomsCollection } from '../src/core/index.js';
import { archivedRoomRecordsPath, roomJsonPath } from '../src/core/layout.js';
import { cleanupTempDir, makeTempDir } from './helpers.js';

const CASTLE_MJS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'castle.mjs');

describe('archive/room-records-YYYY-MM.json on disk', () => {
  let dir: string;
  let castleDir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    await mkdir(join(dir, 'a'));
    castleDir = await initCastle(join(dir, 'a'));
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  async function seedRoom(dirOfCastle: string) {
    const rooms = makeRoomsCollection(dirOfCastle);
    const room = await rooms.append({ name: 'Src', locus: ['src/**'] });
    const kept = await rooms.appendRecord(room.slug, { date: '2026-07-01', confidence: 'med', source: 'user', fact: '留下的事', tags: [] });
    const gone = await rooms.appendRecord(room.slug, {
      date: '2026-07-08',
      confidence: 'high',
      source: 'session',
      fact: '舊說法',
      tags: ['a', 'b'],
      routeWarning: 'before-release',
      verifiedAt: '2026-08-01',
    });
    return { slug: room.slug, kept, gone };
  }

  it('is exactly: schema, month, then one compact line per entry — record fields, archivedAt, archivedFrom, archiveNote', async () => {
    const { slug, gone } = await seedRoom(castleDir);
    await archiveRecord(castleDir, gone.id, 'superseded by w1: 新版');

    const today = localDate();
    const month = today.slice(0, 7);
    expect(await readFile(archivedRoomRecordsPath(castleDir, month), 'utf8')).toBe(
      [
        '{',
        '  "schema": 1,',
        `  "month": "${month}",`,
        '  "entries": [',
        `    {"id":"${gone.id}","date":"2026-07-08","confidence":"high","source":"session","fact":"舊說法","tags":["a","b"],"routeWarning":"before-release","verifiedAt":"2026-08-01","archivedAt":"${today}","archivedFrom":"room:${slug}","archiveNote":"superseded by w1: 新版"}`,
        '  ]',
        '}',
        '',
      ].join('\n'),
    );
  });

  it.skipIf(!existsSync(CASTLE_MJS))('matches scripts/castle.mjs archive byte-for-byte, archive file and the room file it leaves', async () => {
    const { slug, gone } = await seedRoom(castleDir);
    const rootB = join(dir, 'b');
    await cp(join(dir, 'a'), rootB, { recursive: true });
    const castleDirB = join(rootB, '.claude', 'castle');

    await archiveRecord(castleDir, gone.id, 'superseded by w1: 新版');
    execFileSync(process.execPath, [CASTLE_MJS, 'archive', rootB, '--note', 'superseded by w1: 新版', gone.id], { stdio: 'pipe' });

    const month = localDate().slice(0, 7);
    expect(await readFile(archivedRoomRecordsPath(castleDir, month), 'utf8')).toBe(
      await readFile(archivedRoomRecordsPath(castleDirB, month), 'utf8'),
    );
    expect(await readFile(roomJsonPath(castleDir, slug), 'utf8')).toBe(await readFile(roomJsonPath(castleDirB, slug), 'utf8'));
  });
});
