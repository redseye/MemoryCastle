import { describe, it, expect } from 'vitest';
import { factLengthWarning, parseRecordLine } from '../src/importer/record-line.js';
import { renderRecordLine } from '../src/core/index.js';

describe('parseRecordLine', () => {
  it('parses a plain record line', () => {
    const r = parseRecordLine('- [2026-07-06 | conf:high | src:user] 一句繁體中文事實。#tag');
    expect(r).toBeDefined();
    expect(r?.date).toBe('2026-07-06');
    expect(r?.confidence).toBe('high');
    expect(r?.source).toBe('user');
    expect(r?.fact).toBe('一句繁體中文事實。');
    expect(r?.tags).toEqual(['tag']);
    expect(r?.routeWarning).toBeUndefined();
    expect(r?.id).toBeTruthy();
  });

  it('extracts multiple trailing tags', () => {
    const r = parseRecordLine('- [2026-07-06 | conf:med | src:session] 有兩個標籤。#decision #milestone');
    expect(r?.fact).toBe('有兩個標籤。');
    expect(r?.tags).toEqual(['decision', 'milestone']);
  });

  it('extracts a ⚠routeWarning marker separately from tags', () => {
    const r = parseRecordLine('- [2026-07-06 | conf:high | src:user] 出貨前必讀 ⚠before-release #constraint');
    expect(r?.fact).toBe('出貨前必讀');
    expect(r?.routeWarning).toBe('before-release');
    expect(r?.tags).toEqual(['constraint']);
  });

  it('tolerates a source containing spaces, §, and backslashes', () => {
    const r = parseRecordLine('- [2026-07-06 | conf:high | src:architecture §8 \\ appendix] 事實內容。');
    expect(r?.source).toBe('architecture §8 \\ appendix');
    expect(r?.fact).toBe('事實內容。');
  });

  it('returns undefined for a non-record line', () => {
    expect(parseRecordLine('## 標題')).toBeUndefined();
    expect(parseRecordLine('> 引言說明')).toBeUndefined();
    expect(parseRecordLine('普通文字，不是記錄行')).toBeUndefined();
  });

  it('rejects an invalid confidence level', () => {
    expect(parseRecordLine('- [2026-07-06 | conf:medium | src:user] 事實')).toBeUndefined();
  });

  it('parses the optional 4th skeleton field ver: into verifiedAt (contract C2)', () => {
    const r = parseRecordLine('- [2026-07-06 | conf:high | src:user | ver:2026-10-28] 已複驗的事實 #tag');
    expect(r?.source).toBe('user');
    expect(r?.verifiedAt).toBe('2026-10-28');
    expect(r?.fact).toBe('已複驗的事實');
    expect(r?.tags).toEqual(['tag']);
    expect(parseRecordLine('- [2026-07-06 | conf:high | src:user] 沒有 ver')?.verifiedAt).toBeUndefined();
  });

  it('strips the trailing #tags from the fact, but keeps a # earlier in the sentence', () => {
    const r = parseRecordLine('- [2026-07-06 | conf:med | src:session] 修好 PR #12 之後再發布 #release #decision');
    expect(r?.fact).toBe('修好 PR #12 之後再發布');
    expect(r?.tags).toEqual(['release', 'decision']);
    expect(r?.fact).not.toContain('#release');
  });

  it('does not mistake a bare trailing "C#" for a tag', () => {
    const r = parseRecordLine('- [2026-07-06 | conf:med | src:session] 後端改用 C#');
    expect(r?.fact).toBe('後端改用 C#');
    expect(r?.tags).toEqual([]);
  });

  it('round-trips renderRecordLine output, including ver: and ⚠', () => {
    const original = {
      id: 'x',
      date: '2026-07-06',
      confidence: 'med' as const,
      source: 'chronicle:a1,b2',
      fact: '出貨前先跑 smoke test',
      tags: ['release', 'ci'],
      routeWarning: 'before-release',
      verifiedAt: '2026-10-28',
    };
    const line = renderRecordLine(original);
    expect(line).toBe('- [2026-07-06 | conf:med | src:chronicle:a1,b2 | ver:2026-10-28] 出貨前先跑 smoke test ⚠before-release #release #ci');
    const parsed = parseRecordLine(line);
    expect({ ...parsed, id: 'x' }).toEqual(original);
  });

  it('factLengthWarning flags only facts over the cap', () => {
    const at = parseRecordLine(`- [2026-07-06 | conf:high | src:user] ${'字'.repeat(200)}`)!;
    const over = parseRecordLine(`- [2026-07-06 | conf:high | src:user] ${'字'.repeat(201)}`)!;
    expect(factLengthWarning(at, 200, 'keep.md', 3, 'line')).toBeUndefined();
    expect(factLengthWarning(over, 200, 'keep.md', 3, 'line')).toMatchObject({ file: 'keep.md', line: 3 });
  });

  it('generates a distinct id for each parsed record', () => {
    const a = parseRecordLine('- [2026-07-06 | conf:high | src:user] 事實一');
    const b = parseRecordLine('- [2026-07-06 | conf:high | src:user] 事實二');
    expect(a?.id).not.toBe(b?.id);
  });
});
