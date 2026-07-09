// Atomic JSON file read/write. Writes go through a temp file + rename so a reader
// never observes a partially-written file. Callers are responsible for building
// their data objects with keys in the canonical schema order — JSON.stringify
// preserves insertion order for string keys, which is what gives us diff-stable
// output (2-space indent, trailing newline).

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

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const content = `${JSON.stringify(data, null, 2)}\n`;
  const tmpPath = `${filePath}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmpPath, content, 'utf8');
  try {
    await rename(tmpPath, filePath);
  } catch (err) {
    await rm(tmpPath, { force: true });
    throw err;
  }
}
