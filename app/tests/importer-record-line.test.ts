import { describe, it, expect } from 'vitest';
import { parseRecordLine } from '../src/importer/record-line.js';

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

  it('generates a distinct id for each parsed record', () => {
    const a = parseRecordLine('- [2026-07-06 | conf:high | src:user] 事實一');
    const b = parseRecordLine('- [2026-07-06 | conf:high | src:user] 事實二');
    expect(a?.id).not.toBe(b?.id);
  });
});
