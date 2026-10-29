// Castle doctor: deterministic, LLM-free drift detection. One computation
// shared by three outlets (CLI `doctor`, GET /projects/:id/doctor, and the
// Web UI health-check page) so a castle that has silently fallen behind the
// code — no handover in a while, uncommitted work, a stale route/locus — is
// always caught the same way. No judgment calls here (per the framework's
// deterministic/judgment split): every finding is derived mechanically from
// files already on disk plus `git`.
//
// Probes (git, current time) are injectable via DoctorOverrides so the whole
// report stays pure/unit-testable without a real git repo — mirrors
// CliOverrides in src/llm/cli.ts.
//
// v0.5 token checks: records over the fact cap or multiline, stale records
// (contract C3), keep/rooms over budget, rooms no path can reach (C7), and
// route stops / ⚠ markers outside the C5 whitelist.

import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readJsonFile } from '../storage/json-file.js';
import { isStale } from './budgets.js';
import { openCastle } from './castle.js';
import { daysBetween, localDate } from './ids.js';
import { castleJsonPath } from './layout.js';
import { isPathLikeLocus, matchesLocus } from './locus.js';
import { isHandoverEntry } from './record-ops.js';
import type { BudgetCounts, Budgets, CastleMeta, CastleRecord, PatrolDueResult, RoomFile, RouteDef } from './types.js';
import { invalidStopReason, patrolTriggerLine } from './walk.js';

const execFileAsync = promisify(execFile);

export type DoctorFindingKind =
  | 'handover-drift'
  | 'uncommitted-drift'
  | 'patrol-due'
  | 'locus-orphan'
  | 'locus-unreachable'
  | 'route-gap'
  | 'route-outdated'
  | 'route-target-invalid'
  | 'route-read-invalid'
  | 'route-warning-invalid'
  | 'over-budget'
  | 'oversize-record'
  | 'stale-records'
  | 'git';

export type DoctorSeverity = 'ok' | 'info' | 'warn' | 'error';

export interface DoctorFinding {
  kind: DoctorFindingKind;
  severity: DoctorSeverity;
  target: string;
  detail: string;
}

export interface DoctorReport {
  checkedAt: string;
  root: string;
  status: 'ok' | 'warn' | 'error';
  findings: DoctorFinding[];
}

export interface GitInfo {
  lastCommitDate: string; // YYYY-MM-DD, in the commit's own recorded timezone
  uncommittedPaths: string[];
}

export type GitProbeFn = (root: string) => Promise<GitInfo | null>;

export interface DoctorOverrides {
  gitFn?: GitProbeFn;
  now?: Date;
}

const GIT_TIMEOUT_MS = 5000;

// Real git probe. Returns null (never throws) whenever git can't answer —
// binary missing, root isn't a repository, or a repository with zero commits
// yet — so the caller always has a clean "unavailable" signal to fall back to.
async function realGitProbe(root: string): Promise<GitInfo | null> {
  try {
    const [logResult, statusResult] = await Promise.all([
      execFileAsync('git', ['log', '-1', '--format=%cI'], { cwd: root, windowsHide: true, timeout: GIT_TIMEOUT_MS }),
      execFileAsync('git', ['status', '--porcelain'], { cwd: root, windowsHide: true, timeout: GIT_TIMEOUT_MS }),
    ]);
    const iso = logResult.stdout.trim();
    if (!iso) return null;
    const uncommittedPaths = statusResult.stdout
      .split(/\r?\n/)
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
    return { lastCommitDate: iso.slice(0, 10), uncommittedPaths };
  } catch {
    return null;
  }
}

// Directories that are never project content for the locus-orphan file walk.
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-electron',
  'release',
  'coverage',
  '.vite',
  '.next',
  '.turbo',
  '.cache',
]);

async function walkProjectFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        out.push(relPath);
      }
    }
  }
  await walk(root, '');
  return out;
}

// A live record plus where it lives, as a doctor target prefix:
// 'keep' | 'chronicle' | 'room:<slug>'.
interface LocatedRecord {
  where: string;
  record: CastleRecord;
}

function newestDate(entries: CastleRecord[]): string | undefined {
  return entries.reduce<string | undefined>((max, e) => (max === undefined || e.date > max ? e.date : max), undefined);
}

