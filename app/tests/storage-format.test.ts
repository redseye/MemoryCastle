// Golden-file test for contract C4: castle JSON keeps a 2-space indented
// structure, but every record, every route, and every string array sits on
// ONE compact line with canonical key order — so `grep '"locus"' rooms/*.json`
// returns one line per room and grepping a keyword returns a whole record.
// Inputs below are deliberately built with scrambled key order.

import { describe, it, expect, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeCastleJson, writeJsonFile } from '../src/storage/json-file.js';
import { initCastle, makeRoomsCollection } from '../src/core/index.js';
import { makeTempDir, cleanupTempDir } from './helpers.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const GOLDEN = join(here, 'fixtures', 'serializer');

// The repo may check fixtures out with CRLF (core.autocrlf); output is LF.
async function golden(name: string): Promise<string> {
  return (await readFile(join(GOLDEN, name), 'utf8')).replace(/\r\n/g, '\n');
}

describe('castle JSON serializer (contract C4)', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await cleanupTempDir(dir);
    dir = undefined;
  });

  it('room file: compact one-line records and string arrays, canonical record key order, unknown keys kept last', async () => {
    const room = {
      schema: 1,
      slug: 'web-ui-rest-api-llm',
      name: '應用程式（Web UI／REST API）',
      locus: ['app/**', 'app/web/**'],
      adjacent: [],
      emblem: null,
      createdAt: '2026-07-08',
      records: [
        { id: 'ab12cd34', date: '2026-07-08', confidence: 'high', source: 'chronicle:x1,x2', fact: '第一條事實', tags: ['app'] },
        {
          extra: 'kept',
          verifiedAt: '2026-10-28',
          fact: '含 "引號" 與 \\ 的事實',
          tags: ['a', 'b'],
          routeWarning: 'before-release',
          source: 'user',
          confidence: 'med',
          date: '2026-07-09',
          id: 'ef56gh78',
        },
      ],
    };
    expect(serializeCastleJson(room)).toBe(await golden('room.golden.json'));
  });

  it('routes file: one compact line per route, stops in canonical target/read/note order', async () => {
    const routes = {
      schema: 1,
      routes: [
        {
          stops: [
            { read: 'due', target: 'patrol-check' },
            { target: 'keep', read: 'all' },
            { target: 'chronicle', read: 'last-handover' },
            { target: 'rooms-by-locus', read: 'all' },
          ],
          occasion: '每個 session 開工時走',
          name: 'session-start',
        },
        { name: 'imported', occasion: 'x', stops: [{ note: '原文', read: 'all', target: 'unknown' }] },
      ],
    };
    expect(serializeCastleJson(routes)).toBe(await golden('routes.golden.json'));
  });

  it('keep file: sections stay indented, empty sections are [], each record one line', async () => {
    const keep = {
      schema: 1,
      sections: {
        identity: [{ tags: ['identity'], fact: '身分事實', source: 'user', confidence: 'high', date: '2026-07-06', id: 'x7gqn885' }],
        constraints: [],
        core: [{ id: 'k1', date: '2026-07-06', confidence: 'low', source: 'session', fact: '核心事實', tags: [] }],
      },
    };
    expect(serializeCastleJson(keep)).toBe(await golden('keep.golden.json'));
  });

  it('archive file: sweptAt/promotedTo follow the record fields', async () => {
    const archive = {
      schema: 1,
      month: '2026-07',
      entries: [
        {
          promotedTo: 'web-ui-rest-api-llm',
          sweptAt: '2026-10-28',
          id: 'c1',
          date: '2026-07-06',
          confidence: 'med',
          source: 'session',
          fact: '已升級的條目',
          tags: ['lesson'],
        },
      ],
    };
    expect(serializeCastleJson(archive)).toBe(await golden('archive.golden.json'));
  });

  it('castle.json: plain objects (budgets) stay expanded; null and numbers as JSON', async () => {
    const meta = {
      schema: 1,
      projectName: 'MemoryCastle',
      createdAt: '2026-07-05',
      lastPatrolAt: null,
      budgets: { keepMax: 30, roomMax: 120, chronicleSweep: 20, patrolDays: 30, stalenessDays: 90, factMaxChars: 200 },
    };
    expect(serializeCastleJson(meta)).toBe(await golden('castle.golden.json'));
  });

  it('writeJsonFile writes exactly the serializer output and it parses back to the same data', async () => {
    dir = await makeTempDir();
    const file = join(dir, 'room.json');
    const data = JSON.parse(await golden('room.golden.json'));
    await writeJsonFile(file, data);
    const raw = await readFile(file, 'utf8');
    expect(raw).toBe(await golden('room.golden.json'));
    expect(JSON.parse(raw)).toEqual(data);
  });

  it('a room written through the collection has exactly one "locus" line and one line per record', async () => {
    dir = await makeTempDir();
    const castleDir = await initCastle(dir);
    const rooms = makeRoomsCollection(castleDir);
    const room = await rooms.append({ name: 'App Room', locus: ['app/**', 'docs/**'] });
    await rooms.appendRecord(room.slug, { confidence: 'high', source: 'user', fact: '甲', tags: ['t'] });
    await rooms.appendRecord(room.slug, { confidence: 'med', source: 'session', fact: '乙' });
    const lines = (await readFile(join(castleDir, 'rooms', `${room.slug}.json`), 'utf8')).split('\n');
    expect(lines.filter((l) => l.includes('"locus"'))).toEqual(['  "locus": ["app/**","docs/**"],']);
    const recordLines = lines.filter((l) => l.includes('"fact"'));
    expect(recordLines).toHaveLength(2);
    for (const line of recordLines) expect(line).toMatch(/^ {4}\{"id":"[a-z0-9]{8}","date":"\d{4}-\d{2}-\d{2}","confidence":/);
  });
});
