// Shared record-line parser for markdown castles (plan §8, contract C2):
//   - [YYYY-MM-DD | conf:high|med|low | src:... | ver:YYYY-MM-DD] fact text ⚠warning #tag
// The `ver:` skeleton field is optional. A single ⚠<route> marker and the
// trailing run of #tag tokens are pulled out of the fact text (and stripped
// from it); a "#" earlier in the sentence (e.g. "PR #12 之後") stays part of
// the fact. Whatever remains, whitespace-collapsed, is the fact.

import { generateId } from '../core/ids.js';
import type { CastleRecord, Confidence } from '../core/types.js';
import type { ImportWarning } from './types.js';

const RECORD_LINE_RE =
  /^-\s*\[(\d{4}-\d{2}-\d{2})\s*\|\s*conf:(high|med|low)\s*\|\s*src:([^\]]+?)(?:\s*\|\s*ver:(\d{4}-\d{2}-\d{2}))?\s*\]\s*(.+)$/;
const TRAILING_TAG_RE = /#([^\s#]+)\s*$/;
const WARNING_RE = /⚠([\w-]+)/;

export function parseRecordLine(line: string): CastleRecord | undefined {
  const match = RECORD_LINE_RE.exec(line.trim());
  if (!match) return undefined;
  const [, date, confidence, rawSource, verifiedAt, rawFact] = match;
  const { fact, tags, routeWarning } = extractTagsAndWarning(rawFact);

  const record: CastleRecord = {
    id: generateId(),
    date,
    confidence: confidence as Confidence,
    source: rawSource.trim(),
    fact,
    tags,
  };
  if (routeWarning) record.routeWarning = routeWarning;
  if (verifiedAt) record.verifiedAt = verifiedAt;
  return record;
}

function extractTagsAndWarning(rawFact: string): { fact: string; tags: string[]; routeWarning?: string } {
  let text = rawFact;

  let routeWarning: string | undefined;
  const warnMatch = WARNING_RE.exec(text);
  if (warnMatch && warnMatch.index !== undefined) {
    routeWarning = warnMatch[1];
    text = text.slice(0, warnMatch.index) + text.slice(warnMatch.index + warnMatch[0].length);
  }

  const tags: string[] = [];
  let tagMatch = TRAILING_TAG_RE.exec(text);
  while (tagMatch) {
    tags.unshift(tagMatch[1]);
    text = text.slice(0, tagMatch.index);
    tagMatch = TRAILING_TAG_RE.exec(text);
  }

  return { fact: text.replace(/\s+/g, ' ').trim(), tags, routeWarning };
}

// Over-length records are still imported (an importer never drops data) but
// reported, so patrol knows what to split (contract C1).
export function factLengthWarning(
  record: CastleRecord,
  factMaxChars: number,
  file: string,
  line: number,
  text: string,
): ImportWarning | undefined {
  if (record.fact.length <= factMaxChars) return undefined;
  return { file, line, text, reason: `fact exceeds ${factMaxChars} chars (${record.fact.length}); imported as-is, split it during patrol` };
}
