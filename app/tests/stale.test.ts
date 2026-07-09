import { describe, it, expect } from 'vitest';
import { isStale } from '../src/core/index.js';
import type { CastleRecord } from '../src/core/types.js';

function record(overrides: Partial<CastleRecord>): CastleRecord {
  return { id: 'x', date: '2026-01-01', confidence: 'high', source: 'user', fact: 'f', tags: [], ...overrides };
}

describe('isStale', () => {
  it('is stale when confidence is low, regardless of date', () => {
    const r = record({ confidence: 'low', date: '2026-07-06' });
    expect(isStale(r, new Date('2026-07-06T00:00:00Z'))).toBe(true);
  });

  it('is not stale when recent and confidence is not low', () => {
    const r = record({ confidence: 'high', date: '2026-07-01' });
    expect(isStale(r, new Date('2026-07-06T00:00:00Z'))).toBe(false);
  });

  it('is stale when older than 90 days', () => {
    const r = record({ confidence: 'high', date: '2026-01-01' });
    expect(isStale(r, new Date('2026-07-06T00:00:00Z'))).toBe(true);
  });

  it('is not stale at exactly 90 days (threshold is strictly-greater-than)', () => {
    const r = record({ confidence: 'med', date: '2026-04-07' }); // exactly 90 days before 2026-07-06
    expect(isStale(r, new Date('2026-07-06T00:00:00Z'))).toBe(false);
  });

  it('is stale at 91 days', () => {
    const r = record({ confidence: 'med', date: '2026-04-06' }); // 91 days before 2026-07-06
    expect(isStale(r, new Date('2026-07-06T00:00:00Z'))).toBe(true);
  });

  it('respects a custom staleDays threshold', () => {
    const r = record({ confidence: 'high', date: '2026-07-01' });
    expect(isStale(r, new Date('2026-07-06T00:00:00Z'), 3)).toBe(true);
  });
});
