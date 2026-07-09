// planWalk expands a route's stops into a concrete plan (dynamic stops
// rooms-by-locus / all-rooms become one room:<slug> stop each) and resolves
// each stop's readable lines, including ⚠<route> (route-warnings) filtering.
// walkReport turns a plan into the mandatory count report (architecture §6):
// "巡行 N/N 房，發現 X 項注意" — skipping a stop makes the walk invalid.

import { readJsonFile } from '../storage/json-file.js';
import { makeRoomsCollection, makeRoutesCollection } from './collections.js';
import { NotFoundError } from './errors.js';
import { chronicleJsonPath, keepJsonPath } from './layout.js';
import { roomsForPaths } from './locus.js';
import type { CastleRecord, ChronicleFile, KeepFile, RoomFile, WalkPlan, WalkReport, WalkStop } from './types.js';

export interface PlanWalkOptions {
  paths?: string[];
}

function factsOf(records: CastleRecord[]): string[] {
  return records.map((r) => r.fact);
}

function filterRouteWarnings(records: CastleRecord[], routeName: string): CastleRecord[] {
  return records.filter((r) => r.routeWarning === routeName);
}

async function resolveKeepLines(castleDir: string, read: string, routeName: string): Promise<string[]> {
  const keep = await readJsonFile<KeepFile>(keepJsonPath(castleDir));
  const sectionMatch = /^section:(.+)$/.exec(read);
  if (sectionMatch) {
    const name = sectionMatch[1] as keyof KeepFile['sections'];
    return factsOf(keep.sections[name] ?? []);
  }
  const all = [...keep.sections.identity, ...keep.sections.constraints, ...keep.sections.core];
  if (read === 'route-warnings') return factsOf(filterRouteWarnings(all, routeName));
  return factsOf(all);
}

async function resolveChronicleLines(castleDir: string, read: string, routeName: string): Promise<string[]> {
  const file = await readJsonFile<ChronicleFile>(chronicleJsonPath(castleDir));
  if (read === 'route-warnings') return factsOf(filterRouteWarnings(file.entries, routeName));
  return factsOf(file.entries);
}

function resolveRoomLines(room: RoomFile, read: string, routeName: string): string[] {
  if (read === 'route-warnings') return factsOf(filterRouteWarnings(room.records, routeName));
  return factsOf(room.records);
}

export async function planWalk(castleDir: string, routeName: string, opts: PlanWalkOptions = {}): Promise<WalkPlan> {
  const routes = makeRoutesCollection(castleDir);
  const route = await routes.get(routeName);
  if (!route) throw new NotFoundError(`route ${routeName}`);

  const rooms = makeRoomsCollection(castleDir);
  const allRooms = await rooms.list(); // fixed order: sorted by slug

  const stops: WalkStop[] = [];

  for (const stop of route.stops) {
    if (stop.target === 'keep') {
      stops.push({ target: 'keep', read: stop.read, lines: await resolveKeepLines(castleDir, stop.read, routeName), skipped: false });
    } else if (stop.target === 'chronicle') {
      stops.push({
        target: 'chronicle',
        read: stop.read,
        lines: await resolveChronicleLines(castleDir, stop.read, routeName),
        skipped: false,
      });
    } else if (stop.target === 'routes') {
      const allRoutes = await routes.list();
      stops.push({ target: 'routes', read: stop.read, lines: allRoutes.map((r) => r.name), skipped: false });
    } else if (stop.target === 'rooms-by-locus') {
      const matched = opts.paths && opts.paths.length > 0 ? roomsForPaths(allRooms, opts.paths) : [];
      for (const room of matched) {
        stops.push({
          target: `room:${room.slug}`,
          read: stop.read,
          lines: resolveRoomLines(room, stop.read, routeName),
          skipped: false,
        });
      }
    } else if (stop.target === 'all-rooms') {
      for (const room of allRooms) {
        stops.push({
          target: `room:${room.slug}`,
          read: stop.read,
          lines: resolveRoomLines(room, stop.read, routeName),
          skipped: false,
        });
      }
    } else if (stop.target.startsWith('room:')) {
      const slug = stop.target.slice('room:'.length);
      const room = await rooms.get(slug);
      if (room) {
        stops.push({
          target: stop.target,
          read: stop.read,
          lines: resolveRoomLines(room, stop.read, routeName),
          skipped: false,
        });
      } else {
        stops.push({ target: stop.target, read: stop.read, lines: [], skipped: true });
      }
    } else {
      throw new Error(`unknown route stop target: ${stop.target}`);
    }
  }

  return { routeName, stops };
}

export function walkReport(plan: WalkPlan): WalkReport {
  const roomStops = plan.stops.filter((s) => s.target.startsWith('room:'));
  const total = roomStops.length;
  const visited = roomStops.filter((s) => !s.skipped).length;
  const warnings = plan.stops.reduce((sum, s) => (s.read === 'route-warnings' ? sum + s.lines.length : sum), 0);
  const valid = plan.stops.every((s) => !s.skipped);
  const text = `巡行 ${visited}/${total} 房，發現 ${warnings} 項注意`;
  return { visited, total, warnings, valid, text };
}
