import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initCastle,
  makeChronicleCollection,
  makeKeepCollection,
  makeRoomsCollection,
  makeRoutesCollection,
} from '../src/core/index.js';
import { makeTempDir, cleanupTempDir } from './helpers.js';

describe('collections', () => {
  let dir: string;
  let castleDir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    castleDir = await initCastle(dir);
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('keep: append/get/update/remove round trip returns the written record', async () => {
    const keep = makeKeepCollection(castleDir);
    const written = await keep.append('core', { confidence: 'high', source: 'user', fact: '事實一', tags: ['a'] });
    expect(written.id).toBeTruthy();
    expect(written.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(await keep.get(written.id)).toEqual(written);
    expect(await keep.list('core')).toEqual([written]);

    const updated = await keep.update(written.id, { fact: '事實一（修正）' });
    expect(updated.id).toBe(written.id);
    expect(updated.fact).toBe('事實一（修正）');
    expect((await keep.get(written.id))?.fact).toBe('事實一（修正）');

    const removed = await keep.remove(written.id);
    expect(removed.id).toBe(written.id);
    expect(await keep.get(written.id)).toBeUndefined();
  });

  it('chronicle: append/list/update/remove round trip', async () => {
    const chronicle = makeChronicleCollection(castleDir);
    const a = await chronicle.append({ confidence: 'med', source: 'user', fact: '記事A' });
    const b = await chronicle.append({ confidence: 'low', source: 'user', fact: '記事B' });
    expect((await chronicle.list()).map((r) => r.id)).toEqual([a.id, b.id]);

    const updated = await chronicle.update(a.id, { confidence: 'high' });
    expect(updated.confidence).toBe('high');

    const removed = await chronicle.remove(b.id);
    expect(removed.id).toBe(b.id);
    expect((await chronicle.list()).map((r) => r.id)).toEqual([a.id]);
  });

  it('rooms: create/get/update/remove plus per-room record append/update/remove', async () => {
    const rooms = makeRoomsCollection(castleDir);
    const room = await rooms.append({ name: 'Deploy Corridor', locus: ['scripts/**'], adjacent: [] });
    expect(room.slug).toBe('deploy-corridor');
    expect(await rooms.get(room.slug)).toEqual(room);

    const updatedRoom = await rooms.update(room.slug, { locus: ['scripts/**', 'deploy/**'] });
    expect(updatedRoom.locus).toEqual(['scripts/**', 'deploy/**']);

    const record = await rooms.appendRecord(room.slug, { confidence: 'high', source: 'user', fact: '部署順序很重要' });
    expect((await rooms.get(room.slug))?.records).toEqual([record]);

    const updatedRecord = await rooms.updateRecord(room.slug, record.id, { fact: '部署順序真的很重要' });
    expect(updatedRecord.fact).toBe('部署順序真的很重要');

    await rooms.removeRecord(room.slug, record.id);
    expect((await rooms.get(room.slug))?.records).toEqual([]);

    const removedRoom = await rooms.remove(room.slug);
    expect(removedRoom.slug).toBe(room.slug);
    expect(await rooms.get(room.slug)).toBeUndefined();
  });

  it('rooms: ASCII name collisions get a numeric suffix', async () => {
    const rooms = makeRoomsCollection(castleDir);
    const r1 = await rooms.append({ name: 'Deploy Corridor' });
    const r2 = await rooms.append({ name: 'Deploy Corridor' });
    expect(r1.slug).toBe('deploy-corridor');
    expect(r2.slug).toBe('deploy-corridor-2');
  });

  it('rooms: a name with no ASCII letters still gets a usable, distinct slug', async () => {
    const rooms = makeRoomsCollection(castleDir);
    const r1 = await rooms.append({ name: '環境' });
    const r2 = await rooms.append({ name: '部署' });
    expect(r1.slug).toMatch(/^room-[a-z0-9]+$/);
    expect(r2.slug).toMatch(/^room-[a-z0-9]+$/);
    expect(r1.slug).not.toBe(r2.slug);
  });

  it('routes: append/get/update/remove round trip on top of the default three', async () => {
    const routes = makeRoutesCollection(castleDir);
    expect((await routes.list()).map((r) => r.name)).toEqual(['session-start', 'before-release', 'patrol']);

    const custom = await routes.append({ name: 'demo', occasion: '示範', stops: [{ target: 'keep', read: 'all' }] });
    expect(custom.name).toBe('demo');

    const updated = await routes.update('demo', { occasion: '更新後' });
    expect(updated.occasion).toBe('更新後');
    expect(updated.stops).toEqual(custom.stops);

    const removed = await routes.remove('demo');
    expect(removed.name).toBe('demo');
    expect(await routes.get('demo')).toBeUndefined();
  });
});
