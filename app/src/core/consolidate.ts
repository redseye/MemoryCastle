// sweepChronicle: move swept entries out of chronicle.json into monthly
// archive buckets (archive/chronicle-YYYY-MM.json), bucketed by each entry's
// own date so a single sweep can fan out across multiple months. An entry
// patrol promoted carries promotedTo ('<room-slug>' | 'keep', contract C2).
// Same rules as `scripts/castle.mjs sweep`, all-or-nothing: an unknown id, a
// promotedTo naming no room, or the newest handover (it stays for
// chronicle/last-handover, §4 step 4) means nothing is swept, and each
// blocker comes back to the caller in the result instead of being skipped.
// archiveRecord: move a room or keep record to archive/room-records-YYYY-MM.json
// (the archiving month) stamped archivedAt / archivedFrom / archiveNote, in
// that key order after the record's own — byte-for-byte what `castle.mjs
// archive` writes (architecture §2). Patrol decay, cuts, merged originals,
// superseded losers. Chronicle entries never go there: they leave through
// sweepChronicle.
// supersede: the newer/better-sourced record wins a contradiction (§4 step
// 3); a chronicle loser is swept, a keep or room loser archived with
// archiveNote "superseded by <winner>: <reason>". Pre-v0.5 castles may still
// hold archive/superseded.json or archive/records.json: never auto-loaded,
// left as they are, no longer written.

import { existsSync } from 'node:fs';
import { readJsonFile, readJsonFileIfExists, writeJsonFile } from '../storage/json-file.js';
import { makeChronicleCollection, makeKeepCollection, makeRoomsCollection } from './collections.js';
import { NotFoundError, SweepRefusedError } from './errors.js';
import { localDate } from './ids.js';
import { archiveChroniclePath, archivedRoomRecordsPath, chronicleJsonPath, roomJsonPath } from './layout.js';
import { newestHandover } from './record-ops.js';
import type {
  ArchivedRecordEntry,
  ArchivedRecordsFile,
  CastleRecord,
  ChronicleArchiveEntry,
  ChronicleArchiveFile,
  ChronicleFile,
  SweepBlockers,
  SweepResult,
} from './types.js';

function findSweepBlockers(castleDir: string, entries: CastleRecord[], ids: string[], promotedTo: Record<string, string>): SweepBlockers {
  const live = new Set(entries.map((e) => e.id));
  const requested = [...new Set(ids)];
  const newest = newestHandover(entries);
  const targets = [...new Set(requested.map((id) => promotedTo[id]).filter((to): to is string => to !== undefined))];
  return {
    unknownIds: requested.filter((id) => !live.has(id)),
    refusedIds: newest && requested.includes(newest.id) ? [newest.id] : [],
    unknownPromotedTo: targets.filter((to) => to !== 'keep' && !existsSync(roomJsonPath(castleDir, to))),
  };
}

export function isSweepBlocked(b: SweepBlockers): boolean {
  return b.unknownIds.length > 0 || b.refusedIds.length > 0 || b.unknownPromotedTo.length > 0;
}

// Dry run of sweepChronicle's checks, for callers that must write elsewhere
// first (e.g. distilled room records) and can't afford a refused sweep after.
export async function sweepBlockers(castleDir: string, ids: string[], promotedTo: Record<string, string> = {}): Promise<SweepBlockers> {
  const file = await readJsonFile<ChronicleFile>(chronicleJsonPath(castleDir));
  return findSweepBlockers(castleDir, file.entries, ids, promotedTo);
}

export async function sweepChronicle(
  castleDir: string,
  ids: string[],
  promotedTo: Record<string, string> = {}
): Promise<SweepResult> {
  const path = chronicleJsonPath(castleDir);
  const file = await readJsonFile<ChronicleFile>(path);
  const blockers = findSweepBlockers(castleDir, file.entries, ids, promotedTo);
  if (isSweepBlocked(blockers)) return { swept: [], ...blockers };
  const idSet = new Set(ids);
  const toSweep = file.entries.filter((e) => idSet.has(e.id));
  const remaining = file.entries.filter((e) => !idSet.has(e.id));

  const byMonth = new Map<string, CastleRecord[]>();
  for (const entry of toSweep) {
    const month = entry.date.slice(0, 7);
    const bucket = byMonth.get(month);
    if (bucket) bucket.push(entry);
    else byMonth.set(month, [entry]);
  }

  const sweptAt = localDate();
  for (const [month, entries] of byMonth) {
    const archivePath = archiveChroniclePath(castleDir, month);
    const archiveFile =
      (await readJsonFileIfExists<ChronicleArchiveFile>(archivePath)) ?? { schema: 1, month, entries: [] };
    for (const entry of entries) {
      const archived: ChronicleArchiveEntry = { ...entry, sweptAt };
      if (promotedTo[entry.id]) archived.promotedTo = promotedTo[entry.id];
      archiveFile.entries.push(archived);
    }
    await writeJsonFile(archivePath, archiveFile);
  }

  file.entries = remaining;
  await writeJsonFile(path, file);
  return { swept: toSweep, ...blockers };
}

// Keep or room only: chronicle entries leave through sweepChronicle.
async function findAndRemoveRecord(castleDir: string, id: string): Promise<{ record: CastleRecord; from: string } | undefined> {
  const keep = makeKeepCollection(castleDir);
  const keepRecord = await keep.get(id);
  if (keepRecord) {
    await keep.remove(id);
    return { record: keepRecord, from: 'keep' };
  }

  const rooms = makeRoomsCollection(castleDir);
  for (const room of await rooms.list()) {
    const found = room.records.find((r) => r.id === id);
    if (found) {
      await rooms.removeRecord(room.slug, id);
      return { record: found, from: `room:${room.slug}` };
    }
  }

  return undefined;
}

export async function supersede(
  castleDir: string,
  loserId: string,
  winnerId: string,
  reason: string
): Promise<ArchivedRecordEntry | ChronicleArchiveEntry> {
  if (await makeChronicleCollection(castleDir).get(loserId)) {
    const result = await sweepChronicle(castleDir, [loserId]);
    if (result.refusedIds.length > 0) throw new SweepRefusedError(loserId);
    if (result.swept.length === 0) throw new NotFoundError(`chronicle entry ${loserId}`);
    return { ...result.swept[0], sweptAt: localDate() };
  }
  return archiveRecord(castleDir, loserId, `superseded by ${winnerId}: ${reason}`);
}

export async function archiveRecord(castleDir: string, id: string, note: string): Promise<ArchivedRecordEntry> {
  const found = await findAndRemoveRecord(castleDir, id);
  if (!found) throw new NotFoundError(`room/keep record ${id}`);

  const archivedAt = localDate();
  const month = archivedAt.slice(0, 7);
  const path = archivedRoomRecordsPath(castleDir, month);
  const file = (await readJsonFileIfExists<ArchivedRecordsFile>(path)) ?? { schema: 1, month, entries: [] };
  const entry: ArchivedRecordEntry = { ...found.record, archivedAt, archivedFrom: found.from, archiveNote: note.replace(/[\r\n]+/g, ' ') };
  file.entries.push(entry);
  await writeJsonFile(path, file);
  return entry;
}
