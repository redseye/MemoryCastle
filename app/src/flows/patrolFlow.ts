// patrolFlow: the consolidation patrol (plan §4, architecture §4). Produces
// a PROPOSAL list tagged green (auto-applicable: chronicle sweeps, appending
// a distilled record to an EXISTING room) or yellow (needs human approval:
// room creation, contradiction resolution/supersede, keep promotion) — per
// the explicit tiering given for M4. apply() executes green proposals plus
// only the yellow proposals whose id appears in `approvals`, and only ever
// through core ops (sweepChronicle, supersede, rooms/keep collections) —
// never a free-form write.
//
// A deterministic pre-pass (budgets, staleness, route-gaps) always runs
// first and needs no LLM at all — it produces `warnings` on the job even
// when the LLM service is unconfigured (a NotConfiguredLlmService), so
// POST /patrol never has to 409: the patrol page stays useful before a key
// is set, matching the plan's "deterministic endpoints are unaffected"
// principle. The LLM-driven clustering/contradiction/promotion steps that
// produce `proposals` are skipped entirely in that case (empty list), not
// attempted and swallowed.
//
// Job store is an in-memory Map, fine for a single-process local tool (plan
// §4). runPatrol resolves synchronously (all LLM calls awaited inside the
// same call) rather than truly backgrounding the work: for a local tool the
// whole pipeline finishes well within one HTTP request/response cycle, and
// synchronous completion keeps the propose/apply contract deterministic and
// simple to test. The job abstraction (jobId, GET-by-id) is kept so the Web
// UI (M5) can still poll/display it the same way once patrol grows slow
// enough to want real backgrounding.

import { generateId, localDate } from '../core/ids.js';
import { NotFoundError } from '../core/errors.js';
import { isStale } from '../core/budgets.js';
import type { Castle } from '../core/castle.js';
import type { CastleRecord, Confidence, KeepSection } from '../core/types.js';
import { LlmNotConfiguredError, NotConfiguredLlmService } from '../server/llm-seam.js';
import type { LlmService } from '../server/llm-seam.js';
import {
  CLUSTER_ENTRIES_SCHEMA,
  CONTRADICTION_CHECK_SCHEMA,
  DISTILL_CLUSTER_SCHEMA,
  KEEP_PROMOTION_SCHEMA,
  ROOM_PROPOSAL_SCHEMA,
} from '../llm/schemas.js';
import {
  clusterEntriesPrompt,
  contradictionCheckPrompt,
  distillClusterPrompt,
  keepPromotionPrompt,
  roomProposalPrompt,
} from '../llm/prompts.js';

export type ProposalKind = 'roomRecord' | 'roomCreate' | 'contradiction' | 'keepPromotion';
export type ProposalTier = 'green' | 'yellow';

export interface DistilledRecord {
  fact: string;
  confidence: Confidence;
  tags: string[];
}

export interface RoomRecordPayload {
  slug: string;
  records: DistilledRecord[];
  source: string;
  sweepEntryIds: string[];
}

