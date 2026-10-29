import { describe, it, expect } from 'vitest';
import { parseKeepMd } from '../src/importer/keep.js';

describe('parseKeepMd', () => {
  it('maps Traditional Chinese headings to sections and reads the last-patrol header', () => {
    const md = `# Keep — 測試專案

> 上次巡查：2026-07-06。
> 格式說明。

## 身分（這個專案是什麼）

- [2026-07-06 | conf:high | src:user] 身分事實一。#identity

## 約束（每個 session 都必須遵守的事）

- [2026-07-06 | conf:high | src:user] 約束事實一。#constraint
- [2026-07-06 | conf:high | src:user] 約束事實二。#constraint

## 核心事實

- [2026-07-06 | conf:high | src:session] 核心事實一。#meta
`;
    const result = parseKeepMd(md);
    expect(result.lastPatrolAt).toBe('2026-07-06');
    expect(result.sections.identity).toHaveLength(1);
    expect(result.sections.constraints).toHaveLength(2);
    expect(result.sections.core).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('warns about (but still imports) a keep record over the fact cap, and parses ver:', () => {
    const md = `## 核心事實\n\n- [2026-07-06 | conf:high | src:user | ver:2026-10-01] ${'核'.repeat(201)} #meta\n`;
    const result = parseKeepMd(md);
    expect(result.sections.core).toHaveLength(1);
    expect(result.sections.core[0].verifiedAt).toBe('2026-10-01');
    expect(result.sections.core[0].tags).toEqual(['meta']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ file: 'keep.md', line: 3 });
  });

  it('tolerates legacy English headings and the half-width colon variant', () => {
    const md = `# Keep — Test

> Last patrol: 2026-01-02.

## Identity

- [2026-01-01 | conf:high | src:user] identity fact.

## Constraints

- [2026-01-01 | conf:high | src:user] constraint fact.

## Core facts

- [2026-01-01 | conf:high | src:user] core fact.
`;
    const result = parseKeepMd(md);
    expect(result.lastPatrolAt).toBe('2026-01-02');
    expect(result.sections.identity).toHaveLength(1);
    expect(result.sections.constraints).toHaveLength(1);
    expect(result.sections.core).toHaveLength(1);
  });

  it('warns on an unparseable non-boilerplate line but not on blockquotes/comments', () => {
    const md = `# Keep — Test

> boilerplate line, ignored

## 核心事實

<!-- a comment, ignored -->
this line is neither boilerplate nor a record
- [2026-01-01 | conf:high | src:user] a real record.
`;
    const result = parseKeepMd(md);
    expect(result.sections.core).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].reason).toBe('unparseable line');
    expect(result.warnings[0].text).toContain('this line is neither');
  });

  it('returns lastPatrolAt null when no header line is present', () => {
    const result = parseKeepMd('# Keep — Test\n\n## 核心事實\n');
    expect(result.lastPatrolAt).toBeNull();
  });
});
