// patrolFlow: the consolidation patrol (plan §4, architecture §4 v0.5).
// Produces a PROPOSAL list tagged green (auto-applied) or yellow (needs the
// user's approval) per the architecture §5 walls. apply() executes green
// proposals plus only the yellow ones the user approved (staleReview: the
// ones the user picked a decision for), and only ever through core ops
// (sweepChronicle, supersede, archiveRecord, rooms/keep collections) —
// never a free-form write. A completed patrol's apply stamps lastPatrolAt
// (contract C6), so trigger 4 stops firing and trigger 1 counts afresh.
//
// Rule R7 split: counting, dating, sweeping, staleness, length and budget
// checks are deterministic code; clustering, distilling, room ownership,
// contradictions, promotions, splits and cuts are model judgments. So:
//   - the deterministic pre-pass (budgets, staleness, route gaps) always
//     runs and fills `warnings`, even with no LLM configured, so POST
//     /patrol never has to 409;
//   - deterministic proposals (sweeping every handover but the newest, each
//     listed with its full text so the user can rescue a decision before
//     applying; staleReview for every hypothesis in keep and rooms) need no
//     LLM either;
//   - the LLM steps run only when a provider is configured, and degrade to
//     "no LLM proposals, job not complete" (not a 409) when it isn't.
//
// Token discipline (v0.5): handovers never reach a prompt; one cluster call
// also decides each cluster's room and routes aged orphans (no per-cluster
// room call); only clusters with a destination are distilled, three at a
// time; every model-written fact is checked against factMaxChars, rewritten
// once if it breaks the cap, and dropped with a warning if it still does.
// By default the contradiction and keep-promotion steps are incremental —
// only records newer than lastPatrolAt (by date or verifiedAt) — and
// `full: true` restores the whole-castle pass. Calls that need the castle
// share one byte-identical map (keep + room directory) as JudgeTask.context,
// which the Anthropic adapter marks for prompt caching.
//
// Job store is an in-memory Map, fine for a single-process local tool (plan
// §4). runPatrol resolves once every LLM call is done rather than truly
// backgrounding the work; the job abstraction (jobId, GET-by-id) is kept so
// the Web UI can poll/display it the same way.

import { NotFoundError, SweepRefusedError } from '../core/errors.js';
import { daysBetween, generateId, localDate } from '../core/ids.js';
import { isStale } from '../core/budgets.js';
import { isPathLikeLocus, matchPathsToRooms } from '../core/locus.js';
import { isHandoverEntry, newestHandover } from '../core/record-ops.js';
import type { Castle } from '../core/castle.js';
import type { Budgets, CastleRecord, Confidence, KeepSection, RecordInput, RoomFile, SweepBlockers } from '../core/types.js';
import { LlmNotConfiguredError, NotConfiguredLlmService } from '../server/llm-seam.js';
import type { JudgeTask, LlmService } from '../server/llm-seam.js';
import {
  CLUSTER_ENTRIES_SCHEMA,
  CONTRADICTION_CHECK_SCHEMA,
  DISTILL_CLUSTER_SCHEMA,
  KEEP_CUT_SCHEMA,
  KEEP_PROMOTION_SCHEMA,
  REWRITE_FACTS_SCHEMA,
  ROOM_DISTILL_SCHEMA,
} from '../llm/schemas.js';
import {
  castleMapContext,
  clusterEntriesPrompt,
  contradictionCheckPrompt,
  distillClusterPrompt,
  keepCutPrompt,
  keepPromotionPrompt,
  rewriteFactsPrompt,
  roomDistillPrompt,
} from '../llm/prompts.js';
import { factProblem, mapWithConcurrency } from './flow-helpers.js';

// Patrol cancel: the single error type runPatrol surfaces for any
// abort-triggered failure, regardless of which LLM mode caused it (CLI mode
// rejects with cli.ts's CliCancelledError; an API-mode SDK rejects with its
// own AbortError-shaped error). judgeOrCancel() below normalizes both into
// this one type before it ever reaches the route, so app.ts's onError only
// needs a single branch and never has to know about a specific adapter's
// error class.
export class PatrolCancelledError extends Error {
  constructor() {
    super('巡查已由使用者取消。');
    this.name = 'PatrolCancelledError';
  }
}

// Thrown by runPatrol when a patrol is already in flight for the same
// castle — the in-flight registry (see `inFlight` below) only ever tracks
// one AbortController per key, so a second concurrent run must refuse
// rather than race the first for jobStore/chronicle-sweep writes.
export class PatrolAlreadyRunningError extends Error {
  constructor() {
    super('此專案已有巡查正在執行中，請稍候再試。');
    this.name = 'PatrolAlreadyRunningError';
  }
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
export type StaleDecision = 'verify' | 'archive' | 'delete';
export const STALE_DECISIONS: readonly StaleDecision[] = ['verify', 'archive', 'delete'];

export interface DistilledRecord {
  fact: string;
  confidence: Confidence;
  tags: string[];
  // Carried over when an orphan entry moves verbatim. A distilled record gets
  // no verifiedAt (F9: only a patrol that re-verified sets it, and the app's
  // patrol never does) and keeps the newest source entry's date, not today.
  routeWarning?: string;
  verifiedAt?: string;
}

export interface RoomRecordPayload {
  slug: string;
  records: DistilledRecord[];
  source: string; // 'chronicle:<id>,<id>' — the entries the records came from
  date: string; // the newest source entry's date, not the patrol's
  sweepEntryIds: string[];
}

export interface RoomCreatePayload {
  name: string;
  locus: string[];
  adjacent: string[];
  records: DistilledRecord[];
  source: string;
  date: string;
  sweepEntryIds: string[];
}

export interface ContradictionPayload {
  loserId: string;
  winnerId: string;
  reason: string;
}

export interface KeepPromotionPayload {
  recordId: string;
  section: KeepSection;
  reason: string;
}

// Archive chronicle entries as-is (§4 step 4): every handover but the newest,
// aged orphans no room owns, or entries whose facts failed the re-applied
// gate (§4 step 2). A handover sweep carries the entries themselves so the
// review shows each one's full text before it goes.
export interface ChronicleSweepPayload {
  entryIds: string[];
  reason: 'handover' | 'orphan' | 'gate';
  entries?: CastleRecord[];
}

// location: 'keep' | 'room:<slug>' (the same for the payloads below).
export interface StaleReviewPayload {
  location: string;
  record: CastleRecord;
}

export interface RecordSplitPayload {
  location: string;
  recordId: string;
  facts: string[];
}

export interface RoomDistillPayload {
  slug: string;
  action: 'merge' | 'cut';
  recordIds: string[]; // merge: the records restated as one; cut: the one record
  merged?: { fact: string; confidence: Confidence; tags: string[]; date: string };
  reason: string;
}

export interface KeepCutPayload {
  recordId: string;
  action: 'demote' | 'archive';
  targetRoomSlug: string; // '' for archive
  reason: string;
}

export type ProposalPayload =
  | RoomRecordPayload
  | RoomCreatePayload
  | ContradictionPayload
  | KeepPromotionPayload
  | ChronicleSweepPayload
  | StaleReviewPayload
  | RecordSplitPayload
  | RoomDistillPayload
  | KeepCutPayload;

export interface PatrolProposal {
  id: string;
  kind: ProposalKind;
  tier: ProposalTier;
  summary: string;
  payload: ProposalPayload;
}

export type ApplyFailureReason = 'not_found' | 'over_budget' | 'fact_too_long' | 'newest_handover';

export interface PatrolApplyReport {
  appliedIds: string[];
  skippedYellowIds: string[];
  failed: { id: string; reason: ApplyFailureReason }[];
  patrolledAt: string | null; // the lastPatrolAt this apply stamped; null when the job was not complete
}

export type WarningKind = 'over-budget' | 'stale' | 'route-gap' | 'fact-dropped';

export interface PatrolWarning {
  kind: WarningKind;
  target: string;
  detail: string;
}

export interface PatrolStats {
  llmCalls: number;
  promptChars: number; // context + system + user characters sent, summed over calls
}

export interface PatrolJob {
  id: string;
  status: 'proposed' | 'applied';
  createdAt: string;
  mode: 'incremental' | 'full';
  // Every LLM step ran (a provider was configured). Only a complete job's
  // apply stamps lastPatrolAt — a key-less run is not a finished patrol.
  complete: boolean;
  stats: PatrolStats;
  warnings: PatrolWarning[];
  proposals: PatrolProposal[];
  applyReport?: PatrolApplyReport;
}

export interface RunPatrolOptions {
  signal?: AbortSignal;
  full?: boolean;
}

const jobStore = new Map<string, PatrolJob>();

// Patrol cancel: one AbortController per castle currently running a patrol,
// keyed by castle.root (the same resolved path Castle carries everywhere
// else as its identity — runPatrol only ever receives a Castle, never the
// route's raw project id, so this is the natural key rather than plumbing an
// extra id parameter through). Registered at the start of runPatrol, removed
// in its `finally`. cancelPatrol()/runPatrol() are the only readers/writers.
const inFlight = new Map<string, AbortController>();

const KEEP_SECTIONS: KeepSection[] = ['identity', 'constraints', 'core'];
const LLM_CONCURRENCY = 3;
const MAX_DISTILLED_RECORDS = 8;
// Rooms with new records are packed into contradiction calls of at most this
// many fact characters (a room is never split across calls).
const CONTRADICTION_CHUNK_CHARS = 12000;
const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, med: 1, high: 2 };

