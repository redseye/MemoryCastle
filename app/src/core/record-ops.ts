// Shared record construction/patch/lookup helpers, reused by the keep,
// chronicle, and room record accessors so id assignment and key ordering
// stay consistent across all three.

import { generateId, localDate } from './ids.js';
import type { CastleRecord, RecordInput, RecordPatch } from './types.js';

export function makeRecord(input: RecordInput, now: Date = new Date()): CastleRecord {
  const record: CastleRecord = {
    id: generateId(),
    date: input.date ?? localDate(now),
    confidence: input.confidence,
    source: input.source,
    fact: input.fact,
    tags: input.tags ?? [],
  };
  if (input.routeWarning) record.routeWarning = input.routeWarning;
  if (input.verifiedAt) record.verifiedAt = input.verifiedAt;
  return record;
}

export function applyPatch(record: CastleRecord, patch: RecordPatch): CastleRecord {
  const updated: CastleRecord = {
    id: record.id,
    date: patch.date ?? record.date,
    confidence: patch.confidence ?? record.confidence,
    source: patch.source ?? record.source,
    fact: patch.fact ?? record.fact,
    tags: patch.tags ?? record.tags,
  };
  const routeWarning = patch.routeWarning ?? record.routeWarning;
  if (routeWarning) updated.routeWarning = routeWarning;
  const verifiedAt = patch.verifiedAt ?? record.verifiedAt;
  if (verifiedAt) updated.verifiedAt = verifiedAt;
  return updated;
}

export function findRecordIndex(records: CastleRecord[], id: string): number {
  return records.findIndex((r) => r.id === id);
}

const HANDOVER_TAG = 'handover';
const HANDOVER_MARK = '#handover';

export function isHandoverEntry(entry: CastleRecord): boolean {
  return entry.tags.includes(HANDOVER_TAG) || entry.fact.includes(HANDOVER_MARK);
}

// Newest handover by date; >= so the later-appended of two same-day entries wins.
export function newestHandover(entries: CastleRecord[]): CastleRecord | undefined {
  return entries
    .filter(isHandoverEntry)
    .reduce<CastleRecord | undefined>((best, e) => (best === undefined || e.date >= best.date ? e : best), undefined);
}

// The architecture §2 one-line markdown form (contract C2 adds `ver:`):
//   - [YYYY-MM-DD | conf:x | src:y | ver:YYYY-MM-DD] fact ⚠route #tag
export function renderRecordLine(record: CastleRecord): string {
  const skeleton = [record.date, `conf:${record.confidence}`, `src:${record.source}`];
  if (record.verifiedAt) skeleton.push(`ver:${record.verifiedAt}`);
  const parts = [`- [${skeleton.join(' | ')}] ${record.fact}`];
  if (record.routeWarning) parts.push(`⚠${record.routeWarning}`);
  for (const tag of record.tags) parts.push(`#${tag}`);
  return parts.join(' ');
}