function checkHandoverDrift(gitInfo: GitInfo, chronicle: CastleRecord[]): DoctorFinding[] {
  const newestChronicleDate = newestDate(chronicle);
  if (!newestChronicleDate) return [];
  if (gitInfo.lastCommitDate <= newestChronicleDate) {
    return [
      {
        kind: 'handover-drift',
        severity: 'ok',
        target: 'chronicle',
        detail: `最後 commit（${gitInfo.lastCommitDate}）未晚於最新 chronicle 記錄（${newestChronicleDate}），未偵測到落後。`,
      },
    ];
  }
  const days = daysBetween(newestChronicleDate, new Date(`${gitInfo.lastCommitDate}T00:00:00Z`));
  return [
    {
      kind: 'handover-drift',
      severity: 'warn',
      target: 'chronicle',
      detail: `最後一次 commit（${gitInfo.lastCommitDate}）晚於最新 chronicle 記錄（${newestChronicleDate}），相差 ${days} 天，城堡記錄可能已落後於程式碼。`,
    },
  ];
}

function checkUncommittedDrift(gitInfo: GitInfo, chronicle: CastleRecord[], today: string): DoctorFinding[] {
  if (gitInfo.uncommittedPaths.length === 0) return [];
  const newestHandover = newestDate(chronicle.filter(isHandoverEntry));
  const stale = newestHandover === undefined || newestHandover < today;
  if (!stale) return [];
  const shown = gitInfo.uncommittedPaths.slice(0, 5);
  const more = gitInfo.uncommittedPaths.length > shown.length ? ` 等共 ${gitInfo.uncommittedPaths.length} 項` : '';
  return [
    {
      kind: 'uncommitted-drift',
      severity: 'warn',
      target: 'git',
      detail: `有未提交的變更，但最新 handover 記錄（${newestHandover ?? '無'}）已過期：${shown.join('、')}${more}`,
    },
  ];
}

function checkPatrolDue(result: PatrolDueResult): DoctorFinding[] {
  if (!result.due) {
    return [{ kind: 'patrol-due', severity: 'ok', target: 'patrol', detail: '巡查未逾預算或天數門檻。' }];
  }
  return result.triggers.map((t) => ({ kind: 'patrol-due', severity: 'warn', target: 'patrol', detail: patrolTriggerLine(t) }));
}

function checkOverBudget(counts: BudgetCounts, budgets: Budgets): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  if (counts.keepCount > budgets.keepMax) {
    findings.push({
      kind: 'over-budget',
      severity: 'warn',
      target: 'keep',
      detail: `keep 有 ${counts.keepCount} 筆，超過上限 ${budgets.keepMax}（每次 session 都會載入）。`,
    });
  }
  for (const room of counts.rooms) {
    if (room.count > budgets.roomMax) {
      findings.push({
        kind: 'over-budget',
        severity: 'warn',
        target: `room:${room.slug}`,
        detail: `房間 ${room.slug} 有 ${room.count} 筆，超過上限 ${budgets.roomMax}。`,
      });
    }
  }
  return findings;
}

function checkOversizeRecords(records: LocatedRecord[], factMaxChars: number): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  for (const { where, record } of records) {
    const problems: string[] = [];
    if (record.fact.length > factMaxChars) problems.push(`長 ${record.fact.length} 字元，超過上限 ${factMaxChars}`);
    if (/[\r\n]/.test(record.fact)) problems.push('含換行');
    if (problems.length > 0) {
      findings.push({
        kind: 'oversize-record',
        severity: 'warn',
        target: `${where}:${record.id}`,
        detail: `fact ${problems.join('、')}；應拆成一行一事實。`,
      });
    }
  }
  return findings;
}

function checkStaleRecords(records: LocatedRecord[], budgets: Budgets, now: Date): DoctorFinding[] {
  const stale = records.filter(({ record }) => isStale(record, budgets, now));
  if (stale.length === 0) return [];
  const inKeep = stale.filter((r) => r.where === 'keep').length;
  return [
    {
      kind: 'stale-records',
      severity: 'warn',
      target: 'records',
      detail: `${stale.length} 筆記錄已成假設（conf:low，或非 user 來源且超過 ${budgets.stalenessDays} 天未驗證）：keep ${inKeep}、房間 ${stale.length - inKeep}；巡查時應重新驗證或封存。`,
    },
  ];
}

