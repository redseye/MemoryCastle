// Collection accessors for keep / chronicle / rooms / routes. Every mutating
// call re-reads the backing JSON file, mutates in memory, and writes it back
// atomically — no cross-call caching, so there is never a stale-state bug.
// append/update/remove all return the written (or removed) record for read-back.

import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { readJsonFile, readJsonFileIfExists, writeJsonFile } from '../storage/json-file.js';
import { NotFoundError } from './errors.js';
import { generateId, localDate } from './ids.js';
import { roomJsonPath, roomsDirPath, chronicleJsonPath, keepJsonPath, routesJsonPath } from './layout.js';
import { applyPatch, findRecordIndex, makeRecord } from './record-ops.js';
import { slugify, uniqueSlug } from '../util/slugify.js';
import type {
  CastleRecord,
  ChronicleFile,
  KeepFile,
  KeepSection,
  RecordInput,
  RecordPatch,
  RoomFile,
  RoomInput,
  RoomPatch,
  RouteDef,
  RoutesFile,
} from './types.js';

export interface KeepCollection {
  list(section?: KeepSection): Promise<CastleRecord[]>;
  get(id: string): Promise<CastleRecord | undefined>;
  append(section: KeepSection, input: RecordInput): Promise<CastleRecord>;
  update(id: string, patch: RecordPatch): Promise<CastleRecord>;
  remove(id: string): Promise<CastleRecord>;
}

export interface ChronicleCollection {
  list(): Promise<CastleRecord[]>;
  get(id: string): Promise<CastleRecord | undefined>;
  append(input: RecordInput): Promise<CastleRecord>;
  update(id: string, patch: RecordPatch): Promise<CastleRecord>;
  remove(id: string): Promise<CastleRecord>;
}

export interface RoomsCollection {
  list(): Promise<RoomFile[]>;
  get(slug: string): Promise<RoomFile | undefined>;
  append(input: RoomInput): Promise<RoomFile>;
  update(slug: string, patch: RoomPatch): Promise<RoomFile>;
  remove(slug: string): Promise<RoomFile>;
  appendRecord(slug: string, input: RecordInput): Promise<CastleRecord>;
  updateRecord(slug: string, id: string, patch: RecordPatch): Promise<CastleRecord>;
  removeRecord(slug: string, id: string): Promise<CastleRecord>;
}

export interface RoutesCollection {
  list(): Promise<RouteDef[]>;
  get(name: string): Promise<RouteDef | undefined>;
  append(input: RouteDef): Promise<RouteDef>;
  update(name: string, patch: Partial<RouteDef>): Promise<RouteDef>;
  remove(name: string): Promise<RouteDef>;
}

const KEEP_SECTIONS: KeepSection[] = ['identity', 'constraints', 'core'];

export function makeKeepCollection(castleDir: string): KeepCollection {
  const path = keepJsonPath(castleDir);
  const read = () => readJsonFile<KeepFile>(path);

  function locate(keep: KeepFile, id: string): { section: KeepSection; index: number } | undefined {
    for (const section of KEEP_SECTIONS) {
      const index = findRecordIndex(keep.sections[section], id);
      if (index !== -1) return { section, index };
    }
    return undefined;
  }

  return {
    async list(section) {
      const keep = await read();
      if (section) return keep.sections[section];
      return KEEP_SECTIONS.flatMap((s) => keep.sections[s]);
    },
    async get(id) {
      const keep = await read();
      const loc = locate(keep, id);
      return loc ? keep.sections[loc.section][loc.index] : undefined;
    },
    async append(section, input) {
      const keep = await read();
      const record = makeRecord(input);
      keep.sections[section].push(record);
      await writeJsonFile(path, keep);
      return record;
    },
    async update(id, patch) {
      const keep = await read();
      const loc = locate(keep, id);
      if (!loc) throw new NotFoundError(`keep record ${id}`);
      const updated = applyPatch(keep.sections[loc.section][loc.index], patch);
      keep.sections[loc.section][loc.index] = updated;
      await writeJsonFile(path, keep);
      return updated;
    },
    async remove(id) {
      const keep = await read();
      const loc = locate(keep, id);
      if (!loc) throw new NotFoundError(`keep record ${id}`);
      const [removed] = keep.sections[loc.section].splice(loc.index, 1);
      await writeJsonFile(path, keep);
      return removed;
    },
  };
}

export function makeChronicleCollection(castleDir: string): ChronicleCollection {
  const path = chronicleJsonPath(castleDir);
  const read = () => readJsonFile<ChronicleFile>(path);

  return {
    async list() {
      return (await read()).entries;
    },
    async get(id) {
      return (await read()).entries.find((r) => r.id === id);
    },
    async append(input) {
      const file = await read();
      const record = makeRecord(input);
      file.entries.push(record);
      await writeJsonFile(path, file);
      return record;
    },
    async update(id, patch) {
      const file = await read();
      const idx = findRecordIndex(file.entries, id);
      if (idx === -1) throw new NotFoundError(`chronicle entry ${id}`);
      const updated = applyPatch(file.entries[idx], patch);
      file.entries[idx] = updated;
      await writeJsonFile(path, file);
      return updated;
    },
    async remove(id) {
      const file = await read();
      const idx = findRecordIndex(file.entries, id);
      if (idx === -1) throw new NotFoundError(`chronicle entry ${id}`);
      const [removed] = file.entries.splice(idx, 1);
      await writeJsonFile(path, file);
      return removed;
    },
  };
}

