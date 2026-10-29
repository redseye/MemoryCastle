// Domain types per plan §2/§3. Named CastleRecord (not Record) to avoid shadowing
// TypeScript's built-in Record<K,V> utility type.

export type Confidence = 'high' | 'med' | 'low';

export interface CastleRecord {
  id: string;
  date: string; // YYYY-MM-DD, local timezone
  confidence: Confidence;
  source: string;
  fact: string;
  tags: string[];
  routeWarning?: string;
  verifiedAt?: string; // YYYY-MM-DD: last date the fact was re-verified (contract C2)
}

// Input for creating/patching a record. id is always assigned by the engine;
// date defaults to localDate() when omitted.
export interface RecordInput {
  date?: string;
  confidence: Confidence;
  source: string;
  fact: string;
  tags?: string[];
  routeWarning?: string;
  verifiedAt?: string;
}

export type RecordPatch = Partial<RecordInput>;

export interface Budgets {
  keepMax: number;
  roomMax: number;
  chronicleSweep: number;
  patrolDays: number;
  stalenessDays: number;
  factMaxChars: number; // max JS string length of a record's fact (contract C1)
}

export interface CastleMeta {
  schema: 1;
  projectName: string;
  createdAt: string;
  lastPatrolAt: string | null;
  budgets: Budgets;
}

export type KeepSection = 'identity' | 'constraints' | 'core';

export interface KeepFile {
  schema: 1;
  sections: {
    identity: CastleRecord[];
    constraints: CastleRecord[];
    core: CastleRecord[];
  };
}

export interface ChronicleFile {
  schema: 1;
  entries: CastleRecord[];
}

export interface RoomFile {
  schema: 1;
  slug: string;
  name: string;
  locus: string[];
  adjacent: string[];
  emblem: string | null;
  createdAt: string;
  records: CastleRecord[];
}

export interface RoomInput {
  slug?: string;
  name: string;
  locus?: string[];
  adjacent?: string[];
  emblem?: string | null;
}

export type RoomPatch = Partial<Omit<RoomInput, 'slug'>>;

export interface RouteStop {
  target: string; // 'keep' | 'chronicle' | 'routes' | 'room:<slug>' | 'rooms-by-locus' | 'all-rooms' | 'patrol-check'
  read: string; // 'all' | 'route-warnings' | 'section:<name>' | 'last-handover' | 'due' (whitelist: walk.ts)
  // Set by the importer (src/importer/routes.ts) when a markdown stop's text
  // couldn't be mapped to the vocabulary above; preserves the original text
  // for manual follow-up instead of guessing wrong.
  note?: string;
}

export interface RouteDef {
  name: string;
  occasion: string;
  stops: RouteStop[];
}

export interface RoutesFile {
  schema: 1;
  routes: RouteDef[];
}

export interface ChronicleArchiveEntry extends CastleRecord {
  sweptAt: string;
  promotedTo?: string; // '<room-slug>' | 'keep' when patrol promoted the entry (contract C2)
}

// What stops a chronicle sweep (all-or-nothing, like `castle.mjs sweep`).
export interface SweepBlockers {
  unknownIds: string[]; // not in chronicle.json
  refusedIds: string[]; // the newest handover — stays for chronicle/last-handover
  unknownPromotedTo: string[]; // promotedTo values naming no room (and not 'keep')
}

export interface SweepResult extends SweepBlockers {
  swept: CastleRecord[]; // empty whenever any blocker list is non-empty
}

export interface ChronicleArchiveFile {
  schema: 1;
  month: string; // YYYY-MM
  entries: ChronicleArchiveEntry[];
}

// archive/room-records-YYYY-MM.json (architecture §2): records patrol moved
// to cold storage, bucketed by the month they were archived — the same file
// `castle.mjs archive` writes. archivedFrom is 'room:<slug>' (spec), or
// 'keep' for an approved keep cut/archive (the app's extension; §2 names no
// keep archive).
export interface ArchivedRecordEntry extends CastleRecord {
  archivedAt: string;
  archivedFrom: string;
  archiveNote: string;
}

export interface ArchivedRecordsFile {
  schema: 1;
  month: string; // YYYY-MM
  entries: ArchivedRecordEntry[];
}

export interface BudgetCounts {
  keepCount: number;
  chronicleCount: number;
  rooms: { slug: string; count: number }[];
  maxRoomCount: number;
}

// One fired architecture §4 trigger. `reason` is the same machine-ish string
// listed in PatrolDueResult.reasons; walks/doctor render their own text.
export interface PatrolTrigger {
  kind: 'chronicle' | 'room' | 'keep' | 'days';
  target: string; // 'chronicle' | 'room:<slug>' | 'keep' | 'patrol'
  count: number; // unswept entries / records / days since last patrol (never patrolled: days since createdAt)
  limit: number;
  reason: string;
}

export interface PatrolDueResult {
  due: boolean;
  reasons: string[];
  triggers: PatrolTrigger[];
}

export interface WalkStop {
  target: string; // concrete target after dynamic-stop expansion, e.g. 'room:foo'
  read: string;
  lines: string[];
  skipped: boolean; // invalid stop (unknown target/read) or missing room — invalidates the walk
  deferred?: boolean; // rooms-by-locus with no paths known yet (contract C5) — neither passed nor skipped
}

export interface WalkPlan {
  routeName: string;
  stops: WalkStop[];
  unmatchedPaths: string[]; // given paths no room's locus owns (contract C5)
}

export interface WalkReport {
  visited: number;
  total: number;
  warnings: number;
  deferred: number;
  unmatchedPaths: string[];
  valid: boolean;
  text: string;
}

export interface SearchResult {
  record: CastleRecord;
  location: string; // 'keep:identity' | 'chronicle' | 'room:<slug>'
}