function checkLocusOrphans(rooms: RoomFile[], files: string[]): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  for (const room of rooms) {
    for (const entry of room.locus) {
      if (!isPathLikeLocus(entry)) continue;
      const matched = files.some((f) => matchesLocus(f, entry));
      if (!matched) {
        findings.push({
          kind: 'locus-orphan',
          severity: 'warn',
          target: `${room.slug}:${entry}`,
          detail: `房間「${room.name}」的 locus「${entry}」未比對到任何檔案，可能已過時。`,
        });
      }
    }
  }
  return findings;
}

// Contract C7: a room with no path-like locus is reachable only by activity
// matching or an explicit room:<slug> stop on a route other than patrol.
function checkLocusUnreachable(rooms: RoomFile[], routes: RouteDef[]): DoctorFinding[] {
  const explicitStops = new Set(routes.filter((r) => r.name !== 'patrol').flatMap((r) => r.stops.map((s) => s.target)));
  return rooms
    .filter((room) => !room.locus.some(isPathLikeLocus) && !explicitStops.has(`room:${room.slug}`))
    .map((room) => ({
      kind: 'locus-unreachable' as const,
      severity: 'warn' as const,
      target: room.slug,
      detail: `房間「${room.name}」沒有路徑型 locus（需含 /、* 或副檔名），也沒有非 patrol 路線停靠 room:${room.slug}，依路徑站立回想永遠載入不到它。`,
    }));
}

// Mirrors patrolFlow.ts's detectRouteGaps (not imported — that module is
// being edited concurrently by another agent), reimplemented directly here.
function checkRouteGaps(routes: RouteDef[], rooms: RoomFile[]): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const roomSlugs = new Set(rooms.map((r) => r.slug));
  const explicitlyReachable = new Set<string>();
  let hasAllRoomsStop = false;

  for (const route of routes) {
    for (const stop of route.stops) {
      const invalid = invalidStopReason(stop);
      if (invalid === 'target') {
        findings.push({
          kind: 'route-target-invalid',
          severity: 'error',
          target: `${route.name} -> ${stop.target}`,
          detail: `路線「${route.name}」的站點目標不在白名單內：${stop.target}（巡行會略過此站並判為無效）`,
        });
        continue;
      }
      if (invalid === 'read') {
        findings.push({
          kind: 'route-read-invalid',
          severity: 'error',
          target: `${route.name} -> ${stop.target}`,
          detail: `路線「${route.name}」站點 ${stop.target} 的 read 值不在白名單內：${stop.read}（巡行會略過此站並判為無效）`,
        });
      }
      if (stop.target === 'all-rooms') {
        hasAllRoomsStop = true;
      } else if (stop.target.startsWith('room:')) {
        const slug = stop.target.slice('room:'.length);
        if (roomSlugs.has(slug)) {
          explicitlyReachable.add(slug);
        } else {
          findings.push({
            kind: 'route-gap',
            severity: 'warn',
            target: `${route.name} -> ${stop.target}`,
            detail: `路線「${route.name}」引用不存在的房間：${slug}`,
          });
        }
      }
    }
  }

  if (!hasAllRoomsStop) {
    for (const slug of roomSlugs) {
      if (!explicitlyReachable.has(slug)) {
        findings.push({
          kind: 'route-gap',
          severity: 'warn',
          target: slug,
          detail: `房間「${slug}」未被任何路線涵蓋（無 all-rooms 站，也無明確 room:${slug} 站）`,
        });
      }
    }
  }

  return findings;
}

const MIGRATE_HINT = 'run node <mc-root>/scripts/castle.mjs migrate ／ 請執行 node <mc-root>/scripts/castle.mjs migrate';

