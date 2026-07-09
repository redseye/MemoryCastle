// Parses chronicle.md (plan §8): every non-boilerplate line must be a record
// line; anything else non-empty is an unparseable-line warning.

import type { CastleRecord } from '../core/types.js';
import type { ImportWarning } from './types.js';
import { isBoilerplate, splitLines } from './line-helpers.js';
import { parseRecordLine } from './record-line.js';

export interface ParseChronicleResult {
  entries: CastleRecord[];
  warnings: ImportWarning[];
}

export function parseChronicleMd(content: string, file = 'chronicle.md'): ParseChronicleResult {
  const entries: CastleRecord[] = [];
  const warnings: ImportWarning[] = [];

  splitLines(content).forEach((line, i) => {
    const lineNo = i + 1;
    if (isBoilerplate(line)) return;
    const record = parseRecordLine(line);
    if (record) {
      entries.push(record);
      return;
    }
    warnings.push({ file, line: lineNo, text: line, reason: 'unparseable line' });
  });

  return { entries, warnings };
}
