// English prompt skeletons for the LLM judgment tasks (plan §4; v0.5 set).
// Candidate fact/record content is Traditional Chinese and is always passed
// through verbatim — never translated or paraphrased by the skeleton text
// itself. Every prompt that asks the model to WRITE a fact states the
// architecture §2 cap (factRule); the flows still check it in code.

import type { CastleRecord, KeepSection } from '../core/index.js';

export interface PromptPair {
  system: string;
  user: string;
}

function formatRecord(r: CastleRecord): string {
  const ver = r.verifiedAt ? ` | ver:${r.verifiedAt}` : '';
  return `[id:${r.id} | ${r.date} | conf:${r.confidence} | src:${r.source}${ver} | tags:${r.tags.join(',')}] ${r.fact}`;
}

function factRule(factMaxChars: number): string {
  return `Every fact is ONE line (no newline) of at most ${factMaxChars} characters, counted as JavaScript string length (one CJK character counts 1). A fact that would not fit becomes several records, one per distinct fact — never a longer one; keep the "why", drop filler.`;
}

interface RoomDirEntry {
  slug: string;
  name: string;
  locus: string[];
  adjacent: string[];
  records: unknown[];
}

function roomLine(r: RoomDirEntry): string {
  return `- ${r.slug} "${r.name}" locus:[${r.locus.join(', ')}] adjacent:[${r.adjacent.join(', ')}] records:${r.records.length}`;
}

function roomDirectory(rooms: RoomDirEntry[]): string {
  return rooms.length > 0 ? rooms.map(roomLine).join('\n') : '(no rooms exist yet)';
}

// --- castle map (shared context) ------------------------------------------

export interface CastleMapInput {
  keep: { section: KeepSection; record: CastleRecord }[];
  rooms: RoomDirEntry[];
  budgets: { keepMax: number; roomMax: number; factMaxChars: number };
}

// The stable block every context-using patrol call sends first (JudgeTask
// .context): keep in full plus the room directory. Built once per patrol, so
// it is byte-identical across that patrol's calls — what a prompt cache needs.
export function castleMapContext(input: CastleMapInput): string {
  const keepLines =
    input.keep.length > 0 ? input.keep.map((k) => `${formatRecord(k.record)} [at:keep:${k.section}]`).join('\n') : '(keep is empty)';
  const roomLines = roomDirectory(input.rooms);
  return `MemoryCastle castle map — shared reference for every step of this consolidation patrol. Record content is Traditional Chinese; quote it verbatim, never translate it.
Budgets: keepMax=${input.budgets.keepMax}, roomMax=${input.budgets.roomMax}, factMaxChars=${input.budgets.factMaxChars}.

Keep — the always-loaded entrance hall (${input.keep.length}/${input.budgets.keepMax} records):
${keepLines}

Rooms (slug "name" locus adjacent record-count):
${roomLines}`;
}

// --- remember (gate + distill in one call) ---------------------------------

export interface RememberPromptInput {
  text: string;
  source: string;
  factMaxChars: number;
  hits: { record: CastleRecord; location: string }[];
}

export function rememberPrompt(input: RememberPromptInput): PromptPair {
  const hitLines =
    input.hits.length > 0 ? input.hits.map((h) => `${formatRecord(h.record)} [at:${h.location}]`).join('\n') : '(no similar records found)';
  return {
    system: `You are the admission gate ("gatehouse") for a MemoryCastle project memory store. In ONE answer, judge the candidate memory and distill it.

Gate — the candidate must pass ALL three tests, and must be hard-rejected if secretRefusal applies:
- novel: not derivable in under a minute from the repo, git history, or existing docs, AND not already stored — the most similar existing castle records are listed; if one of them already says this, novel is false and "reason" cites its id.
- reusable: a plausible future session will actually need this; if rediscovery is cheap, it fails this test.
- verifiable: it is one clear, checkable statement with a "why" when it states a decision (e.g. "chose X over Y because Z"), not vague speculation.
- secretRefusal: true (hard rejection, overrides the other three) if the candidate is a secret, token, credential, third-party personal data, or anything that should never be committed to a file the whole team can read.
"reason" briefly explains the decision in Traditional Chinese.

Distill — always fill these, even when a test fails (they are used only on a pass):
- fact: the candidate as exactly one memory record, Traditional Chinese, the same facts as the input — add nothing that was not present. ${factRule(input.factMaxChars)} Here it must be exactly one fact: shorten, don't split.
- confidence: "high" if verified this session (ran/read it), "med" if user-stated or observed once, "low" if inferred.
- tags: short lowercase or Traditional Chinese keyword tags (no leading #), 0-5 tags.

The candidate may be written in Traditional Chinese. Judge its meaning; do not translate it.
Respond only via the required JSON schema.`,
    user: `Candidate fact (source: ${input.source}):\n${input.text}\n\nMost similar existing castle records (top keyword hits):\n${hitLines}`,
  };
}