async function listRoomSlugs(castleDir: string): Promise<string[]> {
  const dir = roomsDirPath(castleDir);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  return entries
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

export function makeRoomsCollection(castleDir: string): RoomsCollection {
  const readRoom = (slug: string) => readJsonFileIfExists<RoomFile>(roomJsonPath(castleDir, slug));

  return {
    async list() {
      const slugs = await listRoomSlugs(castleDir);
      const rooms = await Promise.all(slugs.map((s) => readRoom(s)));
      return rooms.filter((r): r is RoomFile => r !== undefined);
    },
    async get(slug) {
      return readRoom(slug);
    },
    async append(input) {
      const existing = new Set(await listRoomSlugs(castleDir));
      // slugify() falls back to the literal word "item" for names with no
      // ASCII letters (e.g. pure Traditional Chinese) — swap in a random
      // suffix instead so distinct Chinese-named rooms don't all collide
      // into item / item-2 / item-3.
      const rawSlug = slugify(input.slug ?? input.name);
      const base = rawSlug === 'item' ? `room-${generateId()}` : rawSlug;
      const slug = uniqueSlug(base, existing);
      const room: RoomFile = {
        schema: 1,
        slug,
        name: input.name,
        locus: input.locus ?? [],
        adjacent: input.adjacent ?? [],
        emblem: input.emblem ?? null,
        createdAt: localDate(),
        records: [],
      };
      await writeJsonFile(roomJsonPath(castleDir, slug), room);
      return room;
    },
    async update(slug, patch) {
      const room = await readRoom(slug);
      if (!room) throw new NotFoundError(`room ${slug}`);
      const updated: RoomFile = {
        ...room,
        name: patch.name ?? room.name,
        locus: patch.locus ?? room.locus,
        adjacent: patch.adjacent ?? room.adjacent,
        emblem: patch.emblem === undefined ? room.emblem : patch.emblem,
      };
      await writeJsonFile(roomJsonPath(castleDir, slug), updated);
      return updated;
    },
    async remove(slug) {
      const room = await readRoom(slug);
      if (!room) throw new NotFoundError(`room ${slug}`);
      await rm(roomJsonPath(castleDir, slug), { force: true });
      return room;
    },
    async appendRecord(slug, input) {
      const room = await readRoom(slug);
      if (!room) throw new NotFoundError(`room ${slug}`);
      const record = makeRecord(input);
      room.records.push(record);
      await writeJsonFile(roomJsonPath(castleDir, slug), room);
      return record;
    },
    async updateRecord(slug, id, patch) {
      const room = await readRoom(slug);
      if (!room) throw new NotFoundError(`room ${slug}`);
      const idx = findRecordIndex(room.records, id);
      if (idx === -1) throw new NotFoundError(`room ${slug} record ${id}`);
      const updated = applyPatch(room.records[idx], patch);
      room.records[idx] = updated;
      await writeJsonFile(roomJsonPath(castleDir, slug), room);
      return updated;
    },
    async removeRecord(slug, id) {
      const room = await readRoom(slug);
      if (!room) throw new NotFoundError(`room ${slug}`);
      const idx = findRecordIndex(room.records, id);
      if (idx === -1) throw new NotFoundError(`room ${slug} record ${id}`);
      const [removed] = room.records.splice(idx, 1);
      await writeJsonFile(roomJsonPath(castleDir, slug), room);
      return removed;
    },
  };
}

export function makeRoutesCollection(castleDir: string): RoutesCollection {
  const path = routesJsonPath(castleDir);
  const read = () => readJsonFile<RoutesFile>(path);

  return {
    async list() {
      return (await read()).routes;
    },
    async get(name) {
      return (await read()).routes.find((r) => r.name === name);
    },
    async append(input) {
      const file = await read();
      if (file.routes.some((r) => r.name === input.name)) {
        throw new Error(`route already exists: ${input.name}`);
      }
      file.routes.push(input);
      await writeJsonFile(path, file);
      return input;
    },
    async update(name, patch) {
      const file = await read();
      const idx = file.routes.findIndex((r) => r.name === name);
      if (idx === -1) throw new NotFoundError(`route ${name}`);
      const updated: RouteDef = { ...file.routes[idx], ...patch, name: file.routes[idx].name };
      file.routes[idx] = updated;
      await writeJsonFile(path, file);
      return updated;
    },
    async remove(name) {
      const file = await read();
      const idx = file.routes.findIndex((r) => r.name === name);
      if (idx === -1) throw new NotFoundError(`route ${name}`);
      const [removed] = file.routes.splice(idx, 1);
      await writeJsonFile(path, file);
      return removed;
    },
  };
}