interface ClusterEntriesResult {
  clusters: {
    entryIds: string[];
    locus: string;
    topic: string;
    targetRoomSlug: string;
    newRoomName: string;
    newRoomLocus: string[];
    newRoomAdjacent: string[];
  }[];
  orphans: { entryId: string; targetRoomSlug: string; passesGate: boolean }[];
}

interface DistillClusterResult {
  records: (DistilledRecord & { passesGate?: boolean })[];
}

interface RewriteFactsResult {
  items: { key: string; facts: string[] }[];
}

interface ContradictionCheckResult {
  contradictions: { loserId: string; winnerId: string; reason: string }[];
}

interface KeepPromotionResult {
  promotions: { recordId: string; section: KeepSection; reason: string }[];
}

interface RoomDistillResult {
  merges: { recordIds: string[]; fact: string; tags: string[] }[];
  cuts: { recordId: string; reason: string }[];
}

interface KeepCutResult {
  cuts: { recordId: string; action: 'demote' | 'archive'; targetRoomSlug: string; reason: string }[];
}

// Everything one patrol run reads once and every step shares.
interface PatrolRun {
  castle: Castle;
  llm: LlmService;
  signal: AbortSignal;
  full: boolean;
  now: Date;
  budgets: Budgets;
  lastPatrolAt: string | null;
  keep: { section: KeepSection; record: CastleRecord }[];
  rooms: RoomFile[];
  roomsBySlug: Map<string, RoomFile>;
  chronicle: CastleRecord[];
  castleMap: string; // JudgeTask.context for every call that needs the castle
  projectedRoomCounts: Map<string, number>; // room size after this patrol's green additions
  // Chronicle entries this patrol's proposals move into a room (slug; null =
  // a proposed new room). Their room records will carry the entries' own
  // dates, so a later incremental patrol would never see them as new — the
  // contradiction step checks them now, in their target room's chunk.
  incoming: { slug: string | null; label: string; entries: CastleRecord[] }[];
  warnings: PatrolWarning[];
  stats: PatrolStats;
}

// Deterministic pre-pass, step 1: budgets — the same triggers patrolDue()
// reports (trigger 1 counts only entries dated after lastPatrolAt), so the
// patrol page and the session-start check never disagree.
async function detectBudgetWarnings(castle: Castle): Promise<PatrolWarning[]> {
  const warnings: PatrolWarning[] = [];
  for (const t of (await castle.patrolDue()).triggers) {
    if (t.kind === 'keep') {
      warnings.push({ kind: 'over-budget', target: 'keep', detail: `keep ${t.count}/${t.limit}，超過上限` });
    } else if (t.kind === 'room') {
      warnings.push({ kind: 'over-budget', target: t.target, detail: `${t.count}/${t.limit}，超過上限` });
    } else if (t.kind === 'chronicle') {
      warnings.push({ kind: 'over-budget', target: 'chronicle', detail: `上次巡查後新增 ${t.count}/${t.limit} 筆，已達整理門檻` });
    }
  }
  return warnings;
}

// Deterministic pre-pass, step 2: staleness (architecture §2, contract C3)
// over every keep and room record.
async function detectStaleWarnings(castle: Castle): Promise<PatrolWarning[]> {
  const warnings: PatrolWarning[] = [];
  const now = new Date();
  const { budgets } = await castle.getMeta();

  const keepRecords = await castle.keep.list();
  for (const r of keepRecords) {
    if (isStale(r, budgets, now)) {
      warnings.push({
        kind: 'stale',
        target: `keep:${r.id}`,
        detail: `${r.date} | conf:${r.confidence} | ${r.fact}`,
      });
    }
  }

  const rooms = await castle.rooms.list();
  for (const room of rooms) {
    for (const r of room.records) {
      if (isStale(r, budgets, now)) {
        warnings.push({
          kind: 'stale',
          target: `room:${room.slug}:${r.id}`,
          detail: `${r.date} | conf:${r.confidence} | ${r.fact}`,
        });
      }
    }
  }
  return warnings;
}

