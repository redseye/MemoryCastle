// planWalk expands a route's stops into a concrete plan (dynamic stops
// rooms-by-locus / all-rooms become one room:<slug> stop each) and resolves
// each stop's readable lines, including ⚠<route> (route-warnings) filtering.
// walkReport turns a plan into the mandatory count report (architecture §6):
// "巡行 N/N 房，發現 X 項注意" — skipping a stop makes the walk invalid.
//
// Contract C5: stop targets and read values are a closed whitelist; a stop
// outside it is skipped (walk invalid), never guessed at. rooms-by-locus with
// no paths yet (session start) is deferred — neither passed nor skipped — and
// given paths no room owns are listed in the report. Record lines that are
// hypotheses (contract C3) carry HYPOTHESIS_MARK so a reader can apply the
// staleness rule without seeing dates.

import { resolve } from 'node:path';
import { readJsonFile } from '../storage/json-file.js';
import { isStale, patrolDue, readCastleMeta } from './budgets.js';
import { makeRoomsCollection, makeRoutesCollection } from './collections.js';
import { NotFoundError } from './errors.js';
import { chronicleJsonPath, keepJsonPath } from './layout.js';
import { matchPathsToRooms } from './locus.js';
import { newestHandover } from './record-ops.js';
import type {
  CastleRecord,
  ChronicleFile,
  KeepFile,
  PatrolTrigger,
  RoomFile,
  RouteStop,
  WalkPlan,
  WalkReport,
  WalkStop,
} from './types.js';

export interface PlanWalkOptions {
  paths?: string[];
  root?: string; // project root for absolute-path normalization; defaults to castleDir/../..
  now?: Date;
}

export const HYPOTHESIS_MARK = '（待驗證）';

const KEEP_SECTIONS = ['identity', 'constraints', 'core'] as const;
const FIXED_TARGETS = ['keep', 'chronicle', 'routes', 'rooms-by-locus', 'all-rooms', 'patrol-check'];

export function isValidStopTarget(target: string): boolean {
  if (target.startsWith('room:')) return target.length > 'room:'.length;
  return FIXED_TARGETS.includes(target);
}

// Whitelist: all and route-warnings anywhere; section:<name> only on keep;
// last-handover only on chronicle; due only on patrol-check.
export function isValidStopRead(target: string, read: string): boolean {
  if (read === 'all' || read === 'route-warnings') return true;
  const section = /^section:(.+)$/.exec(read);
  if (section) return target === 'keep' && (KEEP_SECTIONS as readonly string[]).includes(section[1]);
  if (read === 'last-handover') return target === 'chronicle';
  if (read === 'due') return target === 'patrol-check';
  return false;
}

export function invalidStopReason(stop: RouteStop): 'target' | 'read' | undefined {
  if (!isValidStopTarget(stop.target)) return 'target';
  if (!isValidStopRead(stop.target, stop.read)) return 'read';
  return undefined;
}

export function patrolTriggerLine(trigger: PatrolTrigger): string {
  switch (trigger.kind) {
    case 'chronicle':
      return `巡查到期：chronicle 未整理 ${trigger.count} 筆 ≥ ${trigger.limit}`;
    case 'room':
      return `巡查到期：${trigger.target} ${trigger.count} 筆 > ${trigger.limit}`;
    case 'keep':
      return `巡查到期：keep ${trigger.count} 筆 > ${trigger.limit}`;
    case 'days':
      if (trigger.reason === 'neverPatrolled') return `巡查到期：從未巡查（城堡建立 ${trigger.count} 天）`;
      return `巡查到期：距上次巡查 ${trigger.count} 天 > ${trigger.limit}`;
  }
}

