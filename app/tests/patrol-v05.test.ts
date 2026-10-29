// v0.5 token-tightening conformance for the LLM flows (patrolFlow /
// rememberFlow), driven through the flows directly with a schema-dispatching
// fake LlmService that records every call — no network, no provider. One
// describe per fix: C6 stamp, write-path caps and budgets, handovers (C8a),
// orphans (C8b), decay and splits (C8c/C8d), provenance, incremental vs
// full, call count / concurrency, and the single-call remember gate.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { initCastle, localDate, openCastle, type Castle } from '../src/core/index.js';
import type { ArchivedRecordEntry, ArchivedRecordsFile, Budgets, CastleRecord, ChronicleArchiveEntry, ChronicleArchiveFile } from '../src/core/types.js';
import { readJsonFile, writeJsonFile } from '../src/storage/json-file.js';
import { castleJsonPath } from '../src/core/layout.js';
import { NotConfiguredLlmService, type JudgeTask, type LlmService } from '../src/server/llm-seam.js';
import {
  applyPatrolJob,
  getPatrolJob,
  runPatrol,
  type PatrolProposal,
  type RoomRecordPayload,
} from '../src/flows/patrolFlow.js';
import { rememberFlow } from '../src/flows/rememberFlow.js';
import {
  CLUSTER_ENTRIES_SCHEMA,
  CONTRADICTION_CHECK_SCHEMA,
  DISTILL_CLUSTER_SCHEMA,
  KEEP_CUT_SCHEMA,
  KEEP_PROMOTION_SCHEMA,
  REMEMBER_SCHEMA,
  REWRITE_FACTS_SCHEMA,
  ROOM_DISTILL_SCHEMA,
} from '../src/llm/schemas.js';
import { cleanupTempDir, makeTempDir } from './helpers.js';

type Kind = 'cluster' | 'distill' | 'rewrite' | 'contradiction' | 'promotion' | 'roomDistill' | 'keepCut' | 'remember';

const KIND_BY_SCHEMA = new Map<unknown, Kind>([
  [CLUSTER_ENTRIES_SCHEMA, 'cluster'],
  [DISTILL_CLUSTER_SCHEMA, 'distill'],
  [REWRITE_FACTS_SCHEMA, 'rewrite'],
  [CONTRADICTION_CHECK_SCHEMA, 'contradiction'],
  [KEEP_PROMOTION_SCHEMA, 'promotion'],
  [ROOM_DISTILL_SCHEMA, 'roomDistill'],
  [KEEP_CUT_SCHEMA, 'keepCut'],
  [REMEMBER_SCHEMA, 'remember'],
]);

const EMPTY: Record<Kind, unknown> = {
  cluster: { clusters: [], orphans: [] },
  distill: { records: [] },
  rewrite: { items: [] },
  contradiction: { contradictions: [] },
  promotion: { promotions: [] },
  roomDistill: { merges: [], cuts: [] },
  keepCut: { cuts: [] },
  remember: { novel: true, reusable: true, verifiable: true, secretRefusal: false, reason: '通過', fact: '事實', confidence: 'med', tags: [] },
};

interface Call {
  kind: Kind;
  task: JudgeTask<unknown>;
}

type Handlers = Partial<Record<Kind, (task: JudgeTask<unknown>) => unknown>>;

function fakeLlm(handlers: Handlers = {}) {
  const calls: Call[] = [];
  const service: LlmService = {
    async verifyKey() {},
    async judge<T>(task: JudgeTask<T>): Promise<T> {
      const kind = KIND_BY_SCHEMA.get(task.schema);
      if (!kind) throw new Error(`unknown schema: ${JSON.stringify(task.schema)}`);
      calls.push({ kind, task: task as JudgeTask<unknown> });
      const handler = handlers[kind];
      return (handler ? await handler(task as JudgeTask<unknown>) : EMPTY[kind]) as T;
    },
  };
  return { service, calls, of: (kind: Kind) => calls.filter((c) => c.kind === kind) };
}

function daysAgo(n: number): string {
  return localDate(new Date(Date.now() - n * 86_400_000));
}

const long = (n: number) => '長'.repeat(n);

function toRoom(slug: string) {
  return { targetRoomSlug: slug, newRoomName: '', newRoomLocus: [] as string[], newRoomAdjacent: [] as string[] };
}

function clusterTo(slug: string, ids: string[]) {
  return { ...toRoom(slug), entryIds: ids, locus: 'src/**', topic: 'src' };
}

async function setBudgets(castle: Castle, patch: Partial<Budgets>): Promise<void> {
  const path = castleJsonPath(castle.castleDir);
  const meta = await readJsonFile<{ budgets: Budgets }>(path);
  await writeJsonFile(path, { ...meta, budgets: { ...meta.budgets, ...patch } });
}

// archive/room-records-YYYY-MM.json, every month (architecture §2).
async function archivedRecords(castle: Castle): Promise<ArchivedRecordEntry[]> {
  const dir = join(castle.castleDir, 'archive');
  const files = (await readdir(dir)).filter((f) => /^room-records-\d{4}-\d{2}\.json$/.test(f));
  const out: ArchivedRecordEntry[] = [];
  for (const f of files) out.push(...(await readJsonFile<ArchivedRecordsFile>(join(dir, f))).entries);
  return out;
}

async function archivedChronicle(castle: Castle): Promise<ChronicleArchiveEntry[]> {
  const dir = join(castle.castleDir, 'archive');
  const files = (await readdir(dir)).filter((f) => /^chronicle-\d{4}-\d{2}\.json$/.test(f));
  const out: ChronicleArchiveEntry[] = [];
  for (const f of files) out.push(...(await readJsonFile<ChronicleArchiveFile>(join(dir, f))).entries);
  return out;
}

function ofKind(job: { proposals: PatrolProposal[] }, kind: PatrolProposal['kind']): PatrolProposal[] {
  return job.proposals.filter((p) => p.kind === kind);
}

