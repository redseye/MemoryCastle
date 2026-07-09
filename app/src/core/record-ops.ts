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
  return updated;
}

export function findRecordIndex(records: CastleRecord[], id: string): number {
  return records.findIndex((r) => r.id === id);
}
