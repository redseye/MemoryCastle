// The web bundle can't import src/core (Node built-ins in its graph), so it
// reimplements the C3 staleness rule in web/src/staleness.ts. This holds the
// two implementations to the same answer on every branch of the rule.

import { describe, expect, it } from 'vitest';
import { isStale as coreIsStale } from '../src/core/budgets.js';
import type { CastleRecord } from '../src/core/types.js';
import { isStale as webIsStale } from '../web/src/staleness.js';

const today = new Date('2026-10-28T12:00:00Z');

function rec(patch: Partial<CastleRecord>): CastleRecord {
  return { id: 'r', date: '2026-10-01', confidence: 'high', source: 'session', fact: 'f', tags: [], ...patch };
}

const CASES: [string, CastleRecord, boolean][] = [
  ['fresh, high', rec({}), false],
  ['conf low is always a hypothesis', rec({ confidence: 'low', source: 'user' }), true],
  ['old non-user record', rec({ date: '2026-07-01' }), true],
  ['exactly stalenessDays old is not yet stale', rec({ date: '2026-07-30' }), false],
  ['one day past stalenessDays', rec({ date: '2026-07-29' }), true],
  ['old user directive is exempt from aging', rec({ date: '2020-01-01', source: 'user' }), false],
  ['old record re-verified recently', rec({ date: '2020-01-01', verifiedAt: '2026-10-20' }), false],
  ['old record re-verified long ago', rec({ date: '2020-01-01', verifiedAt: '2026-01-01' }), true],
  ['verifiedAt older than date: date wins', rec({ date: '2026-10-01', verifiedAt: '2020-01-01' }), false],
];

describe('web staleness rule (C3) matches src/core', () => {
  it.each(CASES)('%s', (_name, record, expected) => {
    expect(coreIsStale(record, { stalenessDays: 90 }, today)).toBe(expected);
    expect(webIsStale(record, 90, today)).toBe(expected);
  });
});
