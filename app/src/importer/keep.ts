// Parses keep.md (plan §8): 3 sections mapped by heading keyword (身分→identity,
// 約束→constraints, 核心事實→core; legacy English headings tolerated), a
// "last patrol" header line, and record lines within each section.

import { DEFAULT_BUDGETS } from '../core/init.js';
import type { CastleRecord, KeepSection } from '../core/types.js';
import type { ImportWarning, ParsedKeep } from './types.js';
import { isBlank, isBlockquote, isCommentLine, isHeading, splitLines } from './line-helpers.js';
import { factLengthWarning, parseRecordLine } from './record-line.js';

const LAST_PATROL_PATTERNS = [/上次巡查[:：]\s*(\d{4}-\d{2}-\d{2})/, /Last patrol:\s*(\d{4}-\d{2}-\d{2})/i];

function detectSection(heading: string): KeepSection | undefined {
  const lower = heading.toLowerCase();
  if (heading.includes('身分') || lower.includes('identity')) return 'identity';
  if (heading.includes('約束') || lower.includes('constraint')) return 'constraints';
  if (heading.includes('核心事實') || lower.includes('core')) return 'core';
  return undefined;
}

export interface ParseKeepResult extends ParsedKeep {
  warnings: ImportWarning[];
}

export function parseKeepMd(content: string, file = 'keep.md', factMaxChars = DEFAULT_BUDGETS.factMaxChars): ParseKeepResult {
  const sections: Record<KeepSection, CastleRecord[]> = { identity: [], constraints: [], core: [] };
  const warnings: ImportWarning[] = [];
  let lastPatrolAt: string | null = null;
  let current: KeepSection | undefined;

  splitLines(content).forEach((line, i) => {
    const lineNo = i + 1;

    if (lastPatrolAt === null) {
      for (const re of LAST_PATROL_PATTERNS) {
        const m = re.exec(line);
        if (m) {
          lastPatrolAt = m[1];
          break;
        }
      }
    }

    if (isBlank(line) || isBlockquote(line) || isCommentLine(line)) return;

    if (isHeading(line)) {
      if (/^##\s/.test(line.trim())) current = detectSection(line.trim());
      // level-1 title line: structural only, no section change
      return;
    }

    const record = parseRecordLine(line);
    if (record) {
      if (current) {
        sections[current].push(record);
        const tooLong = factLengthWarning(record, factMaxChars, file, lineNo, line);
        if (tooLong) warnings.push(tooLong);
      } else {
        warnings.push({ file, line: lineNo, text: line, reason: 'record line found before any known section heading' });
      }
      return;
    }

    warnings.push({ file, line: lineNo, text: line, reason: 'unparseable line' });
  });

  return { sections, lastPatrolAt, warnings };
}