export interface RoomCreatePayload {
  name: string;
  locus: string[];
  adjacent: string[];
  records: DistilledRecord[];
  source: string;
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

export type ProposalPayload = RoomRecordPayload | RoomCreatePayload | ContradictionPayload | KeepPromotionPayload;

export interface PatrolProposal {
  id: string;
  kind: ProposalKind;
  tier: ProposalTier;
  summary: string;
  payload: ProposalPayload;
}

export interface PatrolApplyReport {
  appliedIds: string[];
  skippedYellowIds: string[];
}

export type WarningKind = 'over-budget' | 'stale' | 'route-gap';

export interface PatrolWarning {
  kind: WarningKind;
  target: string;
  detail: string;
}

export interface PatrolJob {
  id: string;
  status: 'proposed' | 'applied';
  createdAt: string;
  warnings: PatrolWarning[];
  proposals: PatrolProposal[];
  applyReport?: PatrolApplyReport;
}

const jobStore = new Map<string, PatrolJob>();

interface DistillClusterResult {
  records: DistilledRecord[];
}

interface ClusterEntriesResult {
  clusters: { entryIds: string[]; locus: string; topic: string }[];
}

interface RoomProposalResult {
  targetRoomSlug: string;
  name: string;
  locus: string[];
  adjacent: string[];
  reason: string;
}

interface ContradictionCheckResult {
  contradictions: { loserId: string; winnerId: string; reason: string }[];
}

interface KeepPromotionResult {
  promotions: { recordId: string; section: KeepSection; reason: string }[];
}

const PATROL_SOURCE = 'patrol';

// Deterministic pre-pass, step 1: budgets (architecture §4 trigger
// thresholds) — keep/room over max, chronicle at-or-past the sweep count.
async function detectBudgetWarnings(castle: Castle): Promise<PatrolWarning[]> {
  const warnings: PatrolWarning[] = [];
  const meta = await castle.getMeta();
  const counts = await castle.countBudgets();

  if (counts.keepCount > meta.budgets.keepMax) {
    warnings.push({ kind: 'over-budget', target: 'keep', detail: `keep ${counts.keepCount}/${meta.budgets.keepMax}，超過上限` });
  }
  for (const room of counts.rooms) {
    if (room.count > meta.budgets.roomMax) {
      warnings.push({
        kind: 'over-budget',
        target: `room:${room.slug}`,
        detail: `${room.count}/${meta.budgets.roomMax}，超過上限`,
      });
    }
  }
  if (counts.chronicleCount >= meta.budgets.chronicleSweep) {
    warnings.push({
      kind: 'over-budget',
      target: 'chronicle',
      detail: `${counts.chronicleCount}/${meta.budgets.chronicleSweep}，已達整理門檻`,
    });
  }
  return warnings;
}

// Deterministic pre-pass, step 2: staleness (architecture §2/§4) over every
// keep and room record — >90 days old or conf:low.
async function detectStaleWarnings(castle: Castle): Promise<PatrolWarning[]> {
  const warnings: PatrolWarning[] = [];
  const now = new Date();

  const keepRecords = await castle.keep.list();
  for (const r of keepRecords) {
    if (isStale(r, now)) {
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
      if (isStale(r, now)) {
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

async function buildProposals(castle: Castle, llmService: LlmService): Promise<PatrolProposal[]> {
  const proposals: PatrolProposal[] = [];

  // Steps 1-2: cluster unswept chronicle entries, distill each cluster, and
  // decide whether it belongs in an existing room (green) or needs a new one
  // (yellow — room creation is never auto-applied).
  const chronicleEntries = await castle.chronicle.list();
  if (chronicleEntries.length >= 2) {
    const clusterResult = await llmService.judge<ClusterEntriesResult>({
      ...clusterEntriesPrompt({ entries: chronicleEntries }),
      schema: CLUSTER_ENTRIES_SCHEMA,
    });

    const rooms = await castle.rooms.list();
    const roomsBySlug = new Map(rooms.map((r) => [r.slug, r]));

    for (const cluster of clusterResult.clusters) {
      const clusterEntries = chronicleEntries.filter((e) => cluster.entryIds.includes(e.id));
      if (clusterEntries.length < 2) continue;

      const distillResult = await llmService.judge<DistillClusterResult>({
        ...distillClusterPrompt({ entries: clusterEntries }),
        schema: DISTILL_CLUSTER_SCHEMA,
      });
      // DISTILL_CLUSTER_SCHEMA has no minItems/maxItems (see schemas.ts
      // comment) — guard the "1 to 8" bound the prompt asks for here instead.
      const records = distillResult.records.slice(0, 8);
      if (records.length === 0) continue;

      const roomDecision = await llmService.judge<RoomProposalResult>({
        ...roomProposalPrompt({
          cluster: { entryIds: cluster.entryIds, locus: cluster.locus, topic: cluster.topic },
          rooms: rooms.map((r) => ({ slug: r.slug, name: r.name, locus: r.locus, adjacent: r.adjacent })),
        }),
        schema: ROOM_PROPOSAL_SCHEMA,
      });

      const facts = records.map((r) => r.fact).join('；');

      if (roomDecision.targetRoomSlug && roomsBySlug.has(roomDecision.targetRoomSlug)) {
        proposals.push({
          id: generateId(),
          kind: 'roomRecord',
          tier: 'green',
          summary:
            records.length === 1
              ? `房間「${roomDecision.targetRoomSlug}」新增整併紀錄：${records[0].fact}`
              : `房間「${roomDecision.targetRoomSlug}」新增 ${records.length} 筆整併紀錄：${facts}`,
          payload: {
            slug: roomDecision.targetRoomSlug,
            records,
            source: PATROL_SOURCE,
            sweepEntryIds: cluster.entryIds,
          },
        });
      } else if (cluster.entryIds.length >= 3) {
        proposals.push({
          id: generateId(),
          kind: 'roomCreate',
          tier: 'yellow',
          summary:
            records.length === 1
              ? `建議新增房間「${roomDecision.name}」收納：${records[0].fact}`
              : `建議新增房間「${roomDecision.name}」收納 ${records.length} 筆整併紀錄：${facts}`,
          payload: {
            name: roomDecision.name,
            locus: roomDecision.locus,
            adjacent: roomDecision.adjacent,
            records,
            source: PATROL_SOURCE,
            sweepEntryIds: cluster.entryIds,
          },
        });
      }
      // Fewer than 3 entries and no existing room fits: leave in chronicle
      // for a future patrol rather than force a room into existence.
    }
  }

  // Step 3: contradictions across keep + all rooms. Always yellow (supersede).
  const keepRecords = await castle.keep.list();
  const rooms = await castle.rooms.list();
  const allRecords: (CastleRecord & { location: string })[] = [
    ...keepRecords.map((r) => ({ ...r, location: 'keep' })),
    ...rooms.flatMap((room) => room.records.map((r) => ({ ...r, location: `room:${room.slug}` }))),
  ];
  if (allRecords.length >= 2) {
    const contradictionResult = await llmService.judge<ContradictionCheckResult>({
      ...contradictionCheckPrompt({ records: allRecords }),
      schema: CONTRADICTION_CHECK_SCHEMA,
    });
    for (const c of contradictionResult.contradictions) {
      proposals.push({
        id: generateId(),
        kind: 'contradiction',
        tier: 'yellow',
        summary: `矛盾：${c.loserId} 由 ${c.winnerId} 取代 — ${c.reason}`,
        payload: { loserId: c.loserId, winnerId: c.winnerId, reason: c.reason },
      });
    }
  }

  // Step 6: keep promotion candidates. Always yellow (keep changes).
  const promotionCandidates = [...chronicleEntries, ...rooms.flatMap((r) => r.records)];
  if (promotionCandidates.length > 0) {
    const meta = await castle.getMeta();
    const keepResult = await llmService.judge<KeepPromotionResult>({
      ...keepPromotionPrompt({
        candidates: promotionCandidates,
        currentKeepCount: keepRecords.length,
        keepMax: meta.budgets.keepMax,
      }),
      schema: KEEP_PROMOTION_SCHEMA,
    });
    for (const p of keepResult.promotions) {
      proposals.push({
        id: generateId(),
        kind: 'keepPromotion',
        tier: 'yellow',
        summary: `建議晉升至 keep(${p.section})：${p.recordId} — ${p.reason}`,
        payload: { recordId: p.recordId, section: p.section, reason: p.reason },
      });
    }
  }

  return proposals;
}

export async function runPatrol(castle: Castle, llmService: LlmService): Promise<PatrolJob> {
  const warnings = await detectWarnings(castle);

  // The deterministic pre-pass never needs a key; the LLM-driven clustering/
  // contradiction/promotion steps do, and degrade to zero proposals (not a
  // 409) when no provider is configured — a patrol job is still useful
  // (budgets, staleness, route gaps) before the user ever sets a key.
  // instanceof only catches the static fallback; the dynamic config-driven
  // service surfaces "no key" as LlmNotConfiguredError from inside judge(),
  // so that must degrade the same way instead of failing the whole job.
  let proposals: PatrolProposal[] = [];
  if (!(llmService instanceof NotConfiguredLlmService)) {
    try {
      proposals = await buildProposals(castle, llmService);
    } catch (err) {
      if (!(err instanceof LlmNotConfiguredError)) throw err;
      proposals = [];
    }
  }

  const job: PatrolJob = { id: generateId(), status: 'proposed', createdAt: localDate(), warnings, proposals };
  jobStore.set(job.id, job);
  return job;
}

export function getPatrolJob(jobId: string): PatrolJob | undefined {
  return jobStore.get(jobId);
}

// Finds a record by id in chronicle or any room, removes it from wherever it
// lives, and returns it — used to promote a record into keep.
async function findAndRemoveOutsideKeep(castle: Castle, id: string): Promise<CastleRecord | undefined> {
  const chronicleRecord = await castle.chronicle.get(id);
  if (chronicleRecord) {
    await castle.chronicle.remove(id);
    return chronicleRecord;
  }
  for (const room of await castle.rooms.list()) {
    const found = room.records.find((r) => r.id === id);
    if (found) {
      await castle.rooms.removeRecord(room.slug, id);
      return found;
    }
  }
  return undefined;
}

export async function applyPatrolJob(castle: Castle, jobId: string, approvals: string[]): Promise<PatrolJob> {
  const job = jobStore.get(jobId);
  if (!job) throw new NotFoundError(`patrol job ${jobId}`);

  const approvalSet = new Set(approvals);
  const appliedIds: string[] = [];
  const skippedYellowIds: string[] = [];

  for (const proposal of job.proposals) {
    const shouldApply = proposal.tier === 'green' || approvalSet.has(proposal.id);
    if (!shouldApply) {
      skippedYellowIds.push(proposal.id);
      continue;
    }

    switch (proposal.kind) {
      case 'roomRecord': {
        const p = proposal.payload as RoomRecordPayload;
        for (const r of p.records) {
          await castle.rooms.appendRecord(p.slug, { confidence: r.confidence, source: p.source, fact: r.fact, tags: r.tags });
        }
        await castle.sweepChronicle(p.sweepEntryIds);
        break;
      }
      case 'roomCreate': {
        const p = proposal.payload as RoomCreatePayload;
        const room = await castle.rooms.append({ name: p.name, locus: p.locus, adjacent: p.adjacent });
        for (const r of p.records) {
          await castle.rooms.appendRecord(room.slug, { confidence: r.confidence, source: p.source, fact: r.fact, tags: r.tags });
        }
        await castle.sweepChronicle(p.sweepEntryIds);
        break;
      }
      case 'contradiction': {
        const p = proposal.payload as ContradictionPayload;
        await castle.supersede(p.loserId, p.winnerId, p.reason);
        break;
      }
      case 'keepPromotion': {
        const p = proposal.payload as KeepPromotionPayload;
        const original = await findAndRemoveOutsideKeep(castle, p.recordId);
        if (original) {
          await castle.keep.append(p.section, {
            confidence: original.confidence,
            source: original.source,
            fact: original.fact,
            tags: original.tags,
          });
        }
        break;
      }
      default:
        break;
    }
    appliedIds.push(proposal.id);
  }

  job.status = 'applied';
  job.applyReport = { appliedIds, skippedYellowIds };
  return job;
}
