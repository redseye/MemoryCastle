// Local-date and id helpers. localDate reuses the castle-init.mjs lesson:
// toLocaleDateString('sv') yields YYYY-MM-DD in the *local* timezone (not UTC).

import { randomBytes } from 'node:crypto';

export function localDate(now: Date = new Date()): string {
  return now.toLocaleDateString('sv');
}

// 8-char lowercase alphanumeric id, e.g. "m7k2x9ab".
export function generateId(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (const b of bytes) {
    out += (b % 36).toString(36);
  }
  return out;
}

// Calendar-day difference between a YYYY-MM-DD date string and `now`, both
// interpreted as UTC calendar dates (no time-of-day component) so results are
// deterministic regardless of the host's local timezone or time of day.
export function daysBetween(dateStr: string, now: Date): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((end - start) / 86400000);
}
