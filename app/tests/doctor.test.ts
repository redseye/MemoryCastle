import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import {
  initCastle,
  makeChronicleCollection,
  makeKeepCollection,
  makeRoomsCollection,
  makeRoutesCollection,
  runDoctor,
} from '../src/core/index.js';
import { castleJsonPath } from '../src/core/layout.js';
import { readJsonFile, writeJsonFile } from '../src/storage/json-file.js';
import { makeTempDir, cleanupTempDir } from './helpers.js';
import type { CastleMeta } from '../src/core/types.js';
import type { GitInfo } from '../src/core/doctor.js';

const execFileAsync = promisify(execFile);

async function setLastPatrolAt(castleDir: string, date: string) {
  const path = castleJsonPath(castleDir);
  const meta = await readJsonFile<CastleMeta>(path);
  await writeJsonFile(path, { ...meta, lastPatrolAt: date } satisfies CastleMeta);
}

function noGit(): Promise<GitInfo | null> {
  return Promise.resolve(null);
}

function fakeGit(overrides: Partial<GitInfo> = {}): () => Promise<GitInfo | null> {
  return () => Promise.resolve({ lastCommitDate: '2026-01-01', uncommittedPaths: [], ...overrides });
}

describe('runDoctor', () => {
  let dir: string;
  let castleDir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    castleDir = await initCastle(dir);
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('reports overall status ok on a freshly-initialized, in-sync castle with no drift', async () => {
    await setLastPatrolAt(castleDir, new Date().toISOString().slice(0, 10));
    const chronicle = makeChronicleCollection(castleDir);
    await chronicle.append({ confidence: 'high', source: 'user', fact: '交接紀錄 #handover', tags: ['handover'] });

    const report = await runDoctor(dir, { gitFn: fakeGit({ lastCommitDate: '2026-01-01', uncommittedPaths: [] }) });
    expect(report.status).toBe('ok');
    expect(report.root).toBe(dir);
    expect(report.findings.some((f) => f.kind === 'handover-drift' && f.severity === 'ok')).toBe(true);
    expect(report.findings.some((f) => f.kind === 'patrol-due' && f.severity === 'ok')).toBe(true);
  });

  it('flags handover-drift when the last commit is later than the newest chronicle entry', async () => {
    const chronicle = makeChronicleCollection(castleDir);
    await chronicle.update((await chronicle.append({ confidence: 'high', source: 'user', fact: 'old handover #handover', tags: ['handover'] })).id, {
      date: '2026-01-01',
    });

    const report = await runDoctor(dir, { gitFn: fakeGit({ lastCommitDate: '2026-06-15', uncommittedPaths: [] }) });
    const finding = report.findings.find((f) => f.kind === 'handover-drift');
    expect(finding?.severity).toBe('warn');
    expect(finding?.detail).toContain('2026-06-15');
    expect(finding?.detail).toContain('2026-01-01');
    expect(report.status).toBe('warn');
  });

  it('flags uncommitted-drift when git has changes and the newest handover is stale', async () => {
    const chronicle = makeChronicleCollection(castleDir);
    const entry = await chronicle.append({ confidence: 'high', source: 'user', fact: '舊交接 #handover', tags: ['handover'] });
    await chronicle.update(entry.id, { date: '2026-01-01' });

    const report = await runDoctor(dir, {
      now: new Date('2026-06-15T00:00:00Z'),
      gitFn: fakeGit({ lastCommitDate: '2026-01-01', uncommittedPaths: ['src/a.ts', 'src/b.ts'] }),
    });
    const finding = report.findings.find((f) => f.kind === 'uncommitted-drift');
    expect(finding?.severity).toBe('warn');
    expect(finding?.detail).toContain('src/a.ts');
    expect(report.status).toBe('warn');
  });

  it('does not flag uncommitted-drift when the newest handover is from today', async () => {
    const today = new Date('2026-06-15T00:00:00Z').toISOString().slice(0, 10);
    const chronicle = makeChronicleCollection(castleDir);
    const entry = await chronicle.append({ confidence: 'high', source: 'user', fact: '今日交接 #handover', tags: ['handover'] });
    await chronicle.update(entry.id, { date: today });

    const report = await runDoctor(dir, {
      now: new Date('2026-06-15T00:00:00Z'),
      gitFn: fakeGit({ lastCommitDate: today, uncommittedPaths: ['src/a.ts'] }),
    });
    expect(report.findings.some((f) => f.kind === 'uncommitted-drift')).toBe(false);
  });

  it('flags patrol-due when the patrol budget/day thresholds are exceeded', async () => {
    await setLastPatrolAt(castleDir, '2026-01-01');
    const report = await runDoctor(dir, { now: new Date('2026-07-06T00:00:00Z'), gitFn: noGit });
    const finding = report.findings.find((f) => f.kind === 'patrol-due');
    expect(finding?.severity).toBe('warn');
    expect(report.status).toBe('warn');
  });

  it('patrol-due counts only chronicle entries after lastPatrolAt (v0.5.1)', async () => {
    await setLastPatrolAt(castleDir, '2026-07-01');
    const chronicle = makeChronicleCollection(castleDir);
    for (let i = 0; i < 20; i++) await chronicle.append({ date: '2026-06-30', confidence: 'high', source: 'user', fact: `舊${i}` });
    const now = new Date('2026-07-06T00:00:00Z');
    let report = await runDoctor(dir, { now, gitFn: noGit });
    expect(report.findings.find((f) => f.kind === 'patrol-due')?.severity).toBe('ok');

    for (let i = 0; i < 20; i++) await chronicle.append({ date: '2026-07-02', confidence: 'high', source: 'user', fact: `新${i}` });
    report = await runDoctor(dir, { now, gitFn: noGit });
    expect(report.findings.filter((f) => f.kind === 'patrol-due').map((f) => f.detail)).toEqual(['巡查到期：chronicle 未整理 20 筆 ≥ 20']);
  }, 30000);

  it('flags locus-orphan for a path-like locus matching zero files, and skips free-text loci', async () => {
    const rooms = makeRoomsCollection(castleDir);
    await rooms.append({ name: 'Orphan Room', locus: ['nonexistent/**', '部署活動'] });

    const report = await runDoctor(dir, { gitFn: noGit });
    const orphan = report.findings.find((f) => f.kind === 'locus-orphan');
    expect(orphan?.severity).toBe('warn');
    expect(orphan?.target).toContain('nonexistent/**');
    expect(report.findings.some((f) => f.kind === 'locus-orphan' && f.target.includes('部署活動'))).toBe(false);
  });

  it('does not flag locus-orphan when the path-like locus matches a real file', async () => {
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'index.ts'), '// x');
    const rooms = makeRoomsCollection(castleDir);
    await rooms.append({ name: 'Src Room', locus: ['src/**'] });

    const report = await runDoctor(dir, { gitFn: noGit });
    expect(report.findings.some((f) => f.kind === 'locus-orphan')).toBe(false);
  });

  it('flags route-gap when a route stop names a missing room', async () => {
    const routes = makeRoutesCollection(castleDir);
    await routes.append({ name: 'custom', occasion: 'test', stops: [{ target: 'room:no-such-room', read: 'all' }] });

    const report = await runDoctor(dir, { gitFn: noGit });
    const gap = report.findings.find((f) => f.kind === 'route-gap' && f.detail.includes('no-such-room'));
    expect(gap?.severity).toBe('warn');
    expect(report.status).toBe('warn');
  });

  it('flags route-gap for a room reachable by no route when no route has an all-rooms stop', async () => {
    const rooms = makeRoomsCollection(castleDir);
    const room = await rooms.append({ name: 'Unreachable Room' });
    const routes = makeRoutesCollection(castleDir);
    // Replace the default routes (whose "patrol" route has an all-rooms stop)
    // with one that has no all-rooms coverage.
    for (const r of await routes.list()) {
      await routes.remove(r.name);
    }
    await routes.append({ name: 'no-coverage', occasion: 'test', stops: [{ target: 'keep', read: 'all' }] });

    const report = await runDoctor(dir, { gitFn: noGit });
    const gap = report.findings.find((f) => f.kind === 'route-gap' && f.target === room.slug);
    expect(gap?.severity).toBe('warn');
  });

  it('flags oversize-record for a fact over factMaxChars and for a multiline fact; 200 chars is fine', async () => {
    const rooms = makeRoomsCollection(castleDir);
    const room = await rooms.append({ name: 'Big Facts', locus: ['src/**'] });
    const long = await rooms.appendRecord(room.slug, { confidence: 'high', source: 'user', fact: '字'.repeat(201) });
    const exact = await rooms.appendRecord(room.slug, { confidence: 'high', source: 'user', fact: '字'.repeat(200) });
    const chronicle = makeChronicleCollection(castleDir);
    const multi = await chronicle.append({ confidence: 'high', source: 'user', fact: '一\n二' });

    const report = await runDoctor(dir, { gitFn: noGit });
    const targets = report.findings.filter((f) => f.kind === 'oversize-record').map((f) => f.target);
    expect(targets).toContain(`room:${room.slug}:${long.id}`);
    expect(targets).toContain(`chronicle:${multi.id}`);
    expect(targets).not.toContain(`room:${room.slug}:${exact.id}`);
    expect(report.status).toBe('warn');
  });

  it('counts stale-records per contract C3 (user directives exempt, verifiedAt resets age)', async () => {
    const keep = makeKeepCollection(castleDir);
    await keep.append('core', { date: '2026-01-01', confidence: 'high', source: 'session', fact: '舊觀察' });
    await keep.append('core', { date: '2026-01-01', confidence: 'high', source: 'user', fact: '使用者指示' });
    await keep.append('core', { date: '2026-01-01', confidence: 'high', source: 'session', fact: '已複驗', verifiedAt: '2026-06-01' });
    const rooms = makeRoomsCollection(castleDir);
    const room = await rooms.append({ name: 'R', locus: ['src/**'] });
    await rooms.appendRecord(room.slug, { date: '2026-06-30', confidence: 'low', source: 'user', fact: '推測' });

    const report = await runDoctor(dir, { now: new Date('2026-07-06T00:00:00Z'), gitFn: noGit });
    const stale = report.findings.filter((f) => f.kind === 'stale-records');
    expect(stale).toHaveLength(1);
    expect(stale[0].detail).toMatch(/^2 筆/);
    expect(stale[0].detail).toContain('keep 1、房間 1');
  });

  it('reports no stale-records finding when nothing is stale', async () => {
    const report = await runDoctor(dir, { gitFn: noGit });
    expect(report.findings.some((f) => f.kind === 'stale-records')).toBe(false);
  });

  it('flags locus-unreachable for a room with no path-like locus unless a non-patrol route stops at it', async () => {
    const rooms = makeRoomsCollection(castleDir);
    const topic = await rooms.append({ name: 'Topic Room', locus: ['部署活動', 'scripts'] });
    const pinned = await rooms.append({ name: 'Pinned Room', locus: ['發布流程'] });
    const pathRoom = await rooms.append({ name: 'Path Room', locus: ['README.md'] });
    const routes = makeRoutesCollection(castleDir);
    await routes.update('before-release', {
      stops: [
        { target: 'keep', read: 'section:constraints' },
        { target: `room:${pinned.slug}`, read: 'route-warnings' },
      ],
    });
    // A patrol-only explicit stop does not count as reachable.
    await routes.update('patrol', { stops: [...(await routes.get('patrol'))!.stops, { target: `room:${topic.slug}`, read: 'all' }] });

    const report = await runDoctor(dir, { gitFn: noGit });
    const unreachable = report.findings.filter((f) => f.kind === 'locus-unreachable').map((f) => f.target);
    expect(unreachable).toEqual([topic.slug]);
    expect(unreachable).not.toContain(pinned.slug);
    expect(unreachable).not.toContain(pathRoom.slug);
  });

  it('flags route-target-invalid and route-read-invalid as errors (C5 whitelist)', async () => {
    const routes = makeRoutesCollection(castleDir);
    await routes.append({
      name: 'broken',
      occasion: 'test',
      stops: [
        { target: 'basement', read: 'all' },
        { target: 'keep', read: 'everything' },
        { target: 'chronicle', read: 'due' },
        { target: 'patrol-check', read: 'due' },
        { target: 'chronicle', read: 'last-handover' },
      ],
    });

    const report = await runDoctor(dir, { gitFn: noGit });
    const target = report.findings.filter((f) => f.kind === 'route-target-invalid');
    const read = report.findings.filter((f) => f.kind === 'route-read-invalid');
    expect(target.map((f) => f.target)).toEqual(['broken -> basement']);
    expect(read.map((f) => f.target)).toEqual(['broken -> keep', 'broken -> chronicle']);
    expect(read[0].detail).toContain('everything');
    expect(read[1].detail).toContain('due');
    expect([...target, ...read].every((f) => f.severity === 'error')).toBe(true);
    expect(report.status).toBe('error');
  });

  it('route-outdated: a pre-v0.5 session-start route and a castle.json without factMaxChars, each with the migrate hint', async () => {
    const routes = makeRoutesCollection(castleDir);
    await routes.update('session-start', {
      stops: [
        { target: 'keep', read: 'all' },
        { target: 'rooms-by-locus', read: 'all' },
      ],
    });
    const metaPath = castleJsonPath(castleDir);
    const raw = await readJsonFile<CastleMeta & { budgets: Record<string, number> }>(metaPath);
    delete raw.budgets.factMaxChars;
    await writeJsonFile(metaPath, raw);

    const report = await runDoctor(dir, { gitFn: noGit });
    const outdated = report.findings.filter((f) => f.kind === 'route-outdated');
    expect(outdated.map((f) => [f.target, f.severity])).toEqual([
      ['session-start', 'warn'],
      ['castle.json', 'warn'],
    ]);
    expect(outdated[0].detail).toContain('patrol-check/due、chronicle/last-handover');
    for (const f of outdated) {
      expect(f.detail).toContain('run node <mc-root>/scripts/castle.mjs migrate ／ ');
    }
    expect(report.status).toBe('warn');
  });

  it('route-outdated names only the missing stop, and is silent for a v0.5 castle or one with no session-start route', async () => {
    const routes = makeRoutesCollection(castleDir);
    let report = await runDoctor(dir, { gitFn: noGit });
    expect(report.findings.some((f) => f.kind === 'route-outdated')).toBe(false); // fresh init is v0.5

    await routes.update('session-start', {
      stops: [
        { target: 'patrol-check', read: 'due' },
        { target: 'keep', read: 'all' },
      ],
    });
    report = await runDoctor(dir, { gitFn: noGit });
    expect(report.findings.filter((f) => f.kind === 'route-outdated').map((f) => f.detail)).toEqual([
      'session-start 路線缺少 v0.5 站點：chronicle/last-handover；run node <mc-root>/scripts/castle.mjs migrate ／ 請執行 node <mc-root>/scripts/castle.mjs migrate',
    ]);

    await routes.remove('session-start'); // migrate never creates a route, so there is nothing to hint at
    report = await runDoctor(dir, { gitFn: noGit });
    expect(report.findings.some((f) => f.kind === 'route-outdated')).toBe(false);
  });

  it('the default init routes pass the whitelist', async () => {
    const report = await runDoctor(dir, { gitFn: noGit });
    expect(report.findings.some((f) => f.kind === 'route-target-invalid' || f.kind === 'route-read-invalid')).toBe(false);
  });

  it('flags route-warning-invalid for a ⚠ marker naming a missing route', async () => {
    const keep = makeKeepCollection(castleDir);
    const bad = await keep.append('constraints', { confidence: 'high', source: 'user', fact: 'x', routeWarning: 'ship-it' });
    await keep.append('constraints', { confidence: 'high', source: 'user', fact: 'y', routeWarning: 'before-release' });

    const report = await runDoctor(dir, { gitFn: noGit });
    const findings = report.findings.filter((f) => f.kind === 'route-warning-invalid');
    expect(findings.map((f) => f.target)).toEqual([`keep:${bad.id}`]);
  });

  it('flags keep and every room over budget, and patrol-due lists every fired reason', async () => {
    const metaPath = castleJsonPath(castleDir);
    const meta = await readJsonFile<CastleMeta>(metaPath);
    await writeJsonFile(metaPath, { ...meta, budgets: { ...meta.budgets, keepMax: 1, roomMax: 1 } });
    const keep = makeKeepCollection(castleDir);
    await keep.append('core', { confidence: 'high', source: 'user', fact: 'k1' });
    await keep.append('core', { confidence: 'high', source: 'user', fact: 'k2' });
    const rooms = makeRoomsCollection(castleDir);
    for (const name of ['Room A', 'Room B']) {
      const room = await rooms.append({ name, locus: ['src/**'] });
      await rooms.appendRecord(room.slug, { confidence: 'high', source: 'user', fact: 'r1' });
      await rooms.appendRecord(room.slug, { confidence: 'high', source: 'user', fact: 'r2' });
    }

    const report = await runDoctor(dir, { gitFn: noGit });
    expect(report.findings.filter((f) => f.kind === 'over-budget').map((f) => f.target)).toEqual(['keep', 'room:room-a', 'room:room-b']);
    const due = report.findings.filter((f) => f.kind === 'patrol-due').map((f) => f.detail);
    expect(due).toEqual(['巡查到期：room:room-a 2 筆 > 1', '巡查到期：room:room-b 2 筆 > 1', '巡查到期：keep 2 筆 > 1']);
  });

  it('reports a single info finding and no drift findings when git is unavailable', async () => {
    const report = await runDoctor(dir, { gitFn: noGit });
    const gitFindings = report.findings.filter((f) => f.kind === 'git');
    expect(gitFindings).toHaveLength(1);
    expect(gitFindings[0].severity).toBe('info');
    expect(report.findings.some((f) => f.kind === 'handover-drift' || f.kind === 'uncommitted-drift')).toBe(false);
  });

  it('never writes anything under .claude/castle (read-only)', async () => {
    const before = await readJsonFile<CastleMeta>(castleJsonPath(castleDir));
    await runDoctor(dir, { gitFn: fakeGit({ lastCommitDate: '2026-01-01', uncommittedPaths: ['x.ts'] }) });
    const after = await readJsonFile<CastleMeta>(castleJsonPath(castleDir));
    expect(after).toEqual(before);
  });

  it('uses real git against a temp `git init` repo when git is on PATH, else skips cleanly', async () => {
    let gitAvailable = true;
    try {
      await execFileAsync('git', ['--version']);
    } catch {
      gitAvailable = false;
    }
    if (!gitAvailable) {
      // No git on PATH in this environment — nothing to verify here.
      expect(true).toBe(true);
      return;
    }

    await execFileAsync('git', ['init'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await writeFile(join(dir, 'README.md'), 'hello');
    await execFileAsync('git', ['add', '.'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: dir });
    await writeFile(join(dir, 'README.md'), 'hello again');

    // No gitFn override here: exercises the real execFile-based probe.
    const report = await runDoctor(dir);
    expect(report.findings.some((f) => f.kind === 'git')).toBe(false);
    const uncommitted = report.findings.find((f) => f.kind === 'uncommitted-drift');
    // No chronicle entries exist yet in this temp castle, so newestHandover
    // is undefined -> stale -> the finding should fire.
    expect(uncommitted?.severity).toBe('warn');
    expect(uncommitted?.detail).toContain('README.md');
  });
});
