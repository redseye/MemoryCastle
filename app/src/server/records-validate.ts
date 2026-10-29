// Hand-written body validation for record/room payloads (plan §2 field set).
// No schema library per the plan's dependency budget — these mirror the
// RecordInput/RoomInput shapes in core/types.ts exactly, so a widening of
// the domain type is the only place that also needs a widening here.
//
// Record rules (contract C1/C2) need the castle: the fact cap comes from
// castle.json budgets and a ⚠routeWarning must name an existing route — see
// loadRecordRules().

import type { Castle, Confidence, RecordInput, RecordPatch, RoomInput, RoomPatch } from '../core/index.js';
import { HttpError } from './http-errors.js';

const CONFIDENCES: Confidence[] = ['high', 'med', 'low'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface RecordRules {
  factMaxChars: number;
  routeNames: string[];
}

export async function loadRecordRules(castle: Castle): Promise<RecordRules> {
  const [meta, routes] = await Promise.all([castle.getMeta(), castle.routes.list()]);
  return { factMaxChars: meta.budgets.factMaxChars, routeNames: routes.map((r) => r.name) };
}

function isConfidence(value: unknown): value is Confidence {
  return typeof value === 'string' && (CONFIDENCES as string[]).includes(value);
}

function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function checkFact(fact: string, rules: RecordRules): void {
  if (/[\r\n]/.test(fact)) {
    throw new HttpError(400, 'fact_multiline', 'fact 必須是單行（一行一事實）；段落請放 archive/ 並在記錄中附路徑');
  }
  if (fact.length > rules.factMaxChars) {
    throw new HttpError(400, 'fact_too_long', `fact 長 ${fact.length} 字元，超過上限 ${rules.factMaxChars}；請拆成多筆一行一事實`);
  }
}

function checkRouteWarning(routeWarning: string, rules: RecordRules): void {
  if (!rules.routeNames.includes(routeWarning)) {
    throw new HttpError(400, 'route_warning_invalid', `routeWarning 指向不存在的路線：${routeWarning}`);
  }
}

function checkVerifiedAt(value: unknown): string {
  if (typeof value !== 'string' || !isCalendarDate(value)) {
    throw new HttpError(400, 'invalid_body', 'verifiedAt 必須是 YYYY-MM-DD 日期');
  }
  return value;
}

export function parseRecordInput(body: Record<string, unknown>, rules: RecordRules): RecordInput {
  if (typeof body.fact !== 'string' || body.fact.trim() === '') {
    throw new HttpError(400, 'invalid_body', 'fact 為必填字串');
  }
  if (!isConfidence(body.confidence)) {
    throw new HttpError(400, 'invalid_body', 'confidence 必須是 high/med/low 其中之一');
  }
  if (typeof body.source !== 'string' || body.source.trim() === '') {
    throw new HttpError(400, 'invalid_body', 'source 為必填字串');
  }
  checkFact(body.fact, rules);
  const input: RecordInput = { confidence: body.confidence, source: body.source, fact: body.fact };
  if (typeof body.date === 'string') input.date = body.date;
  if (Array.isArray(body.tags)) input.tags = body.tags as string[];
  if (typeof body.routeWarning === 'string') {
    checkRouteWarning(body.routeWarning, rules);
    input.routeWarning = body.routeWarning;
  }
  if (body.verifiedAt !== undefined) input.verifiedAt = checkVerifiedAt(body.verifiedAt);
  return input;
}

export function parseRecordPatch(body: Record<string, unknown>, rules: RecordRules): RecordPatch {
  const patch: RecordPatch = {};
  if (typeof body.date === 'string') patch.date = body.date;
  if (body.confidence !== undefined) {
    if (!isConfidence(body.confidence)) {
      throw new HttpError(400, 'invalid_body', 'confidence 必須是 high/med/low 其中之一');
    }
    patch.confidence = body.confidence;
  }
  if (typeof body.source === 'string') patch.source = body.source;
  if (typeof body.fact === 'string') {
    checkFact(body.fact, rules);
    patch.fact = body.fact;
  }
  if (Array.isArray(body.tags)) patch.tags = body.tags as string[];
  if (typeof body.routeWarning === 'string') {
    checkRouteWarning(body.routeWarning, rules);
    patch.routeWarning = body.routeWarning;
  }
  if (body.verifiedAt !== undefined) patch.verifiedAt = checkVerifiedAt(body.verifiedAt);
  return patch;
}

export function parseRoomInput(body: Record<string, unknown>): RoomInput {
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    throw new HttpError(400, 'invalid_body', 'name 為必填字串');
  }
  const input: RoomInput = { name: body.name };
  if (typeof body.slug === 'string') input.slug = body.slug;
  if (Array.isArray(body.locus)) input.locus = body.locus as string[];
  if (Array.isArray(body.adjacent)) input.adjacent = body.adjacent as string[];
  if (body.emblem === null || typeof body.emblem === 'string') input.emblem = body.emblem;
  return input;
}

export function parseRoomPatch(body: Record<string, unknown>): RoomPatch {
  const patch: RoomPatch = {};
  if (typeof body.name === 'string') patch.name = body.name;
  if (Array.isArray(body.locus)) patch.locus = body.locus as string[];
  if (Array.isArray(body.adjacent)) patch.adjacent = body.adjacent as string[];
  if (body.emblem === null || typeof body.emblem === 'string') patch.emblem = body.emblem;
  return patch;
}

// Write-time budget (contract C1, architecture §4 thresholds): an append that
// would take a collection past its cap is refused unless the caller opts in
// with override:true — the over-budget state is patrol's job to resolve.
export function checkAppendBudget(body: Record<string, unknown>, count: number, max: number, what: string): void {
  if (count >= max && body.override !== true) {
    throw new HttpError(
      409,
      'over_budget',
      `${what} 已有 ${count} 筆，達上限 ${max}；請先巡查整理（distill／cut），或確定要超出時帶 override:true`,
    );
  }
}
