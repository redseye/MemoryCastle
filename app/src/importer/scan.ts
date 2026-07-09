// Discovers markdown castle files under <root>/.claude/castle/ and parses
// them via the per-file parsers. Read-only: never touches disk. Shared by
// importPreview and importApply so both phases see identical data.

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { castleDirOf } from '../core/layout.js';
import { toForwardSlash } from '../storage/paths.js';
import { matchArchiveMonth, parseArchiveChronicleMd } from './archive.js';
import { parseChronicleMd } from './chronicle.js';
import { parseKeepMd } from './keep.js';
import { parseRoomMd } from './rooms.js';
import { parseRoutesMd } from './routes.js';
import type { ImportWarning, ParsedCastle, ParsedKeep, ParsedRoom } from './types.js';

async function readIfExists(path: string): Promise<string | undefined> {
  if (!existsSync(path)) return undefined;
  return readFile(path, 'utf8');
}

async function listMdFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  return entries.filter((f) => f.endsWith('.md')).sort();
}

export async function scanCastle(projectRoot: string): Promise<ParsedCastle> {
  const castleDir = castleDirOf(projectRoot);
  const warnings: ImportWarning[] = [];
  const mdFiles: string[] = [];

  const keepContent = await readIfExists(join(castleDir, 'keep.md'));
  let keep: ParsedKeep = { sections: { identity: [], constraints: [], core: [] }, lastPatrolAt: null };
  if (keepContent !== undefined) {
    const parsed = parseKeepMd(keepContent);
    keep = { sections: parsed.sections, lastPatrolAt: parsed.lastPatrolAt };
    warnings.push(...parsed.warnings);
    mdFiles.push('keep.md');
  }

  const chronicleContent = await readIfExists(join(castleDir, 'chronicle.md'));
  let chronicle: ParsedCastle['chronicle'] = [];
  if (chronicleContent !== undefined) {
    const parsed = parseChronicleMd(chronicleContent);
    chronicle = parsed.entries;
    warnings.push(...parsed.warnings);
    mdFiles.push('chronicle.md');
  }

  // rooms/*.md parsed before routes.md so route stop text can be mapped
  // against known room names.
  const roomFilenames = await listMdFiles(join(castleDir, 'rooms'));
  const rooms: ParsedRoom[] = [];
  for (const f of roomFilenames) {
    const slug = f.slice(0, -'.md'.length);
    const content = await readFile(join(castleDir, 'rooms', f), 'utf8');
    const relFile = toForwardSlash(join('rooms', f));
    const { warnings: roomWarnings, ...room } = parseRoomMd(content, slug, relFile);
    warnings.push(...roomWarnings);
    mdFiles.push(relFile);
    rooms.push(room);
  }

  const routesContent = await readIfExists(join(castleDir, 'routes.md'));
  let routes: ParsedCastle['routes'] = [];
  if (routesContent !== undefined) {
    const parsed = parseRoutesMd(
      routesContent,
      'routes.md',
      rooms.map((r) => ({ slug: r.slug, name: r.name })),
    );
    routes = parsed.routes;
    warnings.push(...parsed.warnings);
    mdFiles.push('routes.md');
  }

  // archive/*.md: only the strict chronicle-YYYY-MM.md pattern is parsed;
  // any other .md file (e.g. an English-original provenance copy) is still
  // moved during apply but never parsed and never warned about.
  const archiveFilenames = await listMdFiles(join(castleDir, 'archive'));
  const archiveMonths: ParsedCastle['archiveMonths'] = [];
  for (const f of archiveFilenames) {
    const relFile = toForwardSlash(join('archive', f));
    mdFiles.push(relFile);
    const month = matchArchiveMonth(f);
    if (!month) continue;
    const content = await readFile(join(castleDir, 'archive', f), 'utf8');
    const parsed = parseArchiveChronicleMd(content, relFile);
    warnings.push(...parsed.warnings);
    archiveMonths.push({ month, entries: parsed.entries });
  }

  return { keep, chronicle, routes, rooms, archiveMonths, warnings, mdFiles };
}
