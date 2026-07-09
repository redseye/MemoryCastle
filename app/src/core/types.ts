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
}

export type RecordPatch = Partial<RecordInput>;

export interface Budgets {
  keepMax: number;
  roomMax: number;
  chronicleSweep: number;
  patrolDays: number;
  stalenessDays: number;
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
  target: string; // 'keep' | 'chronicle' | 'routes' | 'room:<slug>' | 'rooms-by-locus' | 'all-rooms'
  read: string; // 'all' | 'route-warnings' | 'section:<name>'
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
}

export interface ChronicleArchiveFile {
  schema: 1;
  month: string; // YYYY-MM
  entries: ChronicleArchiveEntry[];
}

export interface SupersededEntry {
  record: CastleRecord;
  supersededById: string;
  reason: string;
  archivedAt: string;
}

export interface SupersededFile {
  schema: 1;
  entries: SupersededEntry[];
}

export interface BudgetCounts {
  keepCount: number;
  chronicleCount: number;
  rooms: { slug: string; count: number }[];
  maxRoomCount: number;
}

export interface PatrolDueResult {
  due: boolean;
  reasons: string[];
}

export interface WalkStop {
  target: string; // concrete target after dynamic-stop expansion, e.g. 'room:foo'
  read: string;
  lines: string[];
  skipped: boolean;
}

export interface WalkPlan {
  routeName: string;
  stops: WalkStop[];
}

export interface WalkReport {
  visited: number;
  total: number;
  warnings: number;
  valid: boolean;
  text: string;
}

export interface SearchResult {
  record: CastleRecord;
  location: string; // 'keep:identity' | 'chronicle' | 'room:<slug>'
}
