// Budget counting, patrol trigger detection (architecture §4: four
// conditions, any one holding means patrol is due), and staleness detection
// (architecture §2: conf:low or older than the staleness threshold).

import { readJsonFile } from '../storage/json-file.js';
import { makeChronicleCollection, makeKeepCollection, makeRoomsCollection } from './collections.js';
import { daysBetween } from './ids.js';
import { castleJsonPath } from './layout.js';
import type { BudgetCounts, CastleMeta, CastleRecord, PatrolDueResult } from './types.js';

export async function countBudgets(castleDir: string): Promise<BudgetCounts> {
  const keep = makeKeepCollection(castleDir);
  const chronicle = makeChronicleCollection(castleDir);
  const rooms = makeRoomsCollection(castleDir);

  const keepCount = (await keep.list()).length;
  const chronicleCount = (await chronicle.list()).length;
  const roomCounts = (await rooms.list()).map((r) => ({ slug: r.slug, count: r.records.length }));
  const maxRoomCount = roomCounts.reduce((max, r) => Math.max(max, r.count), 0);

  return { keepCount, chronicleCount, rooms: roomCounts, maxRoomCount };
}

export async function patrolDue(castleDir: string, now: Date = new Date()): Promise<PatrolDueResult> {
  const meta = await readJsonFile<CastleMeta>(castleJsonPath(castleDir));
  const counts = await countBudgets(castleDir);
  const reasons: string[] = [];

  if (counts.chronicleCount >= meta.budgets.chronicleSweep) {
    reasons.push(`chronicle>=${meta.budgets.chronicleSweep}`);
  }
  const overRoom = counts.rooms.find((r) => r.count > meta.budgets.roomMax);
  if (overRoom) reasons.push(`room:${overRoom.slug}>${meta.budgets.roomMax}`);
  if (counts.keepCount > meta.budgets.keepMax) reasons.push(`keep>${meta.budgets.keepMax}`);
  if (meta.lastPatrolAt) {
    const days = daysBetween(meta.lastPatrolAt, now);
    if (days > meta.budgets.patrolDays) reasons.push(`daysSincePatrol>${meta.budgets.patrolDays}`);
  }

  return { due: reasons.length > 0, reasons };
}

export function isStale(record: CastleRecord, now: Date, staleDays = 90): boolean {
  if (record.confidence === 'low') return true;
  return daysBetween(record.date, now) > staleDays;
}