const entry = (fact: string, extra: Partial<CastleRecord> = {}) => ({ confidence: 'med' as const, source: 'session', fact, tags: [], ...extra });

describe('patrol v0.5', () => {
  let dir: string;
  let castle: Castle;

  beforeEach(async () => {
    dir = await makeTempDir();
    await initCastle(dir);
    castle = await openCastle(dir);
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  describe('C6: the close stamps lastPatrolAt', () => {
    it('applying a completed patrol stamps today, so the date trigger stops firing', async () => {
      await castle.markPatrolled(new Date(2020, 0, 1));
      expect((await castle.patrolDue()).triggers.map((t) => t.kind)).toContain('days');

      const job = await runPatrol(castle, fakeLlm().service);
      expect(job.complete).toBe(true);
      const applied = await applyPatrolJob(castle, job.id, []);

      expect(applied.applyReport?.patrolledAt).toBe(localDate());
      expect((await castle.getMeta()).lastPatrolAt).toBe(localDate());
      expect((await castle.patrolDue()).triggers.map((t) => t.kind)).not.toContain('days');
    });

    it('a key-less patrol is not complete; its apply leaves lastPatrolAt alone', async () => {
      await castle.markPatrolled(new Date(2020, 0, 1));
      const job = await runPatrol(castle, new NotConfiguredLlmService());
      expect(job.complete).toBe(false);
      const applied = await applyPatrolJob(castle, job.id, []);
      expect(applied.applyReport?.patrolledAt).toBeNull();
      expect((await castle.getMeta()).lastPatrolAt).toBe(localDate(new Date(2020, 0, 1)));
    });
  });

  describe('write path: factMaxChars, retries, budgets', () => {
    it('the distill prompt states the cap; an over-cap fact gets ONE rewrite, and if still over it is dropped with a warning — never written', async () => {
      const room = await castle.rooms.append({ name: 'Src', locus: ['src/**'] });
      const a = await castle.chronicle.append(entry('A'));
      const b = await castle.chronicle.append(entry('B'));
      const fake = fakeLlm({
        cluster: () => ({ clusters: [clusterTo(room.slug, [a.id, b.id])], orphans: [] }),
        distill: () => ({ records: [{ fact: long(201), confidence: 'med', tags: [] }] }),
        rewrite: () => ({ items: [{ key: 'r0', facts: [long(250)] }] }),
      });

      const job = await runPatrol(castle, fake.service);

      expect(fake.of('distill')[0].task.system).toContain('at most 200 characters');
      expect(fake.of('rewrite')).toHaveLength(1);
      expect(ofKind(job, 'roomRecord')).toEqual([]);
      expect(job.warnings.filter((w) => w.kind === 'fact-dropped')).toHaveLength(1);
      await applyPatrolJob(castle, job.id, []);
      expect((await castle.rooms.get(room.slug))!.records).toEqual([]);
      expect((await castle.chronicle.list()).map((e) => e.id)).toEqual([a.id, b.id]);
    });

    it('a rewrite that splits the over-cap fact into fitting facts is proposed and written', async () => {
      const room = await castle.rooms.append({ name: 'Src', locus: ['src/**'] });
      const a = await castle.chronicle.append(entry('A'));
      const b = await castle.chronicle.append(entry('B'));
      const fake = fakeLlm({
        cluster: () => ({ clusters: [clusterTo(room.slug, [a.id, b.id])], orphans: [] }),
        distill: () => ({ records: [{ fact: `一\n${long(10)}`, confidence: 'med', tags: ['x'] }] }),
        rewrite: () => ({ items: [{ key: 'r0', facts: ['第一件事', '第二件事'] }] }),
      });

      const job = await runPatrol(castle, fake.service);
      const [p] = ofKind(job, 'roomRecord');
      expect((p.payload as RoomRecordPayload).records.map((r) => r.fact)).toEqual(['第一件事', '第二件事']);
      await applyPatrolJob(castle, job.id, []);
      expect((await castle.rooms.get(room.slug))!.records.map((r) => r.fact)).toEqual(['第一件事', '第二件事']);
    });

    it('apply re-checks the cap: an over-cap or multi-line payload fact fails fact_too_long and nothing is written', async () => {
      const room = await castle.rooms.append({ name: 'Src', locus: ['src/**'] });
      const a = await castle.chronicle.append(entry('A'));
      const b = await castle.chronicle.append(entry('B'));
      const fake = fakeLlm({
        cluster: () => ({ clusters: [clusterTo(room.slug, [a.id, b.id])], orphans: [] }),
        distill: () => ({ records: [{ fact: '短事實', confidence: 'med', tags: [] }] }),
      });
      const job = await runPatrol(castle, fake.service);
      const [p] = ofKind(job, 'roomRecord');
      (getPatrolJob(job.id)!.proposals.find((x) => x.id === p.id)!.payload as RoomRecordPayload).records[0].fact = '一行\n兩行';

      const applied = await applyPatrolJob(castle, job.id, []);
      expect(applied.applyReport?.failed).toEqual([{ id: p.id, reason: 'fact_too_long' }]);
      expect(applied.applyReport?.appliedIds).not.toContain(p.id);
      expect((await castle.rooms.get(room.slug))!.records).toEqual([]);
      expect((await castle.chronicle.list()).map((e) => e.id)).toEqual([a.id, b.id]);
    });

    it('a green roomRecord that would push its room past roomMax becomes yellow', async () => {
      await setBudgets(castle, { roomMax: 2 });
      const room = await castle.rooms.append({ name: 'Src', locus: ['src/**'] });
      await castle.rooms.appendRecord(room.slug, entry('舊一'));
      await castle.rooms.appendRecord(room.slug, entry('舊二'));
      const a = await castle.chronicle.append(entry('A'));
      const b = await castle.chronicle.append(entry('B'));
      const fake = fakeLlm({
        cluster: () => ({ clusters: [clusterTo(room.slug, [a.id, b.id])], orphans: [] }),
        distill: () => ({ records: [{ fact: '新事實', confidence: 'med', tags: [] }] }),
      });

      const job = await runPatrol(castle, fake.service);
      const [p] = ofKind(job, 'roomRecord');
      expect(p.tier).toBe('yellow');

      const skipped = await applyPatrolJob(castle, job.id, []);
      expect(skipped.applyReport?.skippedYellowIds).toContain(p.id);
      expect((await castle.rooms.get(room.slug))!.records).toHaveLength(2);
    });

    it('a room over roomMax yields yellow roomDistill merge/cut proposals; keep over keepMax yields yellow keepCut proposals', async () => {
      await setBudgets(castle, { roomMax: 3, keepMax: 1 });
      const room = await castle.rooms.append({ name: 'Src', locus: ['src/**'] });
      const r1 = await castle.rooms.appendRecord(room.slug, { ...entry('甲'), confidence: 'high', date: daysAgo(3) });
      const r2 = await castle.rooms.appendRecord(room.slug, { ...entry('甲的重述'), date: daysAgo(1) });
      const r3 = await castle.rooms.appendRecord(room.slug, entry('過時的事'));
      await castle.rooms.appendRecord(room.slug, entry('留下的事'));
      const k1 = await castle.keep.append('core', entry('可降級的事'));
      const k2 = await castle.keep.append('core', entry('可封存的事'));
      const fake = fakeLlm({
        roomDistill: () => ({ merges: [{ recordIds: [r1.id, r2.id], fact: '甲（合併）', tags: ['m'] }], cuts: [{ recordId: r3.id, reason: '過時' }] }),
        keepCut: () => ({
          cuts: [
            { recordId: k1.id, action: 'demote', targetRoomSlug: room.slug, reason: '少用' },
            { recordId: k2.id, action: 'archive', targetRoomSlug: '', reason: '過時' },
          ],
        }),
      });

      const job = await runPatrol(castle, fake.service);
      const distills = ofKind(job, 'roomDistill');
      const cuts = ofKind(job, 'keepCut');
      expect(distills.map((p) => p.tier)).toEqual(['yellow', 'yellow']);
      expect(cuts.map((p) => p.tier)).toEqual(['yellow', 'yellow']);
      expect(fake.of('keepCut')[0].task.context).toContain(k1.id);

      await applyPatrolJob(castle, job.id, [...distills, ...cuts].map((p) => p.id));
      const after = (await castle.rooms.get(room.slug))!.records;
      expect(after.map((r) => r.fact).sort()).toEqual(['可降級的事', '甲（合併）', '留下的事'].sort());
      const merged = after.find((r) => r.fact === '甲（合併）')!;
      expect(merged.confidence).toBe('med'); // the lowest of the merged pair
      expect(merged.date).toBe(r2.date); // the newest of the merged pair
      expect(merged.source).toBe(`archive:${r1.id},${r2.id}`);
      expect(await castle.keep.list()).toEqual([]);
      const archived = await archivedRecords(castle);
      expect(archived.map((e) => e.id).sort()).toEqual([r1.id, r2.id, r3.id, k2.id].sort());
      expect(archived.find((e) => e.id === r1.id)).toMatchObject({ archivedFrom: `room:${room.slug}`, archivedAt: localDate() });
      expect(archived.find((e) => e.id === r1.id)!.archiveNote).toContain(merged.id);
      expect(archived.find((e) => e.id === k2.id)?.archivedFrom).toBe('keep');
    });

    it('the pre-pass chronicle warning counts only entries dated after lastPatrolAt, like patrolDue', async () => {
      for (let i = 0; i < 20; i++) await castle.chronicle.append({ ...entry(`c${i}`), date: daysAgo(5) });
      const quiet = await runPatrol(castle, new NotConfiguredLlmService()); // init stamped lastPatrolAt = today
      expect(quiet.warnings.some((w) => w.target === 'chronicle')).toBe(false);

      await castle.markPatrolled(new Date(Date.now() - 10 * 86_400_000));
      const loud = await runPatrol(castle, new NotConfiguredLlmService());
      expect(loud.warnings.some((w) => w.kind === 'over-budget' && w.target === 'chronicle')).toBe(true);
    });
  });

  describe('C8a: handovers', () => {
    it('never reach a prompt; every handover but the newest is swept (green), each listed with its full text for review (F10)', async () => {
      const h1 = await castle.chronicle.append({ ...entry('狀態：一／決定：改用 X 因為 Y／下一步：寫測試'), tags: ['handover'], date: daysAgo(3) });
      const h2 = await castle.chronicle.append({ ...entry('狀態：二 #handover'), date: daysAgo(2) });
      const h3 = await castle.chronicle.append({ ...entry('狀態：三'), tags: ['handover'] });
      const a = await castle.chronicle.append(entry('A'));
      const b = await castle.chronicle.append(entry('B'));
      const fake = fakeLlm();

      const job = await runPatrol(castle, fake.service);

      for (const call of fake.calls) {
        for (const h of [h1, h2, h3]) expect(`${call.task.context ?? ''}${call.task.system}${call.task.user}`).not.toContain(h.id);
      }
      expect(fake.of('cluster')[0].task.user).toContain(a.id);
      const [sweep] = ofKind(job, 'chronicleSweep');
      expect(sweep.tier).toBe('green');
      expect(sweep.payload).toEqual({ entryIds: [h1.id, h2.id], reason: 'handover', entries: [h1, h2] });
      expect(sweep.summary).toContain(h1.fact); // the full text, so a decision can be rescued before applying
      expect(sweep.summary).toContain(h2.fact);
      expect(sweep.summary).not.toContain(h3.fact);

      await applyPatrolJob(castle, job.id, []);
      expect((await castle.chronicle.list()).map((e) => e.id)).toEqual([h3.id, a.id, b.id]);
      expect((await archivedChronicle(castle)).map((e) => e.id).sort()).toEqual([h1.id, h2.id].sort());
    });
  });

  it('C8a: the handover sweep needs no LLM (no extra call, F10) — a key-less patrol proposes it too', async () => {
    const h1 = await castle.chronicle.append({ ...entry('狀態：一'), tags: ['handover'], date: daysAgo(3) });
    await castle.chronicle.append({ ...entry('狀態：二'), tags: ['handover'] });
    const job = await runPatrol(castle, new NotConfiguredLlmService());
    expect(ofKind(job, 'chronicleSweep').map((p) => p.payload)).toMatchObject([{ entryIds: [h1.id], reason: 'handover' }]);
  });

  describe('blocked sweeps are failed proposals, never applied ones (castle.mjs sweep semantics)', () => {
    it('a handover sweep whose entry vanished before apply → failed not_found, nothing swept', async () => {
      const h1 = await castle.chronicle.append({ ...entry('狀態：一'), tags: ['handover'], date: daysAgo(3) });
      const h2 = await castle.chronicle.append({ ...entry('狀態：二'), tags: ['handover'], date: daysAgo(2) });
      await castle.chronicle.append({ ...entry('狀態：三'), tags: ['handover'] });
      const job = await runPatrol(castle, new NotConfiguredLlmService());
      const [sweep] = ofKind(job, 'chronicleSweep');
      expect(sweep.payload).toMatchObject({ entryIds: [h1.id, h2.id] });

      await castle.chronicle.remove(h1.id);
      const applied = await applyPatrolJob(castle, job.id, []);
      expect(applied.applyReport?.failed).toEqual([{ id: sweep.id, reason: 'not_found' }]);
      expect(applied.applyReport?.appliedIds).not.toContain(sweep.id);
      expect(await castle.chronicle.get(h2.id)).toBeDefined(); // all-or-nothing: h2 was not swept either
    });

    it('a sweep that would take the newest handover → failed newest_handover, the handover stays', async () => {
      const h1 = await castle.chronicle.append({ ...entry('狀態：一'), tags: ['handover'], date: daysAgo(3) });
      const h2 = await castle.chronicle.append({ ...entry('狀態：二'), tags: ['handover'] });
      const job = await runPatrol(castle, new NotConfiguredLlmService());
      const [sweep] = ofKind(job, 'chronicleSweep');
      expect(sweep.payload).toMatchObject({ entryIds: [h1.id] });

      await castle.chronicle.remove(h2.id); // h1 is now the newest handover
      const applied = await applyPatrolJob(castle, job.id, []);
      expect(applied.applyReport?.failed).toEqual([{ id: sweep.id, reason: 'newest_handover' }]);
      expect(applied.applyReport?.appliedIds).toEqual([]);
      expect(await castle.chronicle.get(h1.id)).toBeDefined();
    });
  });

  describe('C8b: aged orphans', () => {
    it('tag-owned → its room verbatim, model-routed → its room, unowned → archive (all green); young orphans stay', async () => {
      const room = await castle.rooms.append({ name: 'Src', locus: ['src/**'] });
      const o1 = await castle.chronicle.append({ ...entry('o1 事實'), tags: [room.slug], date: daysAgo(60), routeWarning: 'before-release', verifiedAt: daysAgo(40) });
      const o2 = await castle.chronicle.append({ ...entry('o2 事實'), tags: ['misc'], date: daysAgo(61) });
      const o3 = await castle.chronicle.append({ ...entry('o3 事實'), date: daysAgo(62) });
      const o4 = await castle.chronicle.append({ ...entry('README 就寫了的事'), tags: [room.slug], date: daysAgo(63) });
      const y1 = await castle.chronicle.append({ ...entry('y1 事實'), date: daysAgo(5) });
      const fake = fakeLlm({
        cluster: () => ({
          clusters: [],
          orphans: [
            { entryId: o1.id, targetRoomSlug: '', passesGate: true }, // the tag wins over the model's ""
            { entryId: o2.id, targetRoomSlug: room.slug, passesGate: true },
            { entryId: o3.id, targetRoomSlug: '', passesGate: true },
            { entryId: o4.id, targetRoomSlug: room.slug, passesGate: false }, // re-applied gate fails
            { entryId: y1.id, targetRoomSlug: room.slug, passesGate: true }, // not aged: must be ignored
          ],
        }),
      });

      const job = await runPatrol(castle, fake.service);

      const clusterUser = fake.of('cluster')[0].task.user;
      for (const o of [o1, o2, o3, o4]) expect(clusterUser).toMatch(new RegExp(`id:${o.id}[^\\n]*\\[aged\\]`));
      expect(clusterUser).not.toMatch(new RegExp(`id:${y1.id}[^\\n]*\\[aged\\]`));
      const moves = ofKind(job, 'roomRecord');
      expect(moves.map((p) => p.tier)).toEqual(['green', 'green']);
      expect(moves.map((p) => (p.payload as RoomRecordPayload).sweepEntryIds)).toEqual([[o1.id], [o2.id]]);
      expect(ofKind(job, 'chronicleSweep').map((p) => p.payload)).toEqual([
        { entryIds: [o3.id], reason: 'orphan' },
        { entryIds: [o4.id], reason: 'gate' },
      ]);

      await applyPatrolJob(castle, job.id, []);
      const records = (await castle.rooms.get(room.slug))!.records;
      const moved = records.find((r) => r.fact === 'o1 事實')!;
      expect(moved).toMatchObject({ date: o1.date, source: `chronicle:${o1.id}`, routeWarning: 'before-release', verifiedAt: o1.verifiedAt });
      expect((await castle.chronicle.list()).map((e) => e.id)).toEqual([y1.id]);
      const archived = await archivedChronicle(castle);
      expect(archived.find((e) => e.id === o3.id)?.promotedTo).toBeUndefined();
      expect(archived.find((e) => e.id === o2.id)?.promotedTo).toBe(room.slug);
    });
  });

  it('F6: a 2-entry cluster no room owns is not a cluster — its aged entries go one by one (room if owned, else archive); young ones stay', async () => {
    const room = await castle.rooms.append({ name: 'Src', locus: ['src/**'] });
    const owned = await castle.chronicle.append({ ...entry('有房間的舊條目'), tags: [room.slug], date: daysAgo(60) });
    const loose = await castle.chronicle.append({ ...entry('無房間的舊條目'), date: daysAgo(61) });
    const y1 = await castle.chronicle.append({ ...entry('新條目一'), date: daysAgo(2) });
    const y2 = await castle.chronicle.append({ ...entry('新條目二'), date: daysAgo(2) });
    const fake = fakeLlm({
      cluster: () => ({
        clusters: [
          { ...toRoom(''), entryIds: [owned.id, loose.id], locus: 'x', topic: 'x' }, // model ignored F6
          { ...toRoom(''), entryIds: [y1.id, y2.id], locus: 'y', topic: 'y' },
        ],
        orphans: [],
      }),
    });

    const job = await runPatrol(castle, fake.service);
    expect(fake.of('cluster')[0].task.system).toContain('fewer than 3 entries: it is not a cluster');
    expect(fake.of('distill')).toEqual([]);
    expect(ofKind(job, 'roomRecord').map((p) => (p.payload as RoomRecordPayload).sweepEntryIds)).toEqual([[owned.id]]);
    expect(ofKind(job, 'chronicleSweep').map((p) => p.payload)).toEqual([{ entryIds: [loose.id], reason: 'orphan' }]);

    await applyPatrolJob(castle, job.id, []);
    expect((await castle.chronicle.list()).map((e) => e.id)).toEqual([y1.id, y2.id]);
  });

  describe('C8c/C8d: decay and over-length records', () => {
    it('hypotheses become yellow staleReview proposals; verify / archive / delete each do their part', async () => {
      const room = await castle.rooms.append({ name: 'Src', locus: ['src/**'] });
      const k1 = await castle.keep.append('core', { ...entry('舊 keep 事實'), date: daysAgo(200) });
      const k2 = await castle.keep.append('core', { ...entry('使用者指示'), source: 'user', date: daysAgo(200) });
      const r1 = await castle.rooms.appendRecord(room.slug, { ...entry('舊房間事實'), date: daysAgo(200) });
      const r2 = await castle.rooms.appendRecord(room.slug, { ...entry('推測'), confidence: 'low' });
      const r3 = await castle.rooms.appendRecord(room.slug, { ...entry('新事實'), confidence: 'high' });

      const job = await runPatrol(castle, fakeLlm().service);
      const reviews = ofKind(job, 'staleReview');
      const reviewOf = (id: string) => reviews.find((p) => (p.payload as { record: CastleRecord }).record.id === id);
      expect(reviews.every((p) => p.tier === 'yellow')).toBe(true);
      expect(reviewOf(k1.id)).toBeDefined();
      expect(reviewOf(r1.id)).toBeDefined();
      expect(reviewOf(r2.id)).toBeDefined();
      expect(reviewOf(k2.id)).toBeUndefined(); // source user: a standing directive
      expect(reviewOf(r3.id)).toBeUndefined();

      const applied = await applyPatrolJob(castle, job.id, [reviewOf(r1.id)!.id], {
        [reviewOf(k1.id)!.id]: 'verify',
        [reviewOf(r1.id)!.id]: 'archive',
        [reviewOf(r2.id)!.id]: 'delete',
      });
      expect(applied.applyReport?.failed).toEqual([]);
      expect((await castle.keep.get(k1.id))?.verifiedAt).toBe(localDate());
      const roomAfter = (await castle.rooms.get(room.slug))!.records.map((r) => r.id);
      expect(roomAfter).toEqual([r3.id]);
      expect(await archivedRecords(castle)).toMatchObject([{ id: r1.id, fact: r1.fact, archivedFrom: `room:${room.slug}` }]);
      const note = (await castle.chronicle.list()).find((e) => e.tags.includes('deletion'))!;
      expect(note.fact).toContain(r2.id);
      expect(note.fact.length).toBeLessThanOrEqual(200);
    });

    it('a staleReview without a decision is skipped, even if its id is in approvals', async () => {
      const k1 = await castle.keep.append('core', { ...entry('舊 keep 事實'), date: daysAgo(200) });
      const job = await runPatrol(castle, fakeLlm().service);
      const [review] = ofKind(job, 'staleReview');
      const applied = await applyPatrolJob(castle, job.id, [review.id]);
      expect(applied.applyReport?.skippedYellowIds).toEqual([review.id]);
      expect((await castle.keep.get(k1.id))?.verifiedAt).toBeUndefined();
    });

    it('over-cap records become splits: green in a room, yellow in keep; hypotheses go to staleReview instead', async () => {
      const room = await castle.rooms.append({ name: 'Src', locus: ['src/**'] });
      const rr = await castle.rooms.appendRecord(room.slug, { ...entry(long(250)), date: daysAgo(4), routeWarning: 'before-release' });
      const rs = await castle.rooms.appendRecord(room.slug, { ...entry(long(260)), date: daysAgo(200) });
      const kk = await castle.keep.append('core', entry(long(240)));
      const fake = fakeLlm({ rewrite: (task) => ({ items: [...task.user.matchAll(/key:(\w+)/g)].map((m) => ({ key: m[1], facts: ['甲事', '乙事'] })) }) });

      const job = await runPatrol(castle, fake.service);
      const splits = ofKind(job, 'recordSplit');
      const splitOf = (id: string) => splits.find((p) => (p.payload as { recordId: string }).recordId === id);
      expect(splitOf(rr.id)?.tier).toBe('green');
      expect(splitOf(kk.id)?.tier).toBe('yellow');
      expect(splitOf(rs.id)).toBeUndefined();

      await applyPatrolJob(castle, job.id, []);
      const records = (await castle.rooms.get(room.slug))!.records;
      expect(records.map((r) => r.id)).not.toContain(rr.id);
      expect(records.filter((r) => r.fact === '甲事' || r.fact === '乙事')).toMatchObject([
        { date: rr.date, source: rr.source, routeWarning: 'before-release' },
        { date: rr.date, source: rr.source, routeWarning: 'before-release' },
      ]);
      expect((await castle.keep.get(kk.id))?.fact).toBe(long(240)); // yellow, unapproved
    });
  });

  describe('§4 step 2: the gate is re-applied and conf is at most med', () => {
    it('a distilled fact that fails the gate is not written; when every fact fails, the entries are archived', async () => {
      const room = await castle.rooms.append({ name: 'Src', locus: ['src/**'] });
      const a = await castle.chronicle.append(entry('A'));
      const b = await castle.chronicle.append(entry('B'));
      const c = await castle.chronicle.append(entry('C'));
      const d = await castle.chronicle.append(entry('D'));
      const fake = fakeLlm({
        cluster: () => ({ clusters: [clusterTo(room.slug, [a.id, b.id]), clusterTo(room.slug, [c.id, d.id])], orphans: [] }),
        distill: (task) =>
          task.user.includes(a.id)
            ? {
                records: [
                  { fact: '值得記的事', confidence: 'high', tags: [], passesGate: true },
                  { fact: '看 README 就知道的事', confidence: 'med', tags: [], passesGate: false },
                ],
              }
            : { records: [{ fact: '不值得記', confidence: 'med', tags: [], passesGate: false }] },
      });

      const job = await runPatrol(castle, fake.service);
      const [p] = ofKind(job, 'roomRecord');
      expect((p.payload as RoomRecordPayload).records).toEqual([{ fact: '值得記的事', confidence: 'med', tags: [] }]); // high → med: the app never verified it
      expect(ofKind(job, 'chronicleSweep').map((s) => s.payload)).toEqual([{ entryIds: [c.id, d.id], reason: 'gate' }]);

      await applyPatrolJob(castle, job.id, []);
      expect((await castle.rooms.get(room.slug))!.records.map((r) => r.fact)).toEqual(['值得記的事']);
      expect(await castle.chronicle.list()).toEqual([]);
    });
  });

  describe('provenance', () => {
    it('distilled records cite chronicle:<ids> and carry the newest entry date; the sweep records promotedTo', async () => {
      const room = await castle.rooms.append({ name: 'Src', locus: ['src/**'] });
      const a = await castle.chronicle.append({ ...entry('A'), date: daysAgo(9) });
      const b = await castle.chronicle.append({ ...entry('B'), date: daysAgo(4) });
      const fake = fakeLlm({
        cluster: () => ({ clusters: [clusterTo(room.slug, [a.id, b.id])], orphans: [] }),
        distill: () => ({ records: [{ fact: 'AB', confidence: 'med', tags: [] }] }),
      });
      const job = await runPatrol(castle, fake.service);
      await applyPatrolJob(castle, job.id, []);

      const [record] = (await castle.rooms.get(room.slug))!.records;
      expect(record).toMatchObject({ source: `chronicle:${a.id},${b.id}`, date: b.date, fact: 'AB' });
      expect(record.verifiedAt).toBeUndefined(); // F9: the app's patrol never re-verifies, and never stamps today as the date
      const archived = await archivedChronicle(castle);
      expect(archived.map((e) => [e.id, e.promotedTo])).toEqual(expect.arrayContaining([[a.id, room.slug], [b.id, room.slug]]));
    });

    it('an approved roomCreate builds the room, puts it on a patrol route without all-rooms, and sweeps with the new slug', async () => {
      await castle.routes.update('patrol', { stops: [{ target: 'chronicle', read: 'all' }] });
      const es = [];
      for (const f of ['甲', '乙', '丙']) es.push(await castle.chronicle.append({ ...entry(f), date: daysAgo(2) }));
      const ids = es.map((e) => e.id);
      const fake = fakeLlm({
        cluster: () => ({
          clusters: [{ entryIds: ids, locus: 'deploy', topic: '部署', targetRoomSlug: '', newRoomName: 'Deploy Corridor', newRoomLocus: ['scripts/deploy/**'], newRoomAdjacent: [] }],
          orphans: [],
        }),
        distill: () => ({ records: [{ fact: '部署先跑 migration', confidence: 'med', tags: [] }] }),
      });
      const job = await runPatrol(castle, fake.service);
      const [create] = ofKind(job, 'roomCreate');
      expect(create.tier).toBe('yellow');

      await applyPatrolJob(castle, job.id, [create.id]);
      const room = (await castle.rooms.list()).find((r) => r.name === 'Deploy Corridor')!;
      expect(room.locus).toEqual(['scripts/deploy/**']);
      expect(room.records).toMatchObject([{ fact: '部署先跑 migration', source: `chronicle:${ids.join(',')}`, date: es[2].date }]);
      expect((await castle.routes.get('patrol'))!.stops).toContainEqual({ target: `room:${room.slug}`, read: 'all' });
      expect((await archivedChronicle(castle)).map((e) => e.promotedTo)).toEqual([room.slug, room.slug, room.slug]);
    });

    it('keep promotion carries date and routeWarning and sweeps the entry with promotedTo keep', async () => {
      const c = await castle.chronicle.append({ ...entry('核心規則'), date: daysAgo(3), routeWarning: 'before-release' });
      const fake = fakeLlm({ promotion: () => ({ promotions: [{ recordId: c.id, section: 'constraints', reason: '每次都要' }] }) });
      const job = await runPatrol(castle, fake.service);
      const [promo] = ofKind(job, 'keepPromotion');

      await applyPatrolJob(castle, job.id, [promo.id]);
      const [kept] = await castle.keep.list('constraints');
      expect(kept).toMatchObject({ fact: '核心規則', date: c.date, routeWarning: 'before-release', source: 'session' });
      expect((await archivedChronicle(castle)).find((e) => e.id === c.id)?.promotedTo).toBe('keep');
    });

    it('promoting an entry another proposal already swept reports not_found and is not listed as applied', async () => {
      const room = await castle.rooms.append({ name: 'Src', locus: ['src/**'] });
      const a = await castle.chronicle.append(entry('A'));
      const b = await castle.chronicle.append(entry('B'));
      const fake = fakeLlm({
        cluster: () => ({ clusters: [clusterTo(room.slug, [a.id, b.id])], orphans: [] }),
        distill: () => ({ records: [{ fact: 'AB', confidence: 'med', tags: [] }] }),
        promotion: () => ({ promotions: [{ recordId: a.id, section: 'core', reason: '常用' }] }),
      });
      const job = await runPatrol(castle, fake.service);
      const [promo] = ofKind(job, 'keepPromotion');

      const applied = await applyPatrolJob(castle, job.id, [promo.id]);
      expect(applied.applyReport?.failed).toEqual([{ id: promo.id, reason: 'not_found' }]);
      expect(applied.applyReport?.appliedIds).not.toContain(promo.id);
      expect(await castle.keep.list()).toEqual([]);
    });
  });

  it('§4 step 3: approved contradictions archive a room loser with a superseded note and sweep a chronicle loser — before the distill that would have used it', async () => {
    const room = await castle.rooms.append({ name: 'Src', locus: ['src/**'] });
    const oldRec = await castle.rooms.appendRecord(room.slug, { ...entry('舊說法'), confidence: 'high' });
    const newRec = await castle.rooms.appendRecord(room.slug, { ...entry('新說法'), confidence: 'high' });
    const stale = await castle.chronicle.append(entry('過時條目'));
    const other = await castle.chronicle.append(entry('同批條目'));
    const fake = fakeLlm({
      cluster: () => ({ clusters: [clusterTo(room.slug, [stale.id, other.id])], orphans: [] }),
      distill: () => ({ records: [{ fact: '依過時條目整併的事', confidence: 'med', tags: [], passesGate: true }] }),
      contradiction: () => ({
        contradictions: [
          { loserId: oldRec.id, winnerId: newRec.id, reason: '新版取代' },
          { loserId: stale.id, winnerId: newRec.id, reason: '條目已過時' }, // valid: the entry is checked in its target room's unit
        ],
      }),
    });
    const job = await runPatrol(castle, fake.service);
    const contradictions = ofKind(job, 'contradiction');
    expect(contradictions).toHaveLength(2);
    expect(job.proposals.slice(0, 2).map((p) => p.kind)).toEqual(['contradiction', 'contradiction']); // applied first
    const [distill] = ofKind(job, 'roomRecord');

    const applied = await applyPatrolJob(castle, job.id, contradictions.map((p) => p.id));
    expect(applied.applyReport?.failed).toEqual([{ id: distill.id, reason: 'not_found' }]); // its entry lost the contradiction
    expect((await castle.rooms.get(room.slug))!.records.map((r) => r.id)).toEqual([newRec.id]);
    expect(await archivedRecords(castle)).toMatchObject([{ id: oldRec.id, archiveNote: `superseded by ${newRec.id}: 新版取代` }]);
    expect((await archivedChronicle(castle)).map((e) => e.id)).toEqual([stale.id]);
    expect((await castle.chronicle.list()).map((e) => e.id)).toEqual([other.id]); // waits for the next patrol
  });

  describe('incremental (default) vs full', () => {
    async function seed() {
      await castle.markPatrolled(new Date(Date.now() - 10 * 86_400_000));
      const roomOld = await castle.rooms.append({ name: 'Old', locus: ['old/**'] });
      const roomNew = await castle.rooms.append({ name: 'New', locus: ['new/**'] });
      const oldA = await castle.rooms.appendRecord(roomOld.slug, { ...entry('舊房舊事'), confidence: 'high', date: daysAgo(20) });
      const oldB = await castle.rooms.appendRecord(roomNew.slug, { ...entry('新房舊事'), confidence: 'high', date: daysAgo(20) });
      const fresh = await castle.rooms.appendRecord(roomNew.slug, { ...entry('新房新事'), confidence: 'high', date: daysAgo(2) });
      const keepRec = await castle.keep.append('core', { ...entry('keep 事實'), confidence: 'high', date: daysAgo(20) });
      const c1 = await castle.chronicle.append(entry('編年史條目'));
      return { roomOld, roomNew, oldA, oldB, fresh, keepRec, c1 };
    }

    it('default: contradictions cover only rooms holding new records (keep via the shared context); promotion = new room records + chronicle', async () => {
      const s = await seed();
      const fake = fakeLlm();
      const job = await runPatrol(castle, fake.service);
      expect(job.mode).toBe('incremental');

      const [check] = fake.of('contradiction');
      expect(fake.of('contradiction')).toHaveLength(1);
      expect(check.task.context).toContain(s.keepRec.id);
      expect(check.task.user).toMatch(new RegExp(`id:${s.fresh.id}[^\\n]*\\[new\\]`));
      expect(check.task.user).toContain(s.oldB.id); // same room: the comparison base
      expect(check.task.user).not.toMatch(new RegExp(`id:${s.oldB.id}[^\\n]*\\[new\\]`));
      expect(check.task.user).not.toContain(s.oldA.id); // nothing new in that room
      const [promo] = fake.of('promotion');
      expect(promo.task.user).toContain(s.fresh.id);
      expect(promo.task.user).toContain(s.c1.id);
      expect(promo.task.user).not.toContain(s.oldA.id);
      expect(promo.task.user).not.toContain(s.oldB.id);
      expect(job.stats.llmCalls).toBe(fake.calls.length);
    });

    it('full: true restores the whole-castle pass', async () => {
      const s = await seed();
      const fake = fakeLlm();
      const job = await runPatrol(castle, fake.service, { full: true });
      expect(job.mode).toBe('full');

      const [check] = fake.of('contradiction');
      expect(fake.of('contradiction')).toHaveLength(1);
      for (const r of [s.oldA, s.oldB, s.fresh]) expect(check.task.user).toContain(r.id);
      expect(check.task.user).not.toContain('[new]');
      for (const r of [s.oldA, s.oldB, s.fresh, s.c1]) expect(fake.of('promotion')[0].task.user).toContain(r.id);
    });

    it('default: the entries this patrol distills are contradiction-checked in their target room', async () => {
      const s = await seed();
      const a = await castle.chronicle.append(entry('A'));
      const fake = fakeLlm({
        cluster: () => ({ clusters: [clusterTo(s.roomOld.slug, [s.c1.id, a.id])], orphans: [] }),
        distill: () => ({ records: [{ fact: 'A 與條目', confidence: 'med', tags: [] }] }),
      });
      await runPatrol(castle, fake.service);
      const users = fake.of('contradiction').map((c) => c.task.user).join('\n');
      expect(users).toMatch(new RegExp(`id:${a.id}[^\\n]*\\[new\\]`));
      expect(users).toContain(s.oldA.id); // the target room's records are the base
    });

    it('nothing new since the last patrol → no contradiction call at all', async () => {
      await castle.markPatrolled(new Date(Date.now() - 10 * 86_400_000));
      const room = await castle.rooms.append({ name: 'Old', locus: ['old/**'] });
      await castle.rooms.appendRecord(room.slug, { ...entry('舊事'), confidence: 'high', date: daysAgo(20) });
      await castle.keep.append('core', { ...entry('keep'), confidence: 'high', date: daysAgo(20) });
      const fake = fakeLlm();
      await runPatrol(castle, fake.service);
      expect(fake.of('contradiction')).toEqual([]);
      expect(fake.of('promotion')).toEqual([]);
    });
  });

  describe('call count and latency', () => {
    it('one cluster call also names the room (no per-cluster room call); distills run in parallel, at most 3 at a time', async () => {
      const room = await castle.rooms.append({ name: 'Src', locus: ['src/**'] });
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) ids.push((await castle.chronicle.append(entry(`e${i}`))).id);
      let inFlight = 0;
      let maxInFlight = 0;
      const fake = fakeLlm({
        cluster: () => ({ clusters: [0, 2, 4, 6, 8].map((i) => clusterTo(room.slug, [ids[i], ids[i + 1]])), orphans: [] }),
        distill: async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 20));
          inFlight--;
          return { records: [{ fact: '整併', confidence: 'med', tags: [] }] };
        },
      });

      const job = await runPatrol(castle, fake.service);
      expect(maxInFlight).toBe(3);
      expect(fake.of('cluster')).toHaveLength(1);
      expect(fake.of('distill')).toHaveLength(5);
      expect(new Set(fake.calls.map((c) => c.kind))).toEqual(new Set(['cluster', 'distill', 'contradiction', 'promotion']));
      expect(ofKind(job, 'roomRecord')).toHaveLength(5);
    });

    it('a cluster with no room and fewer than 3 entries is never distilled', async () => {
      const a = await castle.chronicle.append(entry('A'));
      const b = await castle.chronicle.append(entry('B'));
      const fake = fakeLlm({ cluster: () => ({ clusters: [{ ...toRoom(''), entryIds: [a.id, b.id], locus: 'x', topic: 'x' }], orphans: [] }) });
      await runPatrol(castle, fake.service);
      expect(fake.of('distill')).toEqual([]);
    });
  });
});