// --- distillCluster ---------------------------------------------------------

export interface DistillClusterInput {
  entries: CastleRecord[];
  factMaxChars: number;
}

export function distillClusterPrompt(input: DistillClusterInput): PromptPair {
  const lines = input.entries.map((e) => formatRecord(e)).join('\n');
  return {
    system: `Distill the following related chronicle entries into a room, per MemoryCastle's consolidation patrol.
Distill the cluster into the smallest set of single-fact records: one record per distinct fact; merge near-duplicates into one line; never fuse two distinct facts into one record.
- fact: Traditional Chinese, stating exactly one distinct fact the entries establish. ${factRule(input.factMaxChars)}
- confidence: for each record, the lowest confidence among the entries supporting THAT record (never upgrade confidence by merging).
- tags: per record, the union of relevant tags from its supporting entries, deduplicated, at most 6.
- passesGate: re-apply the gatehouse — false when the fact is derivable in under a minute from the repo, git history, or docs, or no future session would plausibly need it (cheap to rediscover). A false record is not written; its entries go to archive.
Produce between 1 and 8 records — as few as the distinct facts allow.
Respond only via the required JSON schema.`,
    user: `Entries to merge:\n${lines}`,
  };
}

// --- clusterEntries (cluster + room choice + orphan routing) --------------

export interface ClusterEntriesInput {
  entries: CastleRecord[];
  agedIds: Set<string>; // aged entries the code could not route to a room by tag
  rooms: RoomDirEntry[];
}

export function clusterEntriesPrompt(input: ClusterEntriesInput): PromptPair {
  const lines = input.entries.map((e) => `${formatRecord(e)}${input.agedIds.has(e.id) ? ' [aged]' : ''}`).join('\n');
  return {
    system: `You are running steps 1-2 of a MemoryCastle consolidation patrol over the unswept chronicle entries below (handover entries were already removed).
1. Cluster the entries by place (locus) first, topic second. Only group genuinely related entries (same place/subsystem/activity, or the same topic). A cluster has at least 2 entries; an entry joins at most one cluster; entries that fit no cluster are simply left out of "clusters". "locus" and "topic" briefly describe each cluster's place and subject.
2. For each cluster, decide where it belongs using the existing rooms listed below:
   - an existing room whose locus owns the cluster's place: targetRoomSlug = that room's slug; newRoomName "" and newRoomLocus/newRoomAdjacent [].
   - no existing room owns it and it has 3 or more entries: targetRoomSlug "" and propose a room — newRoomName (Traditional Chinese), newRoomLocus (path globs like "src/server/**", or activity names like "部署活動"), newRoomAdjacent (related room slugs, may be empty). Only a real, reusable place someone would say they are "in". A locus is a place: an episode or milestone name ("v0.2 開發", "M9 出貨") is never a locus — such a cluster belongs to the room owning the files it touched.
   - no existing room owns it and it has fewer than 3 entries: it is not a cluster — leave it out of "clusters"; its entries are handled one by one (step 3).
3. Each entry marked [aged] that joins no cluster: list it in "orphans" with targetRoomSlug = the existing room whose locus owns it ("" if no room does) and passesGate = whether it still passes the gatehouse (false when derivable in under a minute from the repo, git history, or docs, or not worth a future session's attention). Never list unmarked entries in "orphans".
Respond only via the required JSON schema.`,
    user: `Existing rooms (slug "name" locus adjacent record-count):\n${roomDirectory(input.rooms)}\n\nUnswept chronicle entries:\n${lines}`,
  };
}

// --- rewriteFacts -----------------------------------------------------------

export interface RewriteFactsInput {
  items: { key: string; fact: string }[];
  factMaxChars: number;
  allowSplit: boolean;
  retry: boolean; // a previous rewrite of these items still broke the cap
}

export function rewriteFactsPrompt(input: RewriteFactsInput): PromptPair {
  const lines = input.items.map((i) => `key:${i.key} (${i.fact.length} chars): ${i.fact}`).join('\n');
  const shape = input.allowSplit
    ? 'Shorten each, or split it into one fact per distinct fact — return 1 or more facts per key.'
    : 'Shorten each to exactly one fact — return exactly one fact per key.';
  const again = input.retry ? '\nA previous rewrite of these items was still over the limit: be stricter this time.' : '';
  return {
    system: `These MemoryCastle memory facts break the one-line rule. ${factRule(input.factMaxChars)}
${shape} Keep the language (Traditional Chinese) and the meaning; add nothing that is not in the original.${again}
Respond only via the required JSON schema, with exactly one item per input key.`,
    user: `Facts to rewrite:\n${lines}`,
  };
}