// Deterministic pre-pass, step 3: route gaps (architecture §4 step 7) — a
// room reachable by nothing (no route has an all-rooms stop, and no route
// has an explicit room:<slug> stop naming it), and any explicit room:<slug>
// stop that names a room that no longer exists. rooms-by-locus is not
// counted toward "reachable": its coverage depends on the paths a walk is
// given, so it can't guarantee any specific room is ever visited.
async function detectRouteGaps(castle: Castle): Promise<PatrolWarning[]> {
  const warnings: PatrolWarning[] = [];
  const routes = await castle.routes.list();
  const rooms = await castle.rooms.list();
  const roomSlugs = new Set(rooms.map((r) => r.slug));

  const explicitlyReachable = new Set<string>();
  let hasAllRoomsStop = false;

  for (const route of routes) {
    for (const stop of route.stops) {
      if (stop.target === 'all-rooms') {
        hasAllRoomsStop = true;
      } else if (stop.target.startsWith('room:')) {
        const slug = stop.target.slice('room:'.length);
        if (roomSlugs.has(slug)) {
          explicitlyReachable.add(slug);
        } else {
          warnings.push({
            kind: 'route-gap',
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
        warnings.push({
          kind: 'route-gap',
          target: slug,
          detail: `房間「${slug}」未被任何路線涵蓋（無 all-rooms 站，也無明確 room:${slug} 站）`,
        });
      }
    }
  }

  return warnings;
}

async function detectWarnings(castle: Castle): Promise<PatrolWarning[]> {
  return [
    ...(await detectBudgetWarnings(castle)),
    ...(await detectStaleWarnings(castle)),
    ...(await detectRouteGaps(castle)),
  ];
}

async function openRun(castle: Castle, llm: LlmService, signal: AbortSignal, full: boolean, warnings: PatrolWarning[]): Promise<PatrolRun> {
  const meta = await castle.getMeta();
  const keep: PatrolRun['keep'] = [];
  for (const section of KEEP_SECTIONS) {
    for (const record of await castle.keep.list(section)) keep.push({ section, record });
  }
  const rooms = await castle.rooms.list();
  return {
    castle,
    llm,
    signal,
    full,
    now: new Date(),
    budgets: meta.budgets,
    lastPatrolAt: meta.lastPatrolAt,
    keep,
    rooms,
    roomsBySlug: new Map(rooms.map((r) => [r.slug, r])),
    chronicle: await castle.chronicle.list(),
    castleMap: castleMapContext({ keep, rooms, budgets: meta.budgets }),
    projectedRoomCounts: new Map(),
    incoming: [],
    warnings,
    stats: { llmCalls: 0, promptChars: 0 },
  };
}

// Incremental mode's "new": written or re-verified on or after the last
// patrol day (every record when there was none). On, not only after: dates
// are whole days, so a record written later on the patrol day would
// otherwise never be checked; re-checking that one day is the cheap side.
function isNewSincePatrol(run: PatrolRun, r: CastleRecord): boolean {
  if (run.lastPatrolAt === null) return true;
  return r.date >= run.lastPatrolAt || (r.verifiedAt !== undefined && r.verifiedAt >= run.lastPatrolAt);
}

function newestDate(records: CastleRecord[]): string {
  return records.reduce((max, r) => (r.date > max ? r.date : max), records[0].date);
}

function lowestConfidence(records: CastleRecord[]): Confidence {
  return records.reduce<Confidence>((low, r) => (CONFIDENCE_RANK[r.confidence] < CONFIDENCE_RANK[low] ? r.confidence : low), 'high');
}

// §2 / §4 step 2: `high` means the patrol verified the fact this session.
// The app's patrol only reads text, so a record it writes is at most `med`.
function patrolConfidence(c: Confidence): Confidence {
  return c === 'high' ? 'med' : c;
}

function locationLabel(location: string): string {
  return location === 'keep' ? 'keep' : `房間 ${location.slice('room:'.length)}`;
}

// Budget guard (§4 step 2): a green write that would take a room past
// roomMax becomes a yellow proposal instead. Green additions are counted as
// they are proposed, so two proposals can't jointly overrun a room.
function reserveRoomSpace(run: PatrolRun, slug: string, adding: number): ProposalTier {
  const current = run.projectedRoomCounts.get(slug) ?? run.roomsBySlug.get(slug)?.records.length ?? 0;
  if (current + adding > run.budgets.roomMax) return 'yellow';
  run.projectedRoomCounts.set(slug, current + adding);
  return 'green';
}

function overBudgetNote(run: PatrolRun, tier: ProposalTier): string {
  return tier === 'yellow' ? `（會使房間超過 ${run.budgets.roomMax} 筆上限，需核准）` : '';
}

function proposal(kind: ProposalKind, tier: ProposalTier, summary: string, payload: ProposalPayload): PatrolProposal {
  return { id: generateId(), kind, tier, summary, payload };
}

// Wraps every judge() call in the patrol pipeline with cancellation and the
// job's call/char accounting: checked up front so a cancel that lands
// between two calls stops the pipeline before the next CLI process ever
// spawns, and checked again on a caught error so a cancel that lands
// mid-call (CliCancelledError from cli.ts, or an API-mode SDK's own
// AbortError) surfaces uniformly.
async function judgeOrCancel<T>(run: PatrolRun, task: JudgeTask<T>): Promise<T> {
  if (run.signal.aborted) throw new PatrolCancelledError();
  run.stats.llmCalls += 1;
  run.stats.promptChars += (task.context?.length ?? 0) + task.system.length + task.user.length;
  try {
    return await run.llm.judge<T>({ ...task, signal: run.signal });
  } catch (err) {
    if (run.signal.aborted) throw new PatrolCancelledError();
    throw err;
  }
}

// One rewrite call for facts that break the §2 cap. Each key maps to its
// replacement facts, or to undefined when the rewrite still breaks the cap
// (or the model skipped the key) — the caller then drops it, never
// truncates it.
async function rewriteFacts(
  run: PatrolRun,
  items: { key: string; fact: string }[],
  allowSplit: boolean,
  retry: boolean,
): Promise<Map<string, string[] | undefined>> {
  const cap = run.budgets.factMaxChars;
  const result = await judgeOrCancel<RewriteFactsResult>(run, {
    ...rewriteFactsPrompt({ items, factMaxChars: cap, allowSplit, retry }),
    schema: REWRITE_FACTS_SCHEMA,
  });
  const out = new Map<string, string[] | undefined>();
  for (const item of items) {
    const facts = (result.items?.find((i) => i.key === item.key)?.facts ?? []).map((f) => f.trim());
    const fits = facts.length > 0 && (allowSplit || facts.length === 1) && facts.every((f) => !factProblem(f, cap));
    out.set(item.key, fits ? facts : undefined);
  }
  return out;
}

function dropWarning(run: PatrolRun, target: string, detail: string): void {
  run.warnings.push({ kind: 'fact-dropped', target, detail });
}

// A distill's records against the cap: the offending ones get the ONE retry
// (shorten or split); null when any is still over, so the caller drops the
// whole cluster and its entries stay in the chronicle for the next patrol.
async function fitDistilled(run: PatrolRun, records: DistilledRecord[]): Promise<DistilledRecord[] | null> {
  const cap = run.budgets.factMaxChars;
  const trimmed = records.map((r) => ({ ...r, fact: r.fact.trim() }));
  const bad = trimmed.map((r, i) => ({ key: `r${i}`, fact: r.fact })).filter((item) => factProblem(item.fact, cap));
  if (bad.length === 0) return trimmed;
  const rewritten = await rewriteFacts(run, bad, true, true);
  const out: DistilledRecord[] = [];
  for (const [i, r] of trimmed.entries()) {
    if (!factProblem(r.fact, cap)) {
      out.push(r);
      continue;
    }
    const facts = rewritten.get(`r${i}`);
    if (!facts) return null;
    out.push(...facts.map((fact) => ({ ...r, fact })));
  }
  return out;
}

// Deterministic room ownership first (rule R7): a tag naming a room's slug,
// or a path-like tag (§3: a place-bound fact ends with its room's tag or a
// candidate locus) that exactly one room's locus owns. Ambiguous or no
// match → the cluster call decides.
function tagOwner(run: PatrolRun, entry: CastleRecord): string | undefined {
  const tags = entry.tags.map((t) => t.toLowerCase());
  const bySlug = run.rooms.filter((r) => tags.includes(r.slug.toLowerCase()));
  if (bySlug.length > 0) return bySlug.length === 1 ? bySlug[0].slug : undefined;
  const pathTags = entry.tags.filter(isPathLikeLocus);
  if (pathTags.length === 0) return undefined;
  const owners = matchPathsToRooms(run.rooms, pathTags, run.castle.root).rooms;
  return owners.length === 1 ? owners[0].slug : undefined;
}

// --- deterministic proposals (no LLM) -------------------------------------

// §4 step 4: every handover but the newest goes to archive; the newest stays
// for the session-start route's chronicle/last-handover stop. A handover can
// hold a durable decision, so the proposal lists every swept handover with
// its full text: the user rescues one (appends it as an ordinary entry)
// before applying. No model call — reviewing is the user's.
function handoverProposals(run: PatrolRun): PatrolProposal[] {
  const newest = newestHandover(run.chronicle);
  const old = run.chronicle.filter((e) => isHandoverEntry(e) && e !== newest);
  if (!newest || old.length === 0) return [];
  const listed = old.map((e) => `［${e.date} ${e.id}］${e.fact}`).join('　');
  return [
    proposal(
      'chronicleSweep',
      'green',
      `封存 ${old.length} 筆舊交接（保留最新一筆 ${newest.date} ${newest.id}）；套用前請確認其中的決定或教訓已另記成條目：${listed}`,
      { entryIds: old.map((e) => e.id), reason: 'handover', entries: old },
    ),
  ];
}

// §4 steps 5c/6: every hypothesis in keep and rooms. The app cannot run the
// check itself, so the user is the verifier: verified (stamp verifiedAt =
// today), archive, or delete — yellow for rooms and keep alike.
function staleReviewProposals(run: PatrolRun): PatrolProposal[] {
  const targets = [
    ...run.keep.map((k) => ({ location: 'keep', record: k.record })),
    ...run.rooms.flatMap((room) => room.records.map((record) => ({ location: `room:${room.slug}`, record }))),
  ];
  return targets
    .filter((t) => isStale(t.record, run.budgets, run.now))
    .map(({ location, record }) => {
      const ver = record.verifiedAt ? ` ver:${record.verifiedAt}` : '';
      return proposal(
        'staleReview',
        'yellow',
        `待驗證（${locationLabel(location)}）：${record.date} conf:${record.confidence} src:${record.source}${ver}｜${record.fact}`,
        { location, record },
      );
    });
}

// --- LLM proposals ---------------------------------------------------------

type DistillTarget = { slug: string } | { create: { name: string; locus: string[]; adjacent: string[] } };

interface DistillJob {
  entries: CastleRecord[];
  target: DistillTarget;
}

function roomRecordProposal(run: PatrolRun, slug: string, records: DistilledRecord[], entries: CastleRecord[], orphan: boolean): PatrolProposal {
  const tier = reserveRoomSpace(run, slug, records.length);
  const facts = records.map((r) => r.fact).join('；');
  const what = orphan
    ? `逾 ${run.budgets.patrolDays} 天的孤立條目移入房間「${slug}」：${facts}`
    : records.length === 1
      ? `房間「${slug}」新增整併紀錄：${facts}`
      : `房間「${slug}」新增 ${records.length} 筆整併紀錄：${facts}`;
  const ids = entries.map((e) => e.id);
  return proposal('roomRecord', tier, `${what}${overBudgetNote(run, tier)}`, {
    slug,
    records,
    source: `chronicle:${ids.join(',')}`,
    date: newestDate(entries),
    sweepEntryIds: ids,
  });
}

// §4 steps 1-2: cluster, route, distill; aged orphans to their room or archive.
async function chronicleProposals(run: PatrolRun): Promise<PatrolProposal[]> {
  const candidates = run.chronicle.filter((e) => !isHandoverEntry(e));
  if (candidates.length === 0) return [];
  const byId = new Map(candidates.map((e) => [e.id, e]));
  const aged = candidates.filter((e) => daysBetween(e.date, run.now) > run.budgets.patrolDays);
  const agedIds = new Set(aged.map((e) => e.id));
  // A tag decides the room before the model does; the model also re-applies
  // the gate to every aged entry (§4 step 2: orphans pass the same gate).
  const owners = new Map<string, string>();
  for (const e of aged) {
    const slug = tagOwner(run, e);
    if (slug) owners.set(e.id, slug);
  }
  const gateFailed = new Set<string>();

  let clusters: ClusterEntriesResult['clusters'] = [];
  if (candidates.length >= 2 || aged.length > 0) {
    const result = await judgeOrCancel<ClusterEntriesResult>(run, {
      ...clusterEntriesPrompt({ entries: candidates, agedIds, rooms: run.rooms }),
      schema: CLUSTER_ENTRIES_SCHEMA,
    });
    clusters = result.clusters ?? [];
    for (const o of result.orphans ?? []) {
      if (!agedIds.has(o.entryId)) continue;
      if (o.passesGate === false) gateFailed.add(o.entryId);
      if (!owners.has(o.entryId) && run.roomsBySlug.has(o.targetRoomSlug)) owners.set(o.entryId, o.targetRoomSlug);
    }
  }

  // A cluster is distilled only when it has somewhere to go: an existing
  // room, or (≥3 entries, §4 step 2) a proposed new room with a locus. The
  // rest stay unclustered — and may be orphans below.
  const used = new Set<string>();
  const jobs: DistillJob[] = [];
  for (const c of clusters) {
    const ids = [...new Set(c.entryIds ?? [])].filter((id) => byId.has(id) && !used.has(id));
    if (ids.length < 2) continue;
    const slug = c.targetRoomSlug ?? '';
    const locus = (c.newRoomLocus ?? []).map((l) => l.trim()).filter(Boolean);
    let target: DistillTarget;
    if (run.roomsBySlug.has(slug)) target = { slug };
    else if (ids.length >= 3 && (c.newRoomName ?? '').trim() && locus.length > 0)
      target = { create: { name: c.newRoomName.trim(), locus, adjacent: c.newRoomAdjacent ?? [] } };
    else continue;
    ids.forEach((id) => used.add(id));
    jobs.push({ entries: ids.map((id) => byId.get(id)!), target });
  }

  const verbatim: { slug: string; entry: CastleRecord }[] = [];
  const unowned: string[] = [];
  const gated: string[] = [];
  for (const e of aged) {
    if (used.has(e.id)) continue;
    const slug = owners.get(e.id);
    if (gateFailed.has(e.id)) gated.push(e.id);
    else if (!slug) unowned.push(e.id);
    else if (factProblem(e.fact, run.budgets.factMaxChars)) jobs.push({ entries: [e], target: { slug } }); // too long to move verbatim: distill it first
    else verbatim.push({ slug, entry: e });
  }

  const distilled = await mapWithConcurrency(jobs, LLM_CONCURRENCY, async (job) => {
    const result = await judgeOrCancel<DistillClusterResult>(run, {
      ...distillClusterPrompt({ entries: job.entries, factMaxChars: run.budgets.factMaxChars }),
      schema: DISTILL_CLUSTER_SCHEMA,
    });
    // DISTILL_CLUSTER_SCHEMA has no minItems/maxItems (see schemas.ts) —
    // the "1 to 8" bound the prompt asks for is guarded here instead.
    const all = (result.records ?? []).slice(0, MAX_DISTILLED_RECORDS);
    if (all.length === 0) return null;
    const records = all
      .filter((r) => r.passesGate !== false)
      .map((r) => ({ fact: r.fact, confidence: patrolConfidence(r.confidence), tags: r.tags ?? [] }));
    if (records.length === 0) return 'gated' as const; // every fact failed the re-applied gate: archive the entries
    const fitted = await fitDistilled(run, records);
    if (!fitted) {
      dropWarning(
        run,
        `chronicle:${job.entries.map((e) => e.id).join(',')}`,
        `整併結果重試一次後仍超過 ${run.budgets.factMaxChars} 字元或非單行，已捨棄；條目留在編年史待下次巡查`,
      );
    }
    return fitted;
  });

  const proposals: PatrolProposal[] = [];
  for (const [i, job] of jobs.entries()) {
    const records = distilled[i];
    if (records === 'gated') {
      gated.push(...job.entries.map((e) => e.id));
      continue;
    }
    if (!records) continue;
    if ('slug' in job.target) {
      proposals.push(roomRecordProposal(run, job.target.slug, records, job.entries, job.entries.length === 1));
      run.incoming.push({ slug: job.target.slug, label: job.target.slug, entries: job.entries });
      continue;
    }
    const { name, locus, adjacent } = job.target.create;
    run.incoming.push({ slug: null, label: name, entries: job.entries });
    const ids = job.entries.map((e) => e.id);
    const facts = records.map((r) => r.fact).join('；');
    proposals.push(
      proposal(
        'roomCreate',
        'yellow',
        records.length === 1 ? `建議新增房間「${name}」收納：${facts}` : `建議新增房間「${name}」收納 ${records.length} 筆整併紀錄：${facts}`,
        { name, locus, adjacent, records, source: `chronicle:${ids.join(',')}`, date: newestDate(job.entries), sweepEntryIds: ids },
      ),
    );
  }
  for (const { slug, entry } of verbatim) {
    const record: DistilledRecord = { fact: entry.fact, confidence: patrolConfidence(entry.confidence), tags: entry.tags };
    if (entry.routeWarning) record.routeWarning = entry.routeWarning;
    if (entry.verifiedAt) record.verifiedAt = entry.verifiedAt;
    proposals.push(roomRecordProposal(run, slug, [record], [entry], true));
    run.incoming.push({ slug, label: slug, entries: [entry] });
  }
  if (unowned.length > 0) {
    proposals.push(
      proposal('chronicleSweep', 'green', `封存 ${unowned.length} 筆逾 ${run.budgets.patrolDays} 天且無房間認領的孤立條目`, {
        entryIds: unowned,
        reason: 'orphan',
      }),
    );
  }
  if (gated.length > 0) {
    proposals.push(
      proposal('chronicleSweep', 'green', `封存 ${gated.length} 筆整併時未通過城門（可輕易重新得知或不會再用到）的條目`, {
        entryIds: gated,
        reason: 'gate',
      }),
    );
  }
  return proposals;
}

// §4 step 5d / 6: records already over factMaxChars (or multi-line) are split
// or shortened — green in rooms (unless the split overruns the room), yellow
// in keep. Hypotheses are left to their staleReview first: verifying or
// archiving comes before rewording.
async function splitProposals(run: PatrolRun): Promise<PatrolProposal[]> {
  const cap = run.budgets.factMaxChars;
  const targets = [
    ...run.keep.map((k) => ({ location: 'keep', record: k.record })),
    ...run.rooms.flatMap((room) => room.records.map((record) => ({ location: `room:${room.slug}`, record }))),
  ].filter((t) => factProblem(t.record.fact, cap) && !isStale(t.record, run.budgets, run.now));
  if (targets.length === 0) return [];

  const items = targets.map((t) => ({ key: t.record.id, fact: t.record.fact }));
  const fitted = await rewriteFacts(run, items, true, false);
  const again = items.filter((i) => !fitted.get(i.key));
  if (again.length > 0) {
    const retried = await rewriteFacts(run, again, true, true);
    for (const i of again) fitted.set(i.key, retried.get(i.key));
  }

  const proposals: PatrolProposal[] = [];
  for (const { location, record } of targets) {
    const facts = fitted.get(record.id);
    if (!facts) {
      dropWarning(run, `${location}:${record.id}`, `拆分結果重試一次後仍超過 ${cap} 字元或非單行，未提案`);
      continue;
    }
    const tier = location === 'keep' ? 'yellow' : reserveRoomSpace(run, location.slice('room:'.length), facts.length - 1);
    proposals.push(
      proposal(
        'recordSplit',
        tier,
        `拆分超長記錄（${locationLabel(location)}，${record.fact.length} 字元）為 ${facts.length} 筆：${facts.join('；')}${
          location === 'keep' ? '' : overBudgetNote(run, tier)
        }`,
        { location, recordId: record.id, facts },
      ),
    );
  }
  return proposals;
}

// §4 steps 5a / 6: a room over roomMax gets merge/cut proposals, keep over
// keepMax gets demote/archive proposals — all yellow, generated from the
// over-budget state the patrol found.
async function overBudgetProposals(run: PatrolRun): Promise<PatrolProposal[]> {
  const cap = run.budgets.factMaxChars;
  const proposals: PatrolProposal[] = [];
  const overRooms = run.rooms.filter((r) => r.records.length > run.budgets.roomMax);
  const results = await mapWithConcurrency(overRooms, LLM_CONCURRENCY, (room) =>
    judgeOrCancel<RoomDistillResult>(run, {
      ...roomDistillPrompt({ room, roomMax: run.budgets.roomMax, factMaxChars: cap }),
      schema: ROOM_DISTILL_SCHEMA,
    }),
  );

  for (const [i, room] of overRooms.entries()) {
    const result = results[i];
    const byId = new Map(room.records.map((r) => [r.id, r]));
    const claimed = new Set<string>();
    const merges: { ids: string[]; fact: string; tags: string[] }[] = [];
    for (const m of result.merges ?? []) {
      const ids = [...new Set(m.recordIds ?? [])].filter((id) => byId.has(id) && !claimed.has(id));
      if (ids.length < 2) continue;
      ids.forEach((id) => claimed.add(id));
      merges.push({ ids, fact: (m.fact ?? '').trim(), tags: m.tags ?? [] });
    }
    const bad = merges.map((m, k) => ({ key: `m${k}`, fact: m.fact })).filter((item) => factProblem(item.fact, cap));
    const rewritten = bad.length > 0 ? await rewriteFacts(run, bad, false, true) : new Map<string, string[] | undefined>();
    for (const [k, m] of merges.entries()) {
      const fact = factProblem(m.fact, cap) ? rewritten.get(`m${k}`)?.[0] : m.fact;
      if (!fact) {
        dropWarning(run, `room:${room.slug}`, `合併 ${m.ids.join(',')} 的結果重試一次後仍超過 ${cap} 字元或非單行，未提案`);
        continue;
      }
      const sources = m.ids.map((id) => byId.get(id)!);
      proposals.push(
        proposal('roomDistill', 'yellow', `房間「${room.slug}」超出預算：合併 ${m.ids.length} 筆為一筆：${fact}`, {
          slug: room.slug,
          action: 'merge',
          recordIds: m.ids,
          merged: { fact, confidence: lowestConfidence(sources), tags: m.tags, date: newestDate(sources) },
          reason: '合併近似重複的記錄',
        }),
      );
    }
    for (const cut of result.cuts ?? []) {
      const record = byId.get(cut.recordId);
      if (!record || claimed.has(cut.recordId)) continue;
      claimed.add(cut.recordId);
      proposals.push(
        proposal('roomDistill', 'yellow', `房間「${room.slug}」超出預算：封存 ${record.id}（${cut.reason}）：${record.fact}`, {
          slug: room.slug,
          action: 'cut',
          recordIds: [record.id],
          reason: cut.reason,
        }),
      );
    }
  }

  if (run.keep.length > run.budgets.keepMax) {
    const result = await judgeOrCancel<KeepCutResult>(run, {
      ...keepCutPrompt({ keepCount: run.keep.length, keepMax: run.budgets.keepMax }),
      context: run.castleMap,
      schema: KEEP_CUT_SCHEMA,
    });
    const keepById = new Map(run.keep.map((k) => [k.record.id, k.record]));
    const claimed = new Set<string>();
    for (const cut of result.cuts ?? []) {
      const record = keepById.get(cut.recordId);
      if (!record || claimed.has(cut.recordId)) continue;
      if (cut.action === 'demote' && !run.roomsBySlug.has(cut.targetRoomSlug)) continue;
      claimed.add(cut.recordId);
      const where = cut.action === 'demote' ? `降級到房間「${cut.targetRoomSlug}」` : '移入封存';
      proposals.push(
        proposal('keepCut', 'yellow', `keep 超出預算：${where}（${cut.reason}）：${record.fact}`, {
          recordId: record.id,
          action: cut.action,
          targetRoomSlug: cut.action === 'demote' ? cut.targetRoomSlug : '',
          reason: cut.reason,
        }),
      );
    }
  }
  return proposals;
}

type LocatedRecord = CastleRecord & { location: string };

// A contradiction unit is one room's records plus the chronicle entries this
// patrol moves into it (or the entries of a proposed new room). Units are
// packed into calls of at most CONTRADICTION_CHUNK_CHARS fact characters; a
// unit is never split, so every record is checked with its whole room.
function packUnits(units: LocatedRecord[][]): LocatedRecord[][] {
  const chunks: LocatedRecord[][] = [];
  let current: LocatedRecord[] = [];
  for (const unit of units) {
    const size = (rs: LocatedRecord[]) => rs.reduce((n, r) => n + r.fact.length, 0);
    if (current.length > 0 && size(current) + size(unit) > CONTRADICTION_CHUNK_CHARS) {
      chunks.push(current);
      current = [];
    }
    current.push(...unit);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// §4 step 3. Incremental (default): records new since the last patrol plus
// the entries this patrol moves into rooms, each checked against keep (in
// the shared castle map) plus its own room's records. Full: one pass over
// keep + every room (+ those entries). Always yellow.
async function contradictionProposals(run: PatrolRun): Promise<PatrolProposal[]> {
  const keepIds = new Set(run.keep.map((k) => k.record.id));
  const incomingIds = new Set(run.incoming.flatMap((i) => i.entries.map((e) => e.id)));
  const units: LocatedRecord[][] = [
    ...run.rooms.map((room) => [
      ...room.records.map((r) => ({ ...r, location: `room:${room.slug}` })),
      ...run.incoming.filter((i) => i.slug === room.slug).flatMap((i) => i.entries.map((e) => ({ ...e, location: `chronicle→room:${room.slug}` }))),
    ]),
    ...run.incoming.filter((i) => i.slug === null).map((i) => i.entries.map((e) => ({ ...e, location: `chronicle→新房間「${i.label}」` }))),
  ].filter((unit) => unit.length > 0);

  let chunks: LocatedRecord[][];
  let newIds: Set<string> | null = null;
  if (run.full) {
    chunks = [units.flat()];
  } else {
    const fresh = new Set(
      [...run.keep.map((k) => k.record), ...run.rooms.flatMap((r) => r.records)].filter((r) => isNewSincePatrol(run, r)).map((r) => r.id),
    );
    for (const id of incomingIds) fresh.add(id);
    if (fresh.size === 0) return [];
    newIds = fresh;
    chunks = packUnits(units.filter((unit) => unit.some((r) => fresh.has(r.id))));
    if (chunks.length === 0) chunks = [[]]; // only keep has new records
  }

  const results = await mapWithConcurrency(chunks, LLM_CONCURRENCY, async (records) => {
    const ids = new Set([...keepIds, ...records.map((r) => r.id)]);
    if (ids.size < 2) return { ids, contradictions: [] };
    const chunkNew = newIds ? new Set([...newIds].filter((id) => ids.has(id))) : null;
    const result = await judgeOrCancel<ContradictionCheckResult>(run, {
      ...contradictionCheckPrompt({ records, newIds: chunkNew }),
      context: run.castleMap,
      schema: CONTRADICTION_CHECK_SCHEMA,
    });
    return { ids, contradictions: result.contradictions ?? [] };
  });

  const proposals: PatrolProposal[] = [];
  const losers = new Set<string>();
  for (const { ids, contradictions } of results) {
    for (const c of contradictions) {
      if (c.loserId === c.winnerId || !ids.has(c.loserId) || !ids.has(c.winnerId) || losers.has(c.loserId)) continue;
      if (newIds && !newIds.has(c.loserId) && !newIds.has(c.winnerId)) continue;
      losers.add(c.loserId);
      proposals.push(
        proposal('contradiction', 'yellow', `矛盾：${c.loserId} 由 ${c.winnerId} 取代 — ${c.reason}`, {
          loserId: c.loserId,
          winnerId: c.winnerId,
          reason: c.reason,
        }),
      );
    }
  }
  return proposals;
}

// §4 step 6 promotion. Incremental: new room records plus the current
// chronicle; full: every room record plus the chronicle. Handovers never
// promote, and a fact over the cap can't move into keep verbatim. Always
// yellow (keep changes).
async function promotionProposals(run: PatrolRun): Promise<PatrolProposal[]> {
  const cap = run.budgets.factMaxChars;
  const roomRecords = run.rooms.flatMap((r) => r.records).filter((r) => run.full || isNewSincePatrol(run, r));
  const candidates = [...run.chronicle.filter((e) => !isHandoverEntry(e)), ...roomRecords].filter((r) => !factProblem(r.fact, cap));
  if (candidates.length === 0) return [];

  const result = await judgeOrCancel<KeepPromotionResult>(run, {
    ...keepPromotionPrompt({ candidates, currentKeepCount: run.keep.length, keepMax: run.budgets.keepMax }),
    context: run.castleMap,
    schema: KEEP_PROMOTION_SCHEMA,
  });
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const proposals: PatrolProposal[] = [];
  for (const p of result.promotions ?? []) {
    const record = byId.get(p.recordId);
    if (!record || seen.has(p.recordId)) continue;
    seen.add(p.recordId);
    proposals.push(
      proposal('keepPromotion', 'yellow', `建議晉升至 keep(${p.section})：${record.fact} — ${p.reason}`, {
        recordId: p.recordId,
        section: p.section,
        reason: p.reason,
      }),
    );
  }
  return proposals;
}

async function buildLlmProposals(run: PatrolRun): Promise<PatrolProposal[]> {
  const chronicle = await chronicleProposals(run);
  const splits = await splitProposals(run);
  const overBudget = await overBudgetProposals(run);
  const contradictions = await contradictionProposals(run);
  const promotions = await promotionProposals(run);
  // Contradictions are listed (and so applied) first: an approved one whose
  // loser is an entry this patrol would distill removes that entry before
  // the distill runs, which then reports not_found and leaves its cluster in
  // the chronicle instead of writing the losing fact into a room.
  return [...contradictions, ...chronicle, ...splits, ...overBudget, ...promotions];
}

export async function runPatrol(castle: Castle, llmService: LlmService, opts: RunPatrolOptions = {}): Promise<PatrolJob> {
  const key = castle.root;
  if (inFlight.has(key)) {
    throw new PatrolAlreadyRunningError();
  }

  // The controller registered here is what cancelPatrol() actually aborts;
  // an externally-supplied opts.signal (a caller's own AbortController, e.g.
  // a test) just bridges into it, so either trigger reaches the same judge
  // calls the same way.
  const controller = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  inFlight.set(key, controller);

  try {
    const warnings = await detectWarnings(castle);
    const run = await openRun(castle, llmService, controller.signal, opts.full === true, warnings);
    const proposals = [...handoverProposals(run), ...staleReviewProposals(run)];

    // instanceof only catches the static fallback; the dynamic config-driven
    // service surfaces "no key" as LlmNotConfiguredError from inside judge(),
    // so that must degrade the same way instead of failing the whole job.
    let complete = false;
    if (!(llmService instanceof NotConfiguredLlmService)) {
      try {
        proposals.push(...(await buildLlmProposals(run)));
        complete = true;
      } catch (err) {
        // A cancel must fail the whole job (not silently degrade like the
        // "no key" case) — the route maps this to 409 patrol_cancelled.
        if (err instanceof PatrolCancelledError) throw err;
        if (!(err instanceof LlmNotConfiguredError)) throw err;
      }
    }

    const job: PatrolJob = {
      id: generateId(),
      status: 'proposed',
      createdAt: localDate(),
      mode: run.full ? 'full' : 'incremental',
      complete,
      stats: run.stats,
      warnings: run.warnings,
      proposals,
    };
    jobStore.set(job.id, job);
    return job;
  } finally {
    inFlight.delete(key);
  }
}

// Aborts the in-flight patrol for the given key (castle.root — see
// `inFlight`'s comment) if one is running. Returns whether anything was
// actually aborted, so the route can 404 with patrol_not_running otherwise.
export function cancelPatrol(projectId: string): boolean {
  const controller = inFlight.get(projectId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function getPatrolJob(jobId: string): PatrolJob | undefined {
  return jobStore.get(jobId);
}

// --- apply -------------------------------------------------------------------

interface ApplyContext {
  budgets: Budgets;
  today: string;
}

// A record moving or being restated keeps its provenance: date, confidence,
// source, tags, routeWarning, verifiedAt.
function carriedInput(record: CastleRecord): RecordInput {
  const input: RecordInput = { date: record.date, confidence: record.confidence, source: record.source, fact: record.fact, tags: record.tags };
  if (record.routeWarning) input.routeWarning = record.routeWarning;
  if (record.verifiedAt) input.verifiedAt = record.verifiedAt;
  return input;
}

function distilledInput(r: DistilledRecord, source: string, date: string): RecordInput {
  const input: RecordInput = { date, confidence: r.confidence, source, fact: r.fact, tags: r.tags };
  if (r.routeWarning) input.routeWarning = r.routeWarning;
  if (r.verifiedAt) input.verifiedAt = r.verifiedAt;
  return input;
}

function allFit(facts: string[], ctx: ApplyContext): boolean {
  return facts.every((f) => !factProblem(f, ctx.budgets.factMaxChars));
}

// A blocked sweep (core sweepChronicle is all-or-nothing, like `castle.mjs
// sweep`) is a failed proposal, never an applied one: an id already gone or a
// promotedTo naming no room is not_found; the newest handover is refused.
function sweepFailure(b: SweepBlockers): ApplyFailureReason | null {
  if (b.refusedIds.length > 0) return 'newest_handover';
  if (b.unknownIds.length > 0 || b.unknownPromotedTo.length > 0) return 'not_found';
  return null;
}

function promotedToMap(ids: string[], to: string): Record<string, string> {
  return Object.fromEntries(ids.map((id) => [id, to]));
}

async function locateRecord(castle: Castle, location: string, id: string): Promise<{ record: CastleRecord; section?: KeepSection } | undefined> {
  if (location === 'keep') {
    for (const section of KEEP_SECTIONS) {
      const record = (await castle.keep.list(section)).find((r) => r.id === id);
      if (record) return { record, section };
    }
    return undefined;
  }
  const room = await castle.rooms.get(location.slice('room:'.length));
  const record = room?.records.find((r) => r.id === id);
  return record ? { record } : undefined;
}

// §4 step 8: a deletion leaves one chronicle note saying what went and why.
// The note is code-built, so its quote of the deleted fact is elided to fit
// the cap.
function deletionNote(record: CastleRecord, location: string, cap: number): string {
  const head = `巡查刪除已證偽記錄 ${record.id}（${locationLabel(location)}，使用者判定錯誤）：`;
  const flat = record.fact.replace(/\s*[\r\n]+\s*/g, ' ');
  const room = cap - head.length - 2;
  if (room < 2) return `巡查刪除記錄 ${record.id}`.slice(0, cap);
  const excerpt = flat.length <= room ? flat : `${flat.slice(0, room - 1)}…`;
  return `${head}「${excerpt}」`;
}

// §4 step 2: a new room must be on the patrol route — an all-rooms stop
// already covers it, otherwise an explicit room:<slug> stop is added.
async function ensurePatrolCovers(castle: Castle, slug: string): Promise<void> {
  const patrol = await castle.routes.get('patrol');
  if (!patrol || patrol.stops.some((s) => s.target === 'all-rooms' || s.target === `room:${slug}`)) return;
  await castle.routes.update('patrol', { stops: [...patrol.stops, { target: `room:${slug}`, read: 'all' }] });
}

async function applyProposal(
  castle: Castle,
  proposal: PatrolProposal,
  decision: StaleDecision | undefined,
  ctx: ApplyContext,
): Promise<ApplyFailureReason | null> {
  const { roomMax, factMaxChars } = ctx.budgets;
  switch (proposal.kind) {
    case 'roomRecord': {
      const p = proposal.payload as RoomRecordPayload;
      // An entry already swept (e.g. by another proposal of this job) must
      // not be distilled twice.
      const blocked = sweepFailure(await castle.sweepBlockers(p.sweepEntryIds));
      if (blocked) return blocked;
      const room = await castle.rooms.get(p.slug);
      if (!room) return 'not_found';
      if (!allFit(p.records.map((r) => r.fact), ctx)) return 'fact_too_long';
      if (proposal.tier === 'green' && room.records.length + p.records.length > roomMax) return 'over_budget';
      for (const r of p.records) await castle.rooms.appendRecord(p.slug, distilledInput(r, p.source, p.date));
      return sweepFailure(await castle.sweepChronicle(p.sweepEntryIds, promotedToMap(p.sweepEntryIds, p.slug)));
    }
    case 'roomCreate': {
      const p = proposal.payload as RoomCreatePayload;
      const blocked = sweepFailure(await castle.sweepBlockers(p.sweepEntryIds));
      if (blocked) return blocked;
      if (!allFit(p.records.map((r) => r.fact), ctx)) return 'fact_too_long';
      const room = await castle.rooms.append({ name: p.name, locus: p.locus, adjacent: p.adjacent });
      await ensurePatrolCovers(castle, room.slug);
      for (const r of p.records) await castle.rooms.appendRecord(room.slug, distilledInput(r, p.source, p.date));
      return sweepFailure(await castle.sweepChronicle(p.sweepEntryIds, promotedToMap(p.sweepEntryIds, room.slug)));
    }
    case 'contradiction': {
      const p = proposal.payload as ContradictionPayload;
      // §4 step 3 via core supersede: a chronicle loser is swept; a room (or,
      // once approved, keep) loser goes to archive/room-records-YYYY-MM.json
      // with archiveNote "superseded by <winner>: <reason>".
      await castle.supersede(p.loserId, p.winnerId, p.reason);
      return null;
    }
    case 'keepPromotion': {
      const p = proposal.payload as KeepPromotionPayload;
      const entry = await castle.chronicle.get(p.recordId);
      let original = entry;
      let fromRoom: string | undefined;
      if (!original) {
        for (const room of await castle.rooms.list()) {
          original = room.records.find((r) => r.id === p.recordId);
          if (original) {
            fromRoom = room.slug;
            break;
          }
        }
      }
      if (!original) return 'not_found';
      if (!allFit([original.fact], ctx)) return 'fact_too_long';
      if (entry) {
        const blocked = sweepFailure(await castle.sweepBlockers([entry.id], { [entry.id]: 'keep' }));
        if (blocked) return blocked;
      }
      // Write keep first: a crash in between duplicates, never loses.
      await castle.keep.append(p.section, carriedInput(original));
      if (entry) return sweepFailure(await castle.sweepChronicle([entry.id], { [entry.id]: 'keep' }));
      await castle.rooms.removeRecord(fromRoom!, p.recordId);
      return null;
    }
    case 'chronicleSweep': {
      const p = proposal.payload as ChronicleSweepPayload;
      return sweepFailure(await castle.sweepChronicle(p.entryIds));
    }
    case 'staleReview': {
      const p = proposal.payload as StaleReviewPayload;
      const found = await locateRecord(castle, p.location, p.record.id);
      if (!found) return 'not_found';
      if (decision === 'verify') {
        if (p.location === 'keep') await castle.keep.update(p.record.id, { verifiedAt: ctx.today });
        else await castle.rooms.updateRecord(p.location.slice('room:'.length), p.record.id, { verifiedAt: ctx.today });
      } else if (decision === 'archive') {
        await castle.archiveRecord(p.record.id, '巡查衰減：無法驗證，移入封存');
      } else {
        if (p.location === 'keep') await castle.keep.remove(p.record.id);
        else await castle.rooms.removeRecord(p.location.slice('room:'.length), p.record.id);
        await castle.chronicle.append({
          confidence: 'high',
          source: 'patrol',
          fact: deletionNote(found.record, p.location, factMaxChars),
          tags: ['patrol', 'deletion'],
        });
      }
      return null;
    }
    case 'recordSplit': {
      const p = proposal.payload as RecordSplitPayload;
      if (!allFit(p.facts, ctx)) return 'fact_too_long';
      const found = await locateRecord(castle, p.location, p.recordId);
      if (!found) return 'not_found';
      if (p.location === 'keep') {
        for (const fact of p.facts) await castle.keep.append(found.section!, { ...carriedInput(found.record), fact });
        await castle.keep.remove(p.recordId);
      } else {
        const slug = p.location.slice('room:'.length);
        const room = await castle.rooms.get(slug);
        if (proposal.tier === 'green' && room!.records.length - 1 + p.facts.length > roomMax) return 'over_budget';
        for (const fact of p.facts) await castle.rooms.appendRecord(slug, { ...carriedInput(found.record), fact });
        await castle.rooms.removeRecord(slug, p.recordId);
      }
      return null;
    }
    case 'roomDistill': {
      const p = proposal.payload as RoomDistillPayload;
      const room = await castle.rooms.get(p.slug);
      if (!room) return 'not_found';
      const live = new Set(room.records.map((r) => r.id));
      if (!p.recordIds.every((id) => live.has(id))) return 'not_found';
      if (p.action === 'cut') {
        await castle.archiveRecord(p.recordIds[0], `巡查裁減（房間超出預算）：${p.reason}`);
        return null;
      }
      const m = p.merged!;
      if (!allFit([m.fact], ctx)) return 'fact_too_long';
      // The originals end up in archive/room-records-YYYY-MM.json; the merged record cites them there.
      const merged = await castle.rooms.appendRecord(p.slug, {
        date: m.date,
        confidence: m.confidence,
        source: `archive:${p.recordIds.join(',')}`,
        fact: m.fact,
        tags: m.tags,
      });
      for (const id of p.recordIds) await castle.archiveRecord(id, `巡查合併為 ${merged.id}`);
      return null;
    }
    case 'keepCut': {
      const p = proposal.payload as KeepCutPayload;
      const record = await castle.keep.get(p.recordId);
      if (!record) return 'not_found';
      if (p.action === 'archive') {
        await castle.archiveRecord(p.recordId, `巡查裁減 keep（超出預算）：${p.reason}`);
        return null;
      }
      if (!(await castle.rooms.get(p.targetRoomSlug))) return 'not_found';
      if (!allFit([record.fact], ctx)) return 'fact_too_long';
      await castle.rooms.appendRecord(p.targetRoomSlug, carriedInput(record));
      await castle.keep.remove(p.recordId);
      return null;
    }
    default:
      return null;
  }
}

export async function applyPatrolJob(
  castle: Castle,
  jobId: string,
  approvals: string[],
  decisions: Record<string, StaleDecision> = {},
): Promise<PatrolJob> {
  const job = jobStore.get(jobId);
  if (!job) throw new NotFoundError(`patrol job ${jobId}`);

  const { budgets } = await castle.getMeta();
  const ctx: ApplyContext = { budgets, today: localDate() };
  const approvalSet = new Set(approvals);
  const appliedIds: string[] = [];
  const skippedYellowIds: string[] = [];
  const failed: PatrolApplyReport['failed'] = [];

  for (const proposal of job.proposals) {
    // A staleReview needs the user's pick (verify / archive / delete), not
    // just a yes.
    const decision = decisions[proposal.id];
    const shouldApply = proposal.kind === 'staleReview' ? decision !== undefined : proposal.tier === 'green' || approvalSet.has(proposal.id);
    if (!shouldApply) {
      skippedYellowIds.push(proposal.id);
      continue;
    }
    let failure: ApplyFailureReason | null;
    try {
      failure = await applyProposal(castle, proposal, decision, ctx);
    } catch (err) {
      if (err instanceof SweepRefusedError) failure = 'newest_handover';
      else if (err instanceof NotFoundError) failure = 'not_found';
      else throw err;
    }
    if (failure) failed.push({ id: proposal.id, reason: failure });
    else appliedIds.push(proposal.id);
  }

  // Contract C6 / §4 close: a completed patrol stamps today. A key-less run
  // (no LLM steps) is not complete and leaves the date alone.
  const patrolledAt = job.complete ? (await castle.markPatrolled()).lastPatrolAt : null;

  job.status = 'applied';
  job.applyReport = { appliedIds, skippedYellowIds, failed, patrolledAt };
  return job;
}
