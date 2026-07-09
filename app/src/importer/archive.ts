// Parses archive/chronicle-YYYY-MM.md files (plan §8). Only the strict
// `chronicle-\d{4}-\d{2}\.md` filename pattern is treated as a parseable
// month archive; anything else under archive/ (e.g. an English-original
// provenance copy) is left alone by matchArchiveMonth and is handled purely
// as a file to move during apply — see importer/scan.ts.

import type { ChronicleArchiveEntry } from '../core/types.js';
import type { ImportWarning } from './types.js';
import { isBoilerplate, splitLines } from './line-helpers.js';
import { parseRecordLine } from './record-line.js';

const MONTH_ARCHIVE_RE = /^chronicle-(\d{4}-\d{2})\.md$/;

export function matchArchiveMonth(filename: string): string | undefined {
  const m = MONTH_ARCHIVE_RE.exec(filename);
  return m ? m[1] : undefined;
}

export interface ParseArchiveResult {
  entries: ChronicleArchiveEntry[];
  warnings: ImportWarning[];
}

export function parseArchiveChronicleMd(content: string, file: string): ParseArchiveResult {
  const entries: ChronicleArchiveEntry[] = [];
  const warnings: ImportWarning[] = [];

  splitLines(content).forEach((line, i) => {
    const lineNo = i + 1;
    if (isBoilerplate(line)) return;
    const record = parseRecordLine(line);
    if (record) {
      // The original sweep timestamp isn't recoverable from markdown; the
      // record's own date is the closest honest proxy.
      entries.push({ ...record, sweptAt: record.date });
      return;
    }
    warnings.push({ file, line: lineNo, text: line, reason: 'unparseable line' });
  });

  return { entries, warnings };
}
