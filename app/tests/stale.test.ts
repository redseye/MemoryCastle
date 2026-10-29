import { describe, it, expect } from 'vitest';
import { isStale } from '../src/core/index.js';
import type { CastleRecord } from '../src/core/types.js';

// Contract C3: hypothesis = conf:low, OR (source ≠ "user" AND
// today − max(date, verifiedAt) > stalenessDays).
function record(overrides: Partial<CastleRecord>): CastleRecord {
  return { id: 'x', date: '2026-01-01', confidence: 'high', source: 'session', fact: 'f', tags: [], ...overrides };
}

const budgets = { stalenessDays: 90 };
const today = new Date('2026-07-06T00:00:00Z');

describe('isStale', () => {
  it('is stale when confidence is low, regardless of date or source', () => {
    expect(isStale(record({ confidence: 'low', date: '2026-07-06' }), budgets, today)).toBe(true);
    expect(isStale(record({ confidence: 'low', date: '2026-07-06', source: 'user' }), budgets, today)).toBe(true);
  });

  it('is not stale when recent and confidence is not low', () => {
    expect(isStale(record({ confidence: 'high', date: '2026-07-01' }), budgets, today)).toBe(false);
  });

  it('is stale when a non-user record is older than 90 days', () => {
    expect(isStale(record({ confidence: 'high', date: '2026-01-01' }), budgets, today)).toBe(true);
  });

  it('is not stale at exactly 90 days (threshold is strictly-greater-than)', () => {
    expect(isStale(record({ confidence: 'med', date: '2026-04-07' }), budgets, today)).toBe(false);
  });

  it('is stale at 91 days', () => {
    expect(isStale(record({ confidence: 'med', date: '2026-04-06' }), budgets, today)).toBe(true);
  });

  it('exempts source "user" (a standing directive) from the age rule', () => {
    expect(isStale(record({ confidence: 'high', date: '2020-01-01', source: 'user' }), budgets, today)).toBe(false);
    expect(isStale(record({ confidence: 'med', date: '2020-01-01', source: 'user' }), budgets, today)).toBe(false);
  });

  it('measures age from verifiedAt when it is newer than date', () => {
    const reverified = record({ confidence: 'high', date: '2026-01-01', verifiedAt: '2026-06-01' });
    expect(isStale(reverified, budgets, today)).toBe(false);
    const sameRecordUnverified = record({ confidence: 'high', date: '2026-01-01' });
    expect(isStale(sameRecordUnverified, budgets, today)).toBe(true);
  });

  it('a verifiedAt that is itself older than the threshold still counts as stale', () => {
    expect(isStale(record({ date: '2026-01-01', verifiedAt: '2026-02-01' }), budgets, today)).toBe(true);
  });

  it('respects a custom stalenessDays budget', () => {
    expect(isStale(record({ confidence: 'high', date: '2026-07-01' }), { stalenessDays: 3 }, today)).toBe(true);
  });
});
