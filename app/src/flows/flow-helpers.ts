// Deterministic helpers shared by the LLM flows (rule R7: counting, length
// checks, keyword lookup, and scheduling are code, never a model judgment).

import type { Castle } from '../core/castle.js';
import { isHandoverEntry } from '../core/record-ops.js';
import type { CastleRecord } from '../core/types.js';

// Architecture §2 length cap, applied to every fact a flow is about to write
// or propose: one line, at most factMaxChars JS string length (a CJK
// character counts 1). Returns why the fact breaks it, or null when it fits.
// A flow never truncates — an offending fact is rewritten by the model or
// dropped.
export function factProblem(fact: string, factMaxChars: number): 'fact_empty' | 'fact_multiline' | 'fact_too_long' | null {
  if (fact.trim() === '') return 'fact_empty';
  if (/[\r\n]/.test(fact)) return 'fact_multiline';
  if (fact.length > factMaxChars) return 'fact_too_long';
  return null;
}

// Runs fn over items with at most `limit` calls in flight, results in input
// order. After the first rejection no further item starts (in-flight ones
// settle on their own — every patrol call shares one AbortSignal), and that
// first error is what the returned promise rejects with.
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  async function worker(): Promise<void> {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index], index);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export const SEARCH_HITS = 5;

export interface SearchHit {
  record: CastleRecord;
  location: string; // 'keep:<section>' | 'chronicle' | 'room:<slug>'
}

// Lowercased ASCII words of 3+ characters, plus CJK bigrams — Chinese has
// no spaces to split on, and two characters is the shortest unit that still
// carries meaning.
function searchTerms(text: string): string[] {
  const terms = new Set<string>(text.toLowerCase().match(/[a-z0-9][a-z0-9._/-]{2,}/g) ?? []);
  for (const run of text.match(/[\u3400-\u9fff\uf900-\ufaff]+/g) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) terms.add(run.slice(i, i + 2));
  }
  return [...terms];
}

// Deterministic keyword ranking over keep + rooms + chronicle (handovers are
// session state, never a duplicate) — the remember gate's novelty context and
// the patrol's "recorded elsewhere?" check before a handover is swept. A
// record scores one per distinct term
// of the text its fact or tags contain; the best `limit` with a score > 0
// win, newer first on ties.
export async function topSearchHits(castle: Castle, text: string, limit = SEARCH_HITS): Promise<SearchHit[]> {
  const terms = searchTerms(text);
  if (terms.length === 0) return [];
  const pool: SearchHit[] = [];
  for (const section of ['identity', 'constraints', 'core'] as const) {
    for (const record of await castle.keep.list(section)) pool.push({ record, location: `keep:${section}` });
  }
  for (const room of await castle.rooms.list()) {
    for (const record of room.records) pool.push({ record, location: `room:${room.slug}` });
  }
  for (const record of await castle.chronicle.list()) {
    if (!isHandoverEntry(record)) pool.push({ record, location: 'chronicle' });
  }
  return pool
    .map((hit) => {
      const haystack = `${hit.record.fact} ${hit.record.tags.join(' ')}`.toLowerCase();
      return { hit, score: terms.filter((t) => haystack.includes(t)).length };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (a.hit.record.date < b.hit.record.date ? 1 : a.hit.record.date > b.hit.record.date ? -1 : 0))
    .slice(0, limit)
    .map((s) => s.hit);
}
