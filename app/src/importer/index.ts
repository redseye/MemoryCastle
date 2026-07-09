// Two-phase markdown → JSON import (plan §8). importPreview only reads;
// importApply performs the conversion via the M1 storage layer (atomic
// writes) and then archives the original markdown. Exported for M3 (REST
// import endpoints) as well as the CLI.

import { existsSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { CastleExistsError } from '../core/errors.js';
import { DEFAULT_BUDGETS } from '../core/init.js';
import { localDate } from '../core/ids.js';
import {
  archiveChroniclePath,
  archiveDirPath,
  castleDirOf,
  castleJsonPath,
  chronicleJsonPath,
  keepJsonPath,
  roomJsonPath,
  roomsDirPath,
  routesJsonPath,
} from '../core/layout.js';
import type { CastleMeta, ChronicleFile, KeepFile, RoomFile, RoutesFile } from '../core/types.js';
import { writeJsonFile } from '../storage/json-file.js';
import { toForwardSlash } from '../storage/paths.js';
import { scanCastle } from './scan.js';
import type { ImportApplySummary, ImportCounts, ImportPreviewResult, ParsedCastle } from './types.js';

export type { ImportApplySummary, ImportCounts, ImportPreviewResult, ImportWarning } from './types.js';

function countsOf(parsed: ParsedCastle): ImportCounts {
  const keep =
    parsed.keep.sections.identity.length + parsed.keep.sections.constraints.length + parsed.keep.sections.core.length;
  return {
    keep,
    chronicle: parsed.chronicle.length,
    routes: parsed.routes.length,
    rooms: parsed.rooms.length,
    archiveMonths: parsed.archiveMonths.length,
  };
}

// The original castle's creation date isn't recorded anywhere in markdown;
// the earliest date seen across keep/chronicle records is the closest honest
// proxy, falling back to today for a castle with no dated records at all.
function earliestDate(parsed: ParsedCastle): string | undefined {
  const dates = [
    ...parsed.keep.sections.identity,
    ...parsed.keep.sections.constraints,
    ...parsed.keep.sections.core,
    ...parsed.chronicle,
  ].map((r) => r.date);
  return dates.length > 0 ? dates.slice().sort()[0] : undefined;
}

export async function importPreview(projectRoot: string): Promise<ImportPreviewResult> {
  const parsed = await scanCastle(resolve(projectRoot));
  return { counts: countsOf(parsed), warnings: parsed.warnings };
}

export async function importApply(projectRoot: string): Promise<ImportApplySummary> {
  const resolvedRoot = resolve(projectRoot);
  const castleDir = castleDirOf(resolvedRoot);
  if (existsSync(castleJsonPath(castleDir))) {
    throw new CastleExistsError(castleDir);
  }

  const parsed = await scanCastle(resolvedRoot);
  const createdAt = earliestDate(parsed) ?? localDate();

  const meta: CastleMeta = {
    schema: 1,
    projectName: basename(resolvedRoot),
    createdAt,
    lastPatrolAt: parsed.keep.lastPatrolAt,
    budgets: DEFAULT_BUDGETS,
  };
  const keep: KeepFile = { schema: 1, sections: parsed.keep.sections };
  const chronicle: ChronicleFile = { schema: 1, entries: parsed.chronicle };
  const routes: RoutesFile = { schema: 1, routes: parsed.routes };

  await writeJsonFile(castleJsonPath(castleDir), meta);
  await writeJsonFile(keepJsonPath(castleDir), keep);
  await writeJsonFile(chronicleJsonPath(castleDir), chronicle);
  await writeJsonFile(routesJsonPath(castleDir), routes);

  await mkdir(roomsDirPath(castleDir), { recursive: true });
  for (const room of parsed.rooms) {
    const roomFile: RoomFile = {
      schema: 1,
      slug: room.slug,
      name: room.name,
      locus: room.locus,
      adjacent: room.adjacent,
      emblem: room.emblem,
      createdAt,
      records: room.records,
    };
    await writeJsonFile(roomJsonPath(castleDir, room.slug), roomFile);
  }

  await mkdir(archiveDirPath(castleDir), { recursive: true });
  for (const month of parsed.archiveMonths) {
    await writeJsonFile(archiveChroniclePath(castleDir, month.month), {
      schema: 1,
      month: month.month,
      entries: month.entries,
    });
  }

  const movedFiles = await archiveMarkdownOriginals(castleDir, parsed.mdFiles);

  return { counts: countsOf(parsed), warnings: parsed.warnings, movedFiles };
}

// Moves every original .md file into archive/markdown-original/, preserving
// relative structure (rooms/<f>.md → markdown-original/rooms/<f>.md) but
// dropping a leading "archive/" segment so files that already lived under
// archive/ don't nest as archive/markdown-original/archive/....
async function archiveMarkdownOriginals(castleDir: string, mdFiles: string[]): Promise<string[]> {
  const moved: string[] = [];
  for (const rel of mdFiles) {
    const destRel = rel.startsWith('archive/') ? rel.slice('archive/'.length) : rel;
    const dest = join(castleDir, 'archive', 'markdown-original', destRel);
    await mkdir(dirname(dest), { recursive: true });
    await rename(join(castleDir, rel), dest);
    moved.push(toForwardSlash(join('archive', 'markdown-original', destRel)));
  }
  return moved;
}
