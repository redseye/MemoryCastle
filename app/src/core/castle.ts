// openCastle: bind all engine functions to one castle directory and expose
// them as a single object (plan §3). Pure/free functions live in their own
// modules (budgets.ts, walk.ts, consolidate.ts, search.ts, locus.ts) so they
// can be unit-tested directly against a castleDir without going through this
// wrapper.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { countBudgets, markPatrolled, patrolDue, readCastleMeta } from './budgets.js';
import type { ChronicleCollection, KeepCollection, RoomsCollection, RoutesCollection } from './collections.js';
import { makeChronicleCollection, makeKeepCollection, makeRoomsCollection, makeRoutesCollection } from './collections.js';
import { archiveRecord, supersede, sweepBlockers, sweepChronicle } from './consolidate.js';
import { NoCastleError } from './errors.js';
import { castleDirOf, castleJsonPath } from './layout.js';
import { matchPathsToRooms, type LocusMatch } from './locus.js';
import { search, type SearchOptions } from './search.js';
import type { PlanWalkOptions } from './walk.js';
import { planWalk, walkReport } from './walk.js';
import type {
  ArchivedRecordEntry,
  BudgetCounts,
  ChronicleArchiveEntry,
  CastleMeta,
  CastleRecord,
  PatrolDueResult,
  RoomFile,
  SearchResult,
  SweepBlockers,
  SweepResult,
  WalkPlan,
  WalkReport,
} from './types.js';

export interface Castle {
  root: string;
  castleDir: string;
  keep: KeepCollection;
  chronicle: ChronicleCollection;
  rooms: RoomsCollection;
  routes: RoutesCollection;
  getMeta(): Promise<CastleMeta>; // budgets always complete (defaults filled in)
  markPatrolled(now?: Date): Promise<CastleMeta>;
  countBudgets(): Promise<BudgetCounts>;
  patrolDue(now?: Date): Promise<PatrolDueResult>;
  roomsForPaths(paths: string[]): Promise<RoomFile[]>;
  matchPaths(paths: string[]): Promise<LocusMatch>;
  planWalk(routeName: string, opts?: PlanWalkOptions): Promise<WalkPlan>;
  walkReport(plan: WalkPlan): WalkReport;
  sweepChronicle(ids: string[], promotedTo?: Record<string, string>): Promise<SweepResult>;
  sweepBlockers(ids: string[], promotedTo?: Record<string, string>): Promise<SweepBlockers>;
  supersede(loserId: string, winnerId: string, reason: string): Promise<ArchivedRecordEntry | ChronicleArchiveEntry>;
  archiveRecord(id: string, reason: string): Promise<ArchivedRecordEntry>;
  search(q: string, opts?: SearchOptions): Promise<SearchResult[]>;
}

export async function openCastle(root: string): Promise<Castle> {
  const resolvedRoot = resolve(root);
  const castleDir = castleDirOf(resolvedRoot);
  if (!existsSync(castleJsonPath(castleDir))) {
    throw new NoCastleError(castleDir);
  }

  const rooms = makeRoomsCollection(castleDir);

  return {
    root: resolvedRoot,
    castleDir,
    keep: makeKeepCollection(castleDir),
    chronicle: makeChronicleCollection(castleDir),
    rooms,
    routes: makeRoutesCollection(castleDir),
    getMeta: () => readCastleMeta(castleDir),
    markPatrolled: (now) => markPatrolled(castleDir, now),
    countBudgets: () => countBudgets(castleDir),
    patrolDue: (now) => patrolDue(castleDir, now),
    roomsForPaths: async (paths) => matchPathsToRooms(await rooms.list(), paths, resolvedRoot).rooms,
    matchPaths: async (paths) => matchPathsToRooms(await rooms.list(), paths, resolvedRoot),
    planWalk: (routeName, opts) => planWalk(castleDir, routeName, { root: resolvedRoot, ...opts }),
    walkReport,
    sweepChronicle: (ids, promotedTo) => sweepChronicle(castleDir, ids, promotedTo),
    sweepBlockers: (ids, promotedTo) => sweepBlockers(castleDir, ids, promotedTo),
    supersede: (loserId, winnerId, reason) => supersede(castleDir, loserId, winnerId, reason),
    archiveRecord: (id, reason) => archiveRecord(castleDir, id, reason),
    search: (q, opts) => search(castleDir, q, opts),
  };
}
