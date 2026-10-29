// Staleness rule (contract C3, architecture §2), reimplemented for the
// browser bundle — src/core/budgets.ts isStale is the source of truth and
// tests/web-staleness.test.ts holds the two to the same answers. A record
// is a hypothesis when conf is low, or when its source is not "user" (a
// standing directive is exempt from aging) and more than stalenessDays have
// passed since the later of date and verifiedAt. Days are whole calendar
// days, computed exactly like core's daysBetween.

import type { Confidence } from './types';

export const STALENESS_DAYS_DEFAULT = 90;

export interface StalenessInput {
  date: string;
  confidence: Confidence;
  source: string;
  verifiedAt?: string;
}

function daysBetween(dateStr: string, now: Date): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((end - start) / 86400000);
}

export function isStale(record: StalenessInput, stalenessDays = STALENESS_DAYS_DEFAULT, today: Date = new Date()): boolean {
  if (record.confidence === 'low') return true;
  if (record.source === 'user') return false;
  const lastSeen = record.verifiedAt && record.verifiedAt > record.date ? record.verifiedAt : record.date;
  return daysBetween(lastSeen, today) > stalenessDays;
}
