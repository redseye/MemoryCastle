// English prompt skeletons for the 7 judgment tasks (plan §4). Candidate
// fact/record content is Traditional Chinese and is always passed through
// verbatim — never translated or paraphrased by the skeleton text itself.

import type { CastleRecord } from '../core/index.js';

export interface PromptPair {
  system: string;
  user: string;
}

function formatRecord(r: { id: string; date: string; confidence: string; source: string; fact: string; tags: string[] }): string {
  return `[id:${r.id} | ${r.date} | conf:${r.confidence} | src:${r.source} | tags:${r.tags.join(',')}] ${r.fact}`;
}

// --- gateDecision -----------------------------------------------------

export interface GateDecisionInput {
  text: string;
  source: string;
}

export function gateDecisionPrompt(input: GateDecisionInput): PromptPair {
  return {
    system: `You are the admission gate ("gatehouse") for a MemoryCastle project memory store.
Decide whether a candidate memory passes ALL three gatehouse tests, and whether it must be hard-rejected.

- novel: not derivable in under a minute from the repo, git history, or existing docs.
- reusable: a plausible future session will actually need this; if rediscovery is cheap, it fails this test.
- verifiable: it is one clear, checkable line with a "why" when it states a decision (e.g. "chose X over Y because Z"), not vague speculation.
- secretRefusal: set to true (hard rejection, overrides the other three) if the candidate is a secret, token, credential, third-party personal data, or anything that should never be committed to a file the whole team can read.

The candidate text may be written in Traditional Chinese. Judge its meaning; do not translate or rewrite it.
Respond only via the required JSON schema. "reason" should briefly explain the decision in Traditional Chinese.`,
    user: `Candidate fact (source: ${input.source}):\n${input.text}`,
  };
}

// --- distill ------------------------------------------------------------

export interface DistillInput {
  text: string;
  source: string;
}

export function distillPrompt(input: DistillInput): PromptPair {
  return {
    system: `Distill the candidate text into exactly one memory record for a MemoryCastle chronicle.
- fact: one line, Traditional Chinese, the same language and facts as the input — do not add information that was not present.
- confidence: "high" if verified this session (ran/read it), "med" if user-stated or observed once, "low" if inferred.
- tags: short lowercase or Traditional Chinese keyword tags (no leading #), 0-5 tags.
Respond only via the required JSON schema.`,
    user: `Source: ${input.source}\nText:\n${input.text}`,
  };
}

export interface DistillClusterInput {
  entries: CastleRecord[];
}

export function distillClusterPrompt(input: DistillClusterInput): PromptPair {
  const lines = input.entries.map((e) => formatRecord(e)).join('\n');
  return {
    system: `Distill the following related chronicle entries into a room, per MemoryCastle's consolidation patrol.
Distill the cluster into the smallest set of single-fact records: one record per distinct fact; merge near-duplicates into one line; never fuse two distinct facts into one record.
- fact: one line, Traditional Chinese, stating exactly one distinct fact the entries establish.
- confidence: for each record, the lowest confidence among the entries supporting THAT record (never upgrade confidence by merging).
- tags: per record, the union of relevant tags from its supporting entries, deduplicated, at most 6.
Produce between 1 and 8 records — as few as the distinct facts allow.
Respond only via the required JSON schema.`,
    user: `Entries to merge:\n${lines}`,
  };
}

// --- clusterEntries -------------------------------------------------------

export interface ClusterEntriesInput {
  entries: CastleRecord[];
}

export function clusterEntriesPrompt(input: ClusterEntriesInput): PromptPair {
  const lines = input.entries.map((e) => formatRecord(e)).join('\n');
  return {
    system: `You are running step 1 of a MemoryCastle consolidation patrol: cluster unswept chronicle entries by place (locus) first, topic second.
Only group entries that are genuinely related (same place/subsystem/activity, or the same topic). A cluster must have at least 2 entries — do not output a cluster of 1.
An entry may appear in at most one cluster. Entries that don't fit any cluster are simply omitted from the output.
For each cluster, "locus" is your best short description of the place/subsystem/activity the cluster is about (e.g. a directory glob like "src/server/**", or an activity name like "部署活動" in Traditional Chinese) — this is a candidate locus, not necessarily an existing room.
Respond only via the required JSON schema.`,
    user: `Unswept chronicle entries:\n${lines}`,
  };
}

// --- roomProposal ---------------------------------------------------------