describe('remember v0.5', () => {
  let dir: string;
  let castle: Castle;

  beforeEach(async () => {
    dir = await makeTempDir();
    await initCastle(dir);
    castle = await openCastle(dir);
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('makes exactly ONE LLM call, whose prompt carries the cap and the top 5 keyword hits', async () => {
    const hits: string[] = [];
    for (let i = 0; i < 6; i++) hits.push((await castle.chronicle.append(entry(`codegen 型別第${i}條`))).id);
    const unrelated = await castle.keep.append('core', entry('完全無關的部署事項'));
    const fake = fakeLlm({ remember: () => ({ ...(EMPTY.remember as object), fact: 'build 前先跑 codegen' }) });

    const result = await rememberFlow(castle, fake.service, { text: 'build 前必須先跑 codegen，否則會拿到舊型別', source: 'user' });

    expect(result.passed).toBe(true);
    expect(fake.calls).toHaveLength(1);
    const { system, user } = fake.calls[0].task;
    expect(system).toContain('at most 200 characters');
    const hitSection = user.split('Most similar existing castle records')[1];
    expect(hitSection.match(/\[id:/g)).toHaveLength(5);
    expect(hitSection).not.toContain(unrelated.id);
    expect((await castle.chronicle.list()).at(-1)?.fact).toBe('build 前先跑 codegen');
  });

  it('an over-cap distilled fact gets one rewrite; if still over, nothing is written (factTooLong)', async () => {
    const fake = fakeLlm({
      remember: () => ({ ...(EMPTY.remember as object), fact: long(201) }),
      rewrite: () => ({ items: [{ key: 'fact', facts: [long(230)] }] }),
    });
    const result = await rememberFlow(castle, fake.service, { text: '很長的教訓' });
    expect(result).toMatchObject({ passed: false, failedTests: ['factTooLong'] });
    expect(fake.calls.map((c) => c.kind)).toEqual(['remember', 'rewrite']);
    expect(await castle.chronicle.list()).toEqual([]);
  });

  it('a rewrite that fits is written', async () => {
    const fake = fakeLlm({
      remember: () => ({ ...(EMPTY.remember as object), fact: `兩行\n事實` }),
      rewrite: () => ({ items: [{ key: 'fact', facts: ['一行事實'] }] }),
    });
    const result = await rememberFlow(castle, fake.service, { text: '兩行事實' });
    expect(result.passed).toBe(true);
    expect((await castle.chronicle.list()).map((e) => e.fact)).toEqual(['一行事實']);
  });
});
