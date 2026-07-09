// openCastle: bind all engine functions to one castle directory and expose
// them as a single object (plan §3). Pure/free functions live in their own
// modules (budgets.ts, walk.ts, consolidate.ts, search.ts, locus.ts) so they
// can be unit-tested directly against a castleDir without going through this
// wrapper.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readJsonFile } from '../storage/json-file.js';
import { countBudgets, patrolDue } from './budgets.js';
import type { ChronicleCollection, KeepCollection, RoomsCollection, RoutesCollection } from './collections.js';
import { makeChronicleCollection, makeKeepCollection, makeRoomsCollection, makeRoutesCollection } from './collections.js';
import { supersede, sweepChronicle } from './consolidate.js';
import { NoCastleError } from './errors.js';
import { castleDirOf, castleJsonPath } from './layout.js';
import { roomsForPaths as roomsForPathsPure } from './locus.js';
import { search, type SearchOptions } from './search.js';
import type { PlanWalkOptions } from './walk.js';
import { planWalk, walkReport } from './walk.js';
import type {
  BudgetCounts,
  CastleMeta,
  CastleRecord,
  PatrolDueResult,
  RoomFile,
  SearchResult,
  SupersededEntry,
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
  getMeta(): Promise<CastleMeta>;
  countBudgets(): Promise<BudgetCounts>;
  patrolDue(now?: Date): Promise<PatrolDueResult>;
  roomsForPaths(paths: string[]): Promise<RoomFile[]>;
  planWalk(routeName: string, opts?: PlanWalkOptions): Promise<WalkPlan>;
  walkReport(plan: WalkPlan): WalkReport;
  sweepChronicle(ids: string[]): Promise<CastleRecord[]>;
  supersede(loserId: string, winnerId: string, reason: string): Promise<SupersededEntry>;
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
    getMeta: () => readJsonFile<CastleMeta>(castleJsonPath(castleDir)),
    countBudgets: () => countBudgets(castleDir),
    patrolDue: (now) => patrolDue(castleDir, now),
    roomsForPaths: async (paths) => roomsForPathsPure(await rooms.list(), paths),
    planWalk: (routeName, opts) => planWalk(castleDir, routeName, opts),
    walkReport,
    sweepChronicle: (ids) => sweepChronicle(castleDir, ids),
    supersede: (loserId, winnerId, reason) => supersede(castleDir, loserId, winnerId, reason),
    search: (q, opts) => search(castleDir, q, opts),
  };
}
