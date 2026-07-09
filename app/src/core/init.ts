// initCastle: scaffold a new castle's JSON files. Refuses to overwrite an
// existing castle (CastleExistsError). The three default routes mirror the
// project's own .claude/castle/routes.md (session-start / before-release /
// patrol) translated into the target/read vocabulary of plan §2.

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { writeJsonFile } from '../storage/json-file.js';
import { CastleExistsError } from './errors.js';
import { localDate } from './ids.js';
import {
  archiveDirPath,
  castleDirOf,
  castleJsonPath,
  chronicleJsonPath,
  keepJsonPath,
  roomsDirPath,
  routesJsonPath,
} from './layout.js';
import type { Budgets, CastleMeta, ChronicleFile, KeepFile, RoutesFile } from './types.js';

export const DEFAULT_BUDGETS: Budgets = {
  keepMax: 30,
  roomMax: 120,
  chronicleSweep: 20,
  patrolDays: 30,
  stalenessDays: 90,
};

function defaultRoutesFile(): RoutesFile {
  return {
    schema: 1,
    routes: [
      {
        name: 'session-start',
        occasion: '每個 session 開工時走',
        stops: [
          { target: 'keep', read: 'all' },
          { target: 'rooms-by-locus', read: 'all' },
        ],
      },
      {
        name: 'before-release',
        occasion: '使用者說 release／deploy／publish／上線／對外發布 時走',
        stops: [{ target: 'keep', read: 'section:constraints' }],
      },
      {
        name: 'patrol',
        occasion: '巡查觸發時走',
        stops: [
          { target: 'chronicle', read: 'all' },
          { target: 'all-rooms', read: 'all' },
          { target: 'keep', read: 'all' },
          { target: 'routes', read: 'all' },
        ],
      },
    ],
  };
}

export async function initCastle(root: string, name?: string): Promise<string> {
  const resolvedRoot = resolve(root);
  if (!existsSync(resolvedRoot)) {
    throw new Error(`目標目錄不存在：${resolvedRoot}`);
  }

  const castleDir = castleDirOf(resolvedRoot);
  if (existsSync(castleJsonPath(castleDir))) {
    throw new CastleExistsError(castleDir);
  }

  const projectName = name ?? basename(resolvedRoot);
  const createdAt = localDate();

  const meta: CastleMeta = {
    schema: 1,
    projectName,
    createdAt,
    lastPatrolAt: createdAt,
    budgets: DEFAULT_BUDGETS,
  };
  const keep: KeepFile = { schema: 1, sections: { identity: [], constraints: [], core: [] } };
  const chronicle: ChronicleFile = { schema: 1, entries: [] };

  await writeJsonFile(castleJsonPath(castleDir), meta);
  await writeJsonFile(keepJsonPath(castleDir), keep);
  await writeJsonFile(chronicleJsonPath(castleDir), chronicle);
  await writeJsonFile(routesJsonPath(castleDir), defaultRoutesFile());
  // rooms/ and archive/ start empty; create them up front so the scaffold is
  // complete on disk immediately after init (nothing lazily appears later).
  await mkdir(roomsDirPath(castleDir), { recursive: true });
  await mkdir(archiveDirPath(castleDir), { recursive: true });

  return castleDir;
}
