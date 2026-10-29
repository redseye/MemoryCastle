// Atomic JSON file read/write. Writes go through a temp file + rename so a reader
// never observes a partially-written file. Output follows contract C4 (see
// serializeCastleJson below): 2-space indented structure, but every record,
// every route, and every string array on ONE compact line in canonical key
// order, so grepping a castle file returns whole records. Trailing newline.

import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export async function fileExists(filePath: string): Promise<boolean> {
  return existsSync(filePath);
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

export async function readJsonFileIfExists<T>(filePath: string): Promise<T | undefined> {
  if (!existsSync(filePath)) return undefined;
  return readJsonFile<T>(filePath);
}

// Canonical key orders (contract C2/C4). Keys not listed keep their original
// relative order after the listed ones — never dropped.
const RECORD_KEYS = ['id', 'date', 'confidence', 'source', 'fact', 'tags', 'routeWarning', 'verifiedAt', 'sweptAt', 'promotedTo'];
const ROUTE_KEYS = ['name', 'occasion', 'stops'];
const STOP_KEYS = ['target', 'read', 'note'];

type Plain = Record<string, unknown>;

function isPlainObject(value: unknown): value is Plain {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRecordLike(value: unknown): value is Plain {
  return isPlainObject(value) && typeof value.id === 'string' && typeof value.fact === 'string';
}

function isRouteLike(value: unknown): value is Plain {
  return isPlainObject(value) && typeof value.name === 'string' && Array.isArray(value.stops);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function reorder(obj: Plain, order: string[]): Plain {
  const out: Plain = {};
  for (const key of order) if (key in obj) out[key] = obj[key];
  for (const key of Object.keys(obj)) if (!(key in out)) out[key] = obj[key];
  return out;
}

function canonicalRoute(route: Plain): Plain {
  const ordered = reorder(route, ROUTE_KEYS);
  ordered.stops = (route.stops as unknown[]).map((s) => (isPlainObject(s) ? reorder(s, STOP_KEYS) : s));
  return ordered;
}

function serialize(value: unknown, indent: string): string {
  if (isStringArray(value)) return JSON.stringify(value);
  if (isRecordLike(value)) return JSON.stringify(reorder(value, RECORD_KEYS));
  if (isRouteLike(value)) return JSON.stringify(canonicalRoute(value));
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => `${inner}${v === undefined ? 'null' : serialize(v, inner)}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined && typeof v !== 'function');
    if (entries.length === 0) return '{}';
    const items = entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${serialize(v, inner)}`);
    return `{\n${items.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function serializeCastleJson(data: unknown): string {
  return `${serialize(data, '')}\n`;
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const content = serializeCastleJson(data);
  const tmpPath = `${filePath}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmpPath, content, 'utf8');
  try {
    await rename(tmpPath, filePath);
  } catch (err) {
    await rm(tmpPath, { force: true });
    throw err;
  }
}