// --- contradictionCheck -----------------------------------------------------

export interface ContradictionCheckInput {
  records: (CastleRecord & { location: string })[];
  newIds: Set<string> | null; // null = full pass: every pair counts
}

export function contradictionCheckPrompt(input: ContradictionCheckInput): PromptPair {
  // One header per location instead of a tag on every line.
  const groups = new Map<string, string[]>();
  for (const r of input.records) {
    const line = `${formatRecord(r)}${input.newIds?.has(r.id) ? ' [new]' : ''}`;
    groups.set(r.location, [...(groups.get(r.location) ?? []), line]);
  }
  const lines =
    groups.size > 0
      ? [...groups.entries()].map(([location, rs]) => `[at:${location}]\n${rs.join('\n')}`).join('\n')
      : '(none — check the keep records in the castle map against each other)';
  const newKeep = input.newIds ? [...input.newIds].filter((id) => !input.records.some((r) => r.id === id)) : [];
  const scope = input.newIds
    ? `Records marked [new] were written or re-verified since the last patrol. Report ONLY contradictions in which at least one side is new${
        newKeep.length > 0 ? ` (keep records new since the last patrol: ${newKeep.join(', ')})` : ''
      }; older pairs were already checked by an earlier patrol.`
    : 'This is a full pass: check every pair.';
  return {
    system: `You are running step 3 of a MemoryCastle consolidation patrol: find direct factual contradictions among the room records below and the keep records in the castle map.
Two records contradict only if they cannot both be true about the same subject (not merely "different but compatible" facts). When you find a contradiction, the newer, better-sourced record wins (loserId = the older/weaker one); never propose both records as losers of each other.
${scope}
Only report genuine contradictions; if none exist, return an empty list.
Respond only via the required JSON schema. "reason" is a short Traditional Chinese explanation citing both ids.`,
    user: `Room records:\n${lines}`,
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
    system: `You are running step 6 of a MemoryCastle consolidation patrol: decide which of these candidate records (currently in chronicle or a room) deserve promotion into keep — the always-loaded entrance hall shown in the castle map.
Keep is a scarce budget (currently ${input.currentKeepCount}/${input.keepMax} records) — only promote what most sessions actually need: identity facts, hard constraints, or core cross-cutting rules. Most candidates should NOT be promoted, and never one that repeats a keep record.
Assign each promotion to a section: "identity" (who/what this project is), "constraints" (hard rules that must not be violated), or "core" (other load-bearing facts).
If nothing deserves promotion, return an empty list.
Respond only via the required JSON schema. "reason" is a short Traditional Chinese explanation.`,
    user: `Candidates:\n${lines}`,
  };
}

// --- roomDistill (room over roomMax) --------------------------------------

export interface RoomDistillInput {
  room: { slug: string; name: string; records: CastleRecord[] };
  roomMax: number;
  factMaxChars: number;
}

export function roomDistillPrompt(input: RoomDistillInput): PromptPair {
  const lines = input.room.records.map((r) => formatRecord(r)).join('\n');
  return {
    system: `You are running step 5a of a MemoryCastle consolidation patrol: room "${input.room.slug}" holds ${input.room.records.length} records, over its budget of ${input.roomMax}. Propose how to bring it to at most ${input.roomMax}:
- merges: near-duplicate records (2 or more recordIds) restated as ONE fact. Never fuse two distinct facts into one record. ${factRule(input.factMaxChars)}
- cuts: records that are obsolete or no longer worth loading (they move to archive), each with a short Traditional Chinese reason.
Every proposal is shown to the user for approval.
Respond only via the required JSON schema.`,
    user: `Room "${input.room.name}" records:\n${lines}`,
  };
}

// --- keepCut (keep over keepMax) -------------------------------------------

export interface KeepCutInput {
  keepCount: number;
  keepMax: number;
}

export function keepCutPrompt(input: KeepCutInput): PromptPair {
  return {
    system: `You are running step 6 of a MemoryCastle consolidation patrol: keep holds ${input.keepCount} records, over its budget of ${input.keepMax}. Propose cuts that bring it to at most ${input.keepMax}, taking what the fewest sessions need:
- action "demote": move the record to the existing room whose locus owns it (targetRoomSlug = that slug);
- action "archive": move it to archive (targetRoomSlug "").
Never cut identity facts or hard constraints unless they are obsolete. Each cut carries a short Traditional Chinese reason; every cut is shown to the user for approval.
Respond only via the required JSON schema.`,
    user: 'The keep records to choose from are listed in the castle map above.',
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
