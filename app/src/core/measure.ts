// measureCastle: estimated token cost of what a castle makes a model load,
// so the token-saving claim is a number instead of a promise. Deterministic
// and LLM-free. The estimate is deliberately crude and always labelled as
// one: CJK characters count 1 token each, every other character 1/4.
//
//   (a) session start = patrol-check output + keep + last handover + one
//       room (mean and max over all rooms — rooms-by-locus loads only the
//       rooms the session's paths fall in)
//   (b) flat-file equivalent = every live record (keep + rooms + chronicle)
//       as one-line §2 markdown, i.e. "one big memory file"
//   (c) patrol payload = everything the patrol route reads
// Records are rendered as §2 lines in (a)/(b)/(c) so the ratio a/b isolates
// the routing saving; `sessionStartStored` repeats (a) over the JSON exactly
// as it sits on disk, which is what a model reading the files pays.

import { readFile } from 'node:fs/promises';
import { openCastle } from './castle.js';
import { keepJsonPath, roomJsonPath } from './layout.js';
import { newestHandover, renderRecordLine } from './record-ops.js';
import type { CastleRecord } from './types.js';
import { patrolTriggerLine } from './walk.js';

const CJK_RE = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯\u{20000}-\u{2ffff}]/u;

export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (CJK_RE.test(ch)) cjk++;
    else other++;
  }
  return Math.round(cjk + other / 4);
}

export interface SessionStartMeasure {
  patrolCheck: number;
  keep: number;
  lastHandover: number;
  roomMean: number;
  roomMax: number;
  totalMean: number;
  totalMax: number;
}

export interface CastleMeasure {
  root: string;
  maxRoomSlug: string | null;
  sessionStart: SessionStartMeasure;
  sessionStartStored: SessionStartMeasure;
  flat: { records: number; tokens: number };
  patrol: number;
  ratioMean: number | null; // sessionStart.totalMean / flat.tokens; null when flat is empty
  ratioMax: number | null;
}

function linesTokens(records: CastleRecord[]): number {
  return estimateTokens(records.map(renderRecordLine).join('\n'));
}

function sessionStartOf(patrolCheck: number, keep: number, lastHandover: number, rooms: number[]): SessionStartMeasure {
  const roomMean = rooms.length > 0 ? Math.round(rooms.reduce((a, b) => a + b, 0) / rooms.length) : 0;
  const roomMax = rooms.reduce((a, b) => Math.max(a, b), 0);
  const base = patrolCheck + keep + lastHandover;
  return { patrolCheck, keep, lastHandover, roomMean, roomMax, totalMean: base + roomMean, totalMax: base + roomMax };
}

export async function measureCastle(root: string, now: Date = new Date()): Promise<CastleMeasure> {
  const castle = await openCastle(root); // NoCastleError propagates to the caller
  const [keep, chronicle, rooms, routes, due] = await Promise.all([
    castle.keep.list(),
    castle.chronicle.list(),
    castle.rooms.list(),
    castle.routes.list(),
    castle.patrolDue(now),
  ]);

  const patrolCheck = estimateTokens(due.triggers.map(patrolTriggerLine).join('\n'));
  const handover = newestHandover(chronicle);
  const roomLines = rooms.map((room) => linesTokens(room.records));
  const maxIdx = roomLines.reduce((best, t, i) => (best === -1 || t > roomLines[best] ? i : best), -1);
  const sessionStart = sessionStartOf(patrolCheck, linesTokens(keep), handover ? linesTokens([handover]) : 0, roomLines);

  const storedKeep = estimateTokens(await readFile(keepJsonPath(castle.castleDir), 'utf8'));
  const storedRooms = await Promise.all(
    rooms.map(async (room) => estimateTokens(await readFile(roomJsonPath(castle.castleDir, room.slug), 'utf8'))),
  );
  const sessionStartStored = sessionStartOf(
    patrolCheck,
    storedKeep,
    handover ? estimateTokens(JSON.stringify(handover)) : 0,
    storedRooms,
  );

  const live = [...keep, ...rooms.flatMap((r) => r.records), ...chronicle];
  const flat = { records: live.length, tokens: linesTokens(live) };
  const routeLines = routes.map((r) => `${r.name}: ${r.stops.map((s) => `${s.target}/${s.read}`).join(' → ')}`);
  const patrol = estimateTokens([...live.map(renderRecordLine), ...routeLines].join('\n'));

  return {
    root: castle.root,
    maxRoomSlug: maxIdx === -1 ? null : rooms[maxIdx].slug,
    sessionStart,
    sessionStartStored,
    flat,
    patrol,
    ratioMean: flat.tokens > 0 ? sessionStart.totalMean / flat.tokens : null,
    ratioMax: flat.tokens > 0 ? sessionStart.totalMax / flat.tokens : null,
  };
}
