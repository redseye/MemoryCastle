// UI-facing types. Deliberately duplicated (not imported) from src/core and
// src/flows: those modules pull in Node built-ins (fs, path) via their
// import graph, which must never end up in a browser bundle. These mirror
// the wire shapes exactly — see src/core/types.ts and src/flows/patrolFlow.ts
// for the source of truth; widen both places together if the API changes.

export type Confidence = 'high' | 'med' | 'low';

export interface CastleRecord {
  id: string;
  date: string;
  confidence: Confidence;
  source: string;
  fact: string;
  tags: string[];
  routeWarning?: string;
  verifiedAt?: string; // YYYY-MM-DD: last day the fact was re-verified
}

export interface RecordInput {
  date?: string;
  confidence: Confidence;
  source: string;
  fact: string;
  tags?: string[];
  routeWarning?: string;
}

export type KeepSection = 'identity' | 'constraints' | 'core';

export interface KeepSections {
  identity: CastleRecord[];
  constraints: CastleRecord[];
  core: CastleRecord[];
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

export interface Budgets {
  keepMax: number;
  roomMax: number;
  chronicleSweep: number;
  patrolDays: number;
  stalenessDays: number;
  factMaxChars: number;
}

export interface BudgetCounts {
  keepCount: number;
  chronicleCount: number;
  rooms: { slug: string; count: number }[];
  maxRoomCount: number;
  /** GET /castle only: entries dated after lastPatrolAt — what trigger 1 compares with chronicleSweep. */
  chronicleSinceLastPatrol?: number;
}

export interface PatrolDueResult {
  due: boolean;
  reasons: string[];
}

export interface CastleOverview {
  budgets: Budgets;
  counts: BudgetCounts;
  patrolDue: PatrolDueResult;
  lastPatrolAt: string | null;
}

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

export interface WalkStopResult {
  target: string;
  lines: string[];
}

export interface WalkReport {
  visited: number;
  total: number;
  warnings: number;
  valid: boolean;
  text: string;
}

export interface WalkResponse {
  stops: WalkStopResult[];
  report: WalkReport;
}

export interface RouteStop {
  target: string;
  read: string;
  note?: string;
}

export interface RouteDef {
  name: string;
  occasion: string;
  stops: RouteStop[];
}

export type WarningKind = 'over-budget' | 'stale' | 'route-gap' | 'fact-dropped';

export interface PatrolWarning {
  kind: WarningKind;
  target: string;
  detail: string;
}

export type ProposalKind =
  | 'roomRecord'
  | 'roomCreate'
  | 'contradiction'
  | 'keepPromotion'
  | 'chronicleSweep'
  | 'staleReview'
  | 'recordSplit'
  | 'roomDistill'
  | 'keepCut';
export type ProposalTier = 'green' | 'yellow';
/** staleReview proposals apply only with one of these picked (apply body `decisions`). */
export type StaleDecision = 'verify' | 'archive' | 'delete';

export interface PatrolProposal {
  id: string;
  kind: ProposalKind;
  tier: ProposalTier;
  summary: string;
  payload: Record<string, unknown>;
}

export interface PatrolApplyReport {
  appliedIds: string[];
  skippedYellowIds: string[];
  failed: { id: string; reason: 'not_found' | 'over_budget' | 'fact_too_long' | 'newest_handover' }[];
  patrolledAt: string | null;
}

export interface PatrolJob {
  id: string;
  status: 'proposed' | 'applied';
  createdAt: string;
  mode: 'incremental' | 'full';
  complete: boolean;
  stats: { llmCalls: number; promptChars: number };
  warnings: PatrolWarning[];
  proposals: PatrolProposal[];
  applyReport?: PatrolApplyReport;
}

export interface ImportWarning {
  file: string;
  line: number;
  text: string;
  reason: string;
}

export interface ImportCounts {
  keep: number;
  chronicle: number;
  routes: number;
  rooms: number;
  archiveMonths: number;
}

export interface ImportPreviewResult {
  counts: ImportCounts;
  warnings: ImportWarning[];
}

export interface ImportApplySummary {
  counts: ImportCounts;
  warnings: ImportWarning[];
  movedFiles: string[];
}

export type LlmProviderId = 'anthropic' | 'gemini' | 'openai';

export type LlmMode = 'api' | 'cli';

export interface LlmConfig {
  provider: LlmProviderId;
  apiKey: string; // masked when read from GET/PUT /settings
  model: string;
  mode?: LlmMode;
}

export interface ProjectRegistration {
  id: string;
  name: string;
  root: string;
}

export interface UserConfig {
  schema: 1;
  port: number;
  llm: LlmConfig;
  projects: ProjectRegistration[];
}

// Display hints only (plan: model text input pre-filled per provider). The
// server never exposes these; src/llm/constants.ts is the runtime default
// actually applied when a config omits a model.
export const DEFAULT_MODELS: Record<LlmProviderId, string> = {
  anthropic: 'claude-sonnet-5',
  gemini: 'gemini-3.5-flash',
  openai: 'gpt-5.4-mini',
};
