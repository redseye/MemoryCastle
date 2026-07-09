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

export interface CastleOverview {
  budgets: Budgets;
  counts: BudgetCounts;
  patrolDue: PatrolDueResult;
  lastPatrolAt: string | null;
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

export type WarningKind = 'over-budget' | 'stale' | 'route-gap';

export interface PatrolWarning {
  kind: WarningKind;
  target: string;
  detail: string;
}

export type ProposalKind = 'roomRecord' | 'roomCreate' | 'contradiction' | 'keepPromotion';
export type ProposalTier = 'green' | 'yellow';

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
}

export interface PatrolJob {
  id: string;
  status: 'proposed' | 'applied';
  createdAt: string;
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
