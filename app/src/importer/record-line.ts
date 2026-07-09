// Shared record-line parser for markdown castles (plan §8):
//   - [YYYY-MM-DD | conf:high|med|low | src:...] fact text #tag ⚠warning
// Trailing #tag tokens (possibly several) and a single ⚠<route> marker are
// pulled out of the fact text; whatever remains, trimmed, is the fact.

import { generateId } from '../core/ids.js';
import type { CastleRecord, Confidence } from '../core/types.js';

const RECORD_LINE_RE = /^-\s*\[(\d{4}-\d{2}-\d{2})\s*\|\s*conf:(high|med|low)\s*\|\s*src:([^\]]+)\]\s*(.+)$/;
const TAG_RE = /#(\S+)/g;
const WARNING_RE = /⚠([\w-]+)/;

export function parseRecordLine(line: string): CastleRecord | undefined {
  const match = RECORD_LINE_RE.exec(line.trim());
  if (!match) return undefined;
  const [, date, confidence, rawSource, rawFact] = match;
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
  text = text.replace(TAG_RE, (_, tag: string) => {
    tags.push(tag);
    return '';
  });

  return { fact: text.replace(/\s+/g, ' ').trim(), tags, routeWarning };
}
