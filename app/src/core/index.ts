// Public barrel for the core engine (used by cli.ts and, later, the REST layer).

export * from './types.js';
export * from './errors.js';
export { localDate, generateId, daysBetween } from './ids.js';
export { matchesLocus, roomsForPaths, matchPathsToRooms, normalizeLocusPath, isPathLikeLocus, type LocusMatch } from './locus.js';
export { initCastle, DEFAULT_BUDGETS } from './init.js';
export { openCastle, type Castle } from './castle.js';
export { castleDirOf, castleJsonPath } from './layout.js';
export { countBudgets, countSincePatrol, patrolDue, isStale, readCastleMeta, markPatrolled } from './budgets.js';
export { renderRecordLine, isHandoverEntry, newestHandover } from './record-ops.js';
export { estimateTokens, measureCastle, type CastleMeasure } from './measure.js';
export {
  runDoctor,
  type DoctorFinding,
  type DoctorFindingKind,
  type DoctorSeverity,
  type DoctorReport,
  type DoctorOverrides,
  type GitInfo,
  type GitProbeFn,
} from './doctor.js';
export {
  planWalk,
  walkReport,
  isValidStopTarget,
  isValidStopRead,
  invalidStopReason,
  patrolTriggerLine,
  HYPOTHESIS_MARK,
  type PlanWalkOptions,
} from './walk.js';
export { sweepChronicle, sweepBlockers, isSweepBlocked, supersede, archiveRecord } from './consolidate.js';
export { search, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT, type SearchOptions } from './search.js';
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
