import { describe, it, expect } from 'vitest';
import { matchArchiveMonth, parseArchiveChronicleMd } from '../src/importer/archive.js';

describe('matchArchiveMonth', () => {
  it('matches the strict chronicle-YYYY-MM.md pattern', () => {
    expect(matchArchiveMonth('chronicle-2026-07.md')).toBe('2026-07');
  });

  it('does not match files with extra suffixes, e.g. an English-original copy', () => {
    expect(matchArchiveMonth('chronicle-2026-07-en-original.md')).toBeUndefined();
  });

  it('does not match unrelated filenames', () => {
    expect(matchArchiveMonth('superseded.md')).toBeUndefined();
    expect(matchArchiveMonth('chronicle-2026.md')).toBeUndefined();
  });
});

describe('parseArchiveChronicleMd', () => {
  it('parses record lines and stamps sweptAt from the record date', () => {
    const md = `# Archive — 2026-07\n\n- [2026-07-01 | conf:high | src:session] 已封存的記錄。#meta\n`;
    const result = parseArchiveChronicleMd(md, 'archive/chronicle-2026-07.md');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].sweptAt).toBe('2026-07-01');
    expect(result.warnings).toHaveLength(0);
  });
});
