// Hand-written body validation for record/room payloads (plan §2 field set).
// No schema library per the plan's dependency budget — these mirror the
// RecordInput/RoomInput shapes in core/types.ts exactly, so a widening of
// the domain type is the only place that also needs a widening here.

import type { Confidence, RecordInput, RecordPatch, RoomInput, RoomPatch } from '../core/index.js';
import { HttpError } from './http-errors.js';

const CONFIDENCES: Confidence[] = ['high', 'med', 'low'];

function isConfidence(value: unknown): value is Confidence {
  return typeof value === 'string' && (CONFIDENCES as string[]).includes(value);
}

export function parseRecordInput(body: Record<string, unknown>): RecordInput {
  if (typeof body.fact !== 'string' || body.fact.trim() === '') {
    throw new HttpError(400, 'invalid_body', 'fact 為必填字串');
  }
  if (!isConfidence(body.confidence)) {
    throw new HttpError(400, 'invalid_body', 'confidence 必須是 high/med/low 其中之一');
  }
  if (typeof body.source !== 'string' || body.source.trim() === '') {
    throw new HttpError(400, 'invalid_body', 'source 為必填字串');
  }
  const input: RecordInput = { confidence: body.confidence, source: body.source, fact: body.fact };
  if (typeof body.date === 'string') input.date = body.date;
  if (Array.isArray(body.tags)) input.tags = body.tags as string[];
  if (typeof body.routeWarning === 'string') input.routeWarning = body.routeWarning;
  return input;
}

export function parseRecordPatch(body: Record<string, unknown>): RecordPatch {
  const patch: RecordPatch = {};
  if (typeof body.date === 'string') patch.date = body.date;
  if (body.confidence !== undefined) {
    if (!isConfidence(body.confidence)) {
      throw new HttpError(400, 'invalid_body', 'confidence 必須是 high/med/low 其中之一');
    }
    patch.confidence = body.confidence;
  }
  if (typeof body.source === 'string') patch.source = body.source;
  if (typeof body.fact === 'string') patch.fact = body.fact;
  if (Array.isArray(body.tags)) patch.tags = body.tags as string[];
  if (typeof body.routeWarning === 'string') patch.routeWarning = body.routeWarning;
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
