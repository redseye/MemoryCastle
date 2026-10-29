// Parses chronicle.md (plan §8): every non-boilerplate line must be a record
// line; anything else non-empty is an unparseable-line warning.

import { DEFAULT_BUDGETS } from '../core/init.js';
import type { CastleRecord } from '../core/types.js';
import type { ImportWarning } from './types.js';
import { isBoilerplate, splitLines } from './line-helpers.js';
import { factLengthWarning, parseRecordLine } from './record-line.js';

export interface ParseChronicleResult {
  entries: CastleRecord[];
  warnings: ImportWarning[];
}

export function parseChronicleMd(
  content: string,
  file = 'chronicle.md',
  factMaxChars = DEFAULT_BUDGETS.factMaxChars,
): ParseChronicleResult {
  const entries: CastleRecord[] = [];
  const warnings: ImportWarning[] = [];

  splitLines(content).forEach((line, i) => {
    const lineNo = i + 1;
    if (isBoilerplate(line)) return;
    const record = parseRecordLine(line);
    if (record) {
      entries.push(record);
      const tooLong = factLengthWarning(record, factMaxChars, file, lineNo, line);
      if (tooLong) warnings.push(tooLong);
      return;
    }
    warnings.push({ file, line: lineNo, text: line, reason: 'unparseable line' });
  });

  return { entries, warnings };
}
