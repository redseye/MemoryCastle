// Budget counting, patrol trigger detection (architecture §4: four
// conditions, any one holding means patrol is due — every fired one is
// reported, not just the first), and staleness detection (contract C3).
// readCastleMeta is the one place castle.json is read, so a castle written
// before a budget existed (e.g. factMaxChars) still gets its default.

import { readJsonFile, writeJsonFile } from '../storage/json-file.js';
import { makeChronicleCollection, makeKeepCollection, makeRoomsCollection } from './collections.js';
import { daysBetween, localDate } from './ids.js';
import { DEFAULT_BUDGETS } from './init.js';
import { castleJsonPath } from './layout.js';
import type { Budgets, BudgetCounts, CastleMeta, CastleRecord, PatrolDueResult, PatrolTrigger } from './types.js';

export async function readCastleMeta(castleDir: string): Promise<CastleMeta> {
  const meta = await readJsonFile<CastleMeta>(castleJsonPath(castleDir));
  return { ...meta, budgets: { ...DEFAULT_BUDGETS, ...meta.budgets } };
}

// Contract C6: a completed patrol stamps castle.json's lastPatrolAt with today.
export async function markPatrolled(castleDir: string, now: Date = new Date()): Promise<CastleMeta> {
  const path = castleJsonPath(castleDir);
  const meta = await readJsonFile<CastleMeta>(path);
  const updated: CastleMeta = { ...meta, lastPatrolAt: localDate(now) };
  await writeJsonFile(path, updated);
  return updated;
}

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

// Trigger 1's count: entries dated strictly after the last patrol, or every
// entry when there was none. Shared by patrolDue, the patrol pre-pass, and
// the dashboard's "since last patrol" gauge so the three never disagree.
export function countSincePatrol(entries: CastleRecord[], lastPatrolAt: string | null): number {
  return lastPatrolAt ? entries.filter((e) => e.date > lastPatrolAt).length : entries.length;
}

// Contract v0.5.1: trigger 1 counts only chronicle entries dated strictly
// after lastPatrolAt (all of them when there was no patrol yet) — young
// unclustered singletons that survive a patrol must not re-fire it every
// session until they age out.
export async function patrolDue(castleDir: string, now: Date = new Date()): Promise<PatrolDueResult> {
  const meta = await readCastleMeta(castleDir);
  const counts = await countBudgets(castleDir);
  const { budgets, lastPatrolAt } = meta;
  const triggers: PatrolTrigger[] = [];

  const unswept = countSincePatrol(await makeChronicleCollection(castleDir).list(), lastPatrolAt);
  if (unswept >= budgets.chronicleSweep) {
    triggers.push({
      kind: 'chronicle',
      target: 'chronicle',
      count: unswept,
      limit: budgets.chronicleSweep,
      reason: `chronicle>=${budgets.chronicleSweep}`,
    });
  }
  for (const room of counts.rooms) {
    if (room.count > budgets.roomMax) {
      triggers.push({
        kind: 'room',
        target: `room:${room.slug}`,
        count: room.count,
        limit: budgets.roomMax,
        reason: `room:${room.slug}>${budgets.roomMax}`,
      });
    }
  }
  if (counts.keepCount > budgets.keepMax) {
    triggers.push({ kind: 'keep', target: 'keep', count: counts.keepCount, limit: budgets.keepMax, reason: `keep>${budgets.keepMax}` });
  }
  if (lastPatrolAt) {
    const days = daysBetween(lastPatrolAt, now);
    if (days > budgets.patrolDays) {
      triggers.push({ kind: 'days', target: 'patrol', count: days, limit: budgets.patrolDays, reason: `daysSincePatrol>${budgets.patrolDays}` });
    }
  } else {
    // §4 trigger 4: null lastPatrolAt (never patrolled) fires; count = days
    // since the castle was created, the closest honest figure.
    const sinceCreated = daysBetween(meta.createdAt, now);
    triggers.push({
      kind: 'days',
      target: 'patrol',
      count: Number.isFinite(sinceCreated) ? sinceCreated : 0,
      limit: budgets.patrolDays,
      reason: 'neverPatrolled',
    });
  }

  return { due: triggers.length > 0, reasons: triggers.map((t) => t.reason), triggers };
}

// Contract C3: a record is a hypothesis when conf is low, or when it is not a
// standing user directive (source "user" is exempt from the age rule) and
// more than stalenessDays have passed since max(date, verifiedAt).
export function isStale(record: CastleRecord, budgets: Pick<Budgets, 'stalenessDays'>, today: Date = new Date()): boolean {
  if (record.confidence === 'low') return true;
  if (record.source === 'user') return false;
  const lastSeen = record.verifiedAt && record.verifiedAt > record.date ? record.verifiedAt : record.date;
  return daysBetween(lastSeen, today) > budgets.stalenessDays;
}