export async function planWalk(castleDir: string, routeName: string, opts: PlanWalkOptions = {}): Promise<WalkPlan> {
  const routes = makeRoutesCollection(castleDir);
  const route = await routes.get(routeName);
  if (!route) throw new NotFoundError(`route ${routeName}`);

  const now = opts.now ?? new Date();
  const root = opts.root ?? resolve(castleDir, '..', '..');
  const { budgets } = await readCastleMeta(castleDir);
  const rooms = makeRoomsCollection(castleDir);
  const allRooms = await rooms.list(); // fixed order: sorted by slug

  const lineOf = (r: CastleRecord) => (isStale(r, budgets, now) ? `${HYPOTHESIS_MARK}${r.fact}` : r.fact);
  const linesOf = (records: CastleRecord[], read: string) =>
    (read === 'route-warnings' ? records.filter((r) => r.routeWarning === routeName) : records).map(lineOf);
  const roomStop = (room: RoomFile, read: string): WalkStop => ({
    target: `room:${room.slug}`,
    read,
    lines: linesOf(room.records, read),
    skipped: false,
  });

  const stops: WalkStop[] = [];
  const unmatchedPaths: string[] = [];

  for (const stop of route.stops) {
    const { target, read } = stop;
    if (invalidStopReason(stop)) {
      stops.push({ target, read, lines: [], skipped: true });
    } else if (target === 'keep') {
      const keep = await readJsonFile<KeepFile>(keepJsonPath(castleDir));
      const section = /^section:(.+)$/.exec(read);
      const records = section
        ? keep.sections[section[1] as (typeof KEEP_SECTIONS)[number]]
        : KEEP_SECTIONS.flatMap((s) => keep.sections[s]);
      stops.push({ target, read, lines: linesOf(records, read), skipped: false });
    } else if (target === 'chronicle') {
      const { entries } = await readJsonFile<ChronicleFile>(chronicleJsonPath(castleDir));
      const handover = read === 'last-handover' ? newestHandover(entries) : undefined;
      const lines = read === 'last-handover' ? (handover ? [lineOf(handover)] : []) : linesOf(entries, read);
      stops.push({ target, read, lines, skipped: false });
    } else if (target === 'routes') {
      const names = read === 'route-warnings' ? [] : (await routes.list()).map((r) => r.name);
      stops.push({ target, read, lines: names, skipped: false });
    } else if (target === 'patrol-check') {
      const lines = read === 'route-warnings' ? [] : (await patrolDue(castleDir, now)).triggers.map(patrolTriggerLine);
      stops.push({ target, read, lines, skipped: false });
    } else if (target === 'rooms-by-locus') {
      if (!opts.paths || opts.paths.length === 0) {
        stops.push({ target, read, lines: [], skipped: false, deferred: true });
        continue;
      }
      const match = matchPathsToRooms(allRooms, opts.paths, root);
      for (const p of match.unmatchedPaths) if (!unmatchedPaths.includes(p)) unmatchedPaths.push(p);
      for (const room of match.rooms) stops.push(roomStop(room, read));
    } else if (target === 'all-rooms') {
      for (const room of allRooms) stops.push(roomStop(room, read));
    } else {
      const room = allRooms.find((r) => r.slug === target.slice('room:'.length));
      stops.push(room ? roomStop(room, read) : { target, read, lines: [], skipped: true });
    }
  }

  return { routeName, stops, unmatchedPaths };
}

export function walkReport(plan: WalkPlan): WalkReport {
  const roomStops = plan.stops.filter((s) => s.target.startsWith('room:'));
  const total = roomStops.length;
  const visited = roomStops.filter((s) => !s.skipped).length;
  const warnings = plan.stops.reduce((sum, s) => {
    if (s.skipped) return sum;
    if (s.read === 'route-warnings' || s.target === 'patrol-check') return sum + s.lines.length;
    return sum;
  }, 0);
  const deferred = plan.stops.filter((s) => s.deferred).length;
  const valid = plan.stops.every((s) => !s.skipped);
  let text = `巡行 ${visited}/${total} 房，發現 ${warnings} 項注意`;
  if (deferred > 0) text += `；延後 ${deferred} 站`;
  if (plan.unmatchedPaths.length > 0) text += `；無對應房間：${plan.unmatchedPaths.join('、')}`;
  return { visited, total, warnings, deferred, unmatchedPaths: plan.unmatchedPaths, valid, text };
}
