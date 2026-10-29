// Parses rooms/*.md (plan §8): `# Room: <name>` header, `locus:`/`adjacent:`/
// `emblem:` metadata lines, and record lines. locus/adjacent are split on
// ／、, ; adjacent "none" (case-insensitive) means no adjacent rooms.

import { DEFAULT_BUDGETS } from '../core/init.js';
import type { CastleRecord } from '../core/types.js';
import type { ImportWarning, ParsedRoom } from './types.js';
import { isBlank, isBoilerplate, splitLines } from './line-helpers.js';
import { factLengthWarning, parseRecordLine } from './record-line.js';

const NAME_RE = /^#\s*Room:\s*(.+)$/i;
const LOCUS_RE = /^locus:\s*(.*)$/i;
const ADJACENT_RE = /^adjacent:\s*(.*)$/i;
const EMBLEM_RE = /^emblem:\s*(.*)$/i;
const LIST_SPLIT_RE = /[／、,]/;

function splitList(value: string): string[] {
  return value
    .split(LIST_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface ParseRoomResult extends ParsedRoom {
  warnings: ImportWarning[];
}

export function parseRoomMd(
  content: string,
  slug: string,
  file: string,
  factMaxChars = DEFAULT_BUDGETS.factMaxChars,
): ParseRoomResult {
  let name = slug;
  let locus: string[] = [];
  let adjacent: string[] = [];
  let emblem: string | null = null;
  const records: CastleRecord[] = [];
  const warnings: ImportWarning[] = [];

  splitLines(content).forEach((line, i) => {
    const lineNo = i + 1;
    if (isBlank(line)) return;
    const trimmed = line.trim();

    const nameMatch = NAME_RE.exec(trimmed);
    if (nameMatch) {
      name = nameMatch[1].trim();
      return;
    }

    const locusMatch = LOCUS_RE.exec(trimmed);
    if (locusMatch) {
      locus = splitList(locusMatch[1]);
      return;
    }

    const adjacentMatch = ADJACENT_RE.exec(trimmed);
    if (adjacentMatch) {
      const raw = adjacentMatch[1].trim();
      adjacent = raw.toLowerCase() === 'none' ? [] : splitList(raw);
      return;
    }

    const emblemMatch = EMBLEM_RE.exec(trimmed);
    if (emblemMatch) {
      const raw = emblemMatch[1].trim();
      emblem = raw.length > 0 ? raw : null;
      return;
    }

    if (isBoilerplate(line)) return;

    const record = parseRecordLine(line);
    if (record) {
      records.push(record);
      const tooLong = factLengthWarning(record, factMaxChars, file, lineNo, line);
      if (tooLong) warnings.push(tooLong);
      return;
    }

    warnings.push({ file, line: lineNo, text: line, reason: 'unparseable line' });
  });

  return { slug, name, locus, adjacent, emblem, records, warnings };
}
