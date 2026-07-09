// Public barrel for the core engine (used by cli.ts and, later, the REST layer).

export * from './types.js';
export * from './errors.js';
export { localDate, generateId, daysBetween } from './ids.js';
export { matchesLocus, roomsForPaths } from './locus.js';
export { initCastle, DEFAULT_BUDGETS } from './init.js';
export { openCastle, type Castle } from './castle.js';
export { castleDirOf, castleJsonPath } from './layout.js';
export { countBudgets, patrolDue, isStale } from './budgets.js';
export { planWalk, walkReport, type PlanWalkOptions } from './walk.js';
export { sweepChronicle, supersede } from './consolidate.js';
export { search, type SearchOptions } from './search.js';
export {
  makeKeepCollection,
  makeChronicleCollection,
  makeRoomsCollection,
  makeRoutesCollection,
  type KeepCollection,
  type ChronicleCollection,
  type RoomsCollection,
  type RoutesCollection,
} from './collections.js';
