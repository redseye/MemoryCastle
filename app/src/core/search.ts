// search(q, {tags}): substring or regex scan over keep + chronicle + rooms
// (architecture §8: no vector store — a small curated store is searched
// directly).

import { makeChronicleCollection, makeKeepCollection, makeRoomsCollection } from './collections.js';
import type { CastleRecord, SearchResult } from './types.js';

export interface SearchOptions {
  tags?: string[];
  regex?: boolean;
}

const KEEP_SECTIONS = ['identity', 'constraints', 'core'] as const;

function matchesQuery(record: CastleRecord, q: string, opts: SearchOptions): boolean {
  if (opts.tags && opts.tags.length > 0 && !opts.tags.some((t) => record.tags.includes(t))) {
    return false;
  }
  if (!q) return true;
  if (opts.regex) {
    try {
      return new RegExp(q, 'i').test(record.fact);
    } catch {
      return false;
    }
  }
  return record.fact.toLowerCase().includes(q.toLowerCase());
}

export async function search(castleDir: string, q: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  const keep = makeKeepCollection(castleDir);
  for (const section of KEEP_SECTIONS) {
    for (const record of await keep.list(section)) {
      if (matchesQuery(record, q, opts)) results.push({ record, location: `keep:${section}` });
    }
  }

  const chronicle = makeChronicleCollection(castleDir);
  for (const record of await chronicle.list()) {
    if (matchesQuery(record, q, opts)) results.push({ record, location: 'chronicle' });
  }

  const rooms = makeRoomsCollection(castleDir);
  for (const room of await rooms.list()) {
    for (const record of room.records) {
      if (matchesQuery(record, q, opts)) results.push({ record, location: `room:${room.slug}` });
    }
  }

  return results;
}