export interface RoomProposalInput {
  cluster: { entryIds: string[]; locus: string; topic: string };
  rooms: { slug: string; name: string; locus: string[]; adjacent: string[] }[];
}

export function roomProposalPrompt(input: RoomProposalInput): PromptPair {
  const roomLines =
    input.rooms.length > 0
      ? input.rooms.map((r) => `- ${r.slug} "${r.name}" locus:[${r.locus.join(', ')}] adjacent:[${r.adjacent.join(', ')}]`).join('\n')
      : '(no rooms exist yet)';
  return {
    system: `You are running step 2 of a MemoryCastle consolidation patrol: decide where a cluster of chronicle entries belongs.
Given the cluster's candidate locus/topic and the list of existing rooms, decide:
- If an existing room's locus already covers this cluster's place/topic, set targetRoomSlug to that room's slug and leave name/locus/adjacent as empty strings/empty arrays.
- Otherwise (no existing room fits), set targetRoomSlug to "" and propose a new room: name (Traditional Chinese), locus (array of path globs or activity names), adjacent (array of related room slugs or names, may be empty).
Only propose a brand-new room when the cluster represents a real, reusable place someone would say they are "in" — not a one-off.
Respond only via the required JSON schema. "reason" is a short Traditional Chinese explanation.`,
    user: `Cluster locus: ${input.cluster.locus}\nCluster topic: ${input.cluster.topic}\nEntry ids: ${input.cluster.entryIds.join(', ')}\n\nExisting rooms:\n${roomLines}`,
  };
}

// --- contradictionCheck -----------------------------------------------------

export interface ContradictionCheckInput {
  records: (CastleRecord & { location: string })[];
}

export function contradictionCheckPrompt(input: ContradictionCheckInput): PromptPair {
  const lines = input.records.map((r) => `${formatRecord(r)} [at:${r.location}]`).join('\n');
  return {
    system: `You are running step 3 of a MemoryCastle consolidation patrol: find direct factual contradictions among these keep/room records.
Two records contradict only if they cannot both be true about the same subject (not merely "different but compatible" facts). When you find a contradiction, the newer, better-sourced record wins (loserId = the older/weaker one); never propose both records as losers of each other.
Only report genuine contradictions; if none exist, return an empty list.
Respond only via the required JSON schema. "reason" is a short Traditional Chinese explanation citing both ids.`,
    user: `Records:\n${lines}`,
  };
}

// --- keepPromotion -----------------------------------------------------

export interface KeepPromotionInput {
  candidates: CastleRecord[];
  currentKeepCount: number;
  keepMax: number;
}

export function keepPromotionPrompt(input: KeepPromotionInput): PromptPair {
  const lines = input.candidates.map((r) => formatRecord(r)).join('\n');
  return {
    system: `You are running step 6 of a MemoryCastle consolidation patrol: decide which of these candidate records (currently in chronicle or a room) deserve promotion into keep — the always-loaded entrance hall.
Keep is a scarce budget (currently ${input.currentKeepCount}/${input.keepMax} records) — only promote what most sessions actually need: identity facts, hard constraints, or core cross-cutting rules. Most candidates should NOT be promoted.
Assign each promotion to a section: "identity" (who/what this project is), "constraints" (hard rules that must not be violated), or "core" (other load-bearing facts).
If nothing deserves promotion, return an empty list.
Respond only via the required JSON schema. "reason" is a short Traditional Chinese explanation.`,
    user: `Candidates:\n${lines}`,
  };
}

// --- fuzzyRoomSelect -----------------------------------------------------

export interface FuzzyRoomSelectInput {
  paths: string[];
  rooms: { slug: string; name: string; locus: string[]; adjacent: string[] }[];
}

export function fuzzyRoomSelectPrompt(input: FuzzyRoomSelectInput): PromptPair {
  const roomLines = input.rooms.map((r) => `- ${r.slug} "${r.name}" locus:[${r.locus.join(', ')}] adjacent:[${r.adjacent.join(', ')}]`).join('\n');
  return {
    system: `Deterministic locus matching (exact path/glob match) found no room, or an ambiguous set, for the given paths/activity. Use semantic judgment to pick the room(s) that most plausibly own this work, from the list below.
Return an empty roomSlugs list if truly nothing fits — do not force a match.
Respond only via the required JSON schema. "reason" is a short Traditional Chinese explanation.`,
    user: `Paths/activity: ${input.paths.join(', ') || '(none given)'}\n\nRooms:\n${roomLines}`,
  };
}
