// sweepChronicle: move swept entries out of chronicle.json into monthly
// archive buckets (archive/chronicle-YYYY-MM.json), bucketed by each entry's
// own date so a single sweep can fan out across multiple months.
// supersede: the newer/better-sourced record wins a contradiction; the loser
// is located wherever it lives (keep/chronicle/any room), removed, and
// recorded in archive/superseded.json.

import { readJsonFile, readJsonFileIfExists, writeJsonFile } from '../storage/json-file.js';
import { makeChronicleCollection, makeKeepCollection, makeRoomsCollection } from './collections.js';
import { NotFoundError } from './errors.js';
import { localDate } from './ids.js';
import { archiveChroniclePath, chronicleJsonPath, supersededJsonPath } from './layout.js';
import type {
  CastleRecord,
  ChronicleArchiveFile,
  ChronicleFile,
  SupersededEntry,
  SupersededFile,
} from './types.js';

export async function sweepChronicle(castleDir: string, ids: string[]): Promise<CastleRecord[]> {
  const path = chronicleJsonPath(castleDir);
  const file = await readJsonFile<ChronicleFile>(path);
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
      archiveFile.entries.push({ ...entry, sweptAt });
    }
    await writeJsonFile(archivePath, archiveFile);
  }

  file.entries = remaining;
  await writeJsonFile(path, file);
  return toSweep;
}

async function findAndRemoveRecord(castleDir: string, id: string): Promise<CastleRecord | undefined> {
  const keep = makeKeepCollection(castleDir);
  const keepRecord = await keep.get(id);
  if (keepRecord) {
    await keep.remove(id);
    return keepRecord;
  }

  const chronicle = makeChronicleCollection(castleDir);
  const chronicleRecord = await chronicle.get(id);
  if (chronicleRecord) {
    await chronicle.remove(id);
    return chronicleRecord;
  }

  const rooms = makeRoomsCollection(castleDir);
  for (const room of await rooms.list()) {
    const found = room.records.find((r) => r.id === id);
    if (found) {
      await rooms.removeRecord(room.slug, id);
      return found;
    }
  }

  return undefined;
}

export async function supersede(
  castleDir: string,
  loserId: string,
  winnerId: string,
  reason: string
): Promise<SupersededEntry> {
  const loser = await findAndRemoveRecord(castleDir, loserId);
  if (!loser) throw new NotFoundError(`record ${loserId}`);

  const path = supersededJsonPath(castleDir);
  const file = (await readJsonFileIfExists<SupersededFile>(path)) ?? { schema: 1, entries: [] };
  const entry: SupersededEntry = { record: loser, supersededById: winnerId, reason, archivedAt: localDate() };
  file.entries.push(entry);
  await writeJsonFile(path, file);
  return entry;
}