// A pre-v0.5 castle: what `castle.mjs migrate` upgrades, detected the way it
// detects it (any patrol-check stop; chronicle/last-handover exactly) so the
// hint always clears the finding. No session-start route → nothing to say
// here: migrate never creates a route (creating one is yellow).
function checkRouteOutdated(routes: RouteDef[], rawMeta: CastleMeta): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const sessionStart = routes.find((r) => r.name === 'session-start');
  if (sessionStart) {
    const missing: string[] = [];
    if (!sessionStart.stops.some((s) => s.target === 'patrol-check')) missing.push('patrol-check/due');
    if (!sessionStart.stops.some((s) => s.target === 'chronicle' && s.read === 'last-handover')) missing.push('chronicle/last-handover');
    if (missing.length > 0) {
      findings.push({
        kind: 'route-outdated',
        severity: 'warn',
        target: 'session-start',
        detail: `session-start 路線缺少 v0.5 站點：${missing.join('、')}；${MIGRATE_HINT}`,
      });
    }
  }
  if (rawMeta.budgets?.factMaxChars === undefined) {
    findings.push({
      kind: 'route-outdated',
      severity: 'warn',
      target: 'castle.json',
      detail: `castle.json 的 budgets 缺少 factMaxChars（預設 200）；${MIGRATE_HINT}`,
    });
  }
  return findings;
}

function checkRouteWarnings(records: LocatedRecord[], routes: RouteDef[]): DoctorFinding[] {
  const routeNames = new Set(routes.map((r) => r.name));
  return records
    .filter(({ record }) => record.routeWarning !== undefined && !routeNames.has(record.routeWarning))
    .map(({ where, record }) => ({
      kind: 'route-warning-invalid' as const,
      severity: 'warn' as const,
      target: `${where}:${record.id}`,
      detail: `記錄的 ⚠${record.routeWarning} 指向不存在的路線，任何巡行都讀不到這條注意。`,
    }));
}

const SEVERITY_RANK: Record<DoctorSeverity, number> = { ok: 0, info: 0, warn: 1, error: 2 };

function overallStatus(findings: DoctorFinding[]): DoctorReport['status'] {
  const rank = findings.reduce((max, f) => Math.max(max, SEVERITY_RANK[f.severity]), 0);
  return rank === 2 ? 'error' : rank === 1 ? 'warn' : 'ok';
}

export async function runDoctor(root: string, overrides: DoctorOverrides = {}): Promise<DoctorReport> {
  const now = overrides.now ?? new Date();
  const gitFn = overrides.gitFn ?? realGitProbe;

  const castle = await openCastle(root); // NoCastleError propagates to the caller

  const [rawMeta, meta, keep, chronicle, rooms, routes, counts, patrolResult, gitInfo, files] = await Promise.all([
    readJsonFile<CastleMeta>(castleJsonPath(castle.castleDir)), // as on disk: getMeta() fills budget defaults
    castle.getMeta(),
    castle.keep.list(),
    castle.chronicle.list(),
    castle.rooms.list(),
    castle.routes.list(),
    castle.countBudgets(),
    castle.patrolDue(now),
    gitFn(castle.root),
    walkProjectFiles(castle.root),
  ]);
  const longLived: LocatedRecord[] = [
    ...keep.map((record) => ({ where: 'keep', record })),
    ...rooms.flatMap((room) => room.records.map((record) => ({ where: `room:${room.slug}`, record }))),
  ];
  const live: LocatedRecord[] = [...longLived, ...chronicle.map((record) => ({ where: 'chronicle', record }))];

  const findings: DoctorFinding[] = [];

  if (!gitInfo) {
    findings.push({
      kind: 'git',
      severity: 'info',
      target: 'git',
      detail: '找不到 git 儲存庫或 git 不可用，已略過落後偵測（handover-drift／uncommitted-drift）。',
    });
  } else {
    findings.push(...checkHandoverDrift(gitInfo, chronicle));
    findings.push(...checkUncommittedDrift(gitInfo, chronicle, localDate(now)));
  }

  findings.push(...checkPatrolDue(patrolResult));
  findings.push(...checkOverBudget(counts, meta.budgets));
  findings.push(...checkOversizeRecords(live, meta.budgets.factMaxChars));
  findings.push(...checkStaleRecords(longLived, meta.budgets, now));
  findings.push(...checkLocusOrphans(rooms, files));
  findings.push(...checkLocusUnreachable(rooms, routes));
  findings.push(...checkRouteGaps(routes, rooms));
  findings.push(...checkRouteOutdated(routes, rawMeta));
  findings.push(...checkRouteWarnings(live, routes));

  return {
    checkedAt: now.toISOString(),
    root: castle.root,
    status: overallStatus(findings),
    findings,
  };
}
