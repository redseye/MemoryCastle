import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRoutesMd } from '../src/importer/routes.js';

const here = fileURLToPath(new URL('.', import.meta.url));

describe('parseRoutesMd', () => {
  it('parses an old-style (pre-v0.5, keyword-only) routes.md with 3 routes and 0 warnings', () => {
    const md = `# Routes — MemoryCastle

> 固定順序的巡行路線說明。
> 權限說明。

## route: session-start — 每個 session 開工時走

1. keep.md — 全文讀（不超過 30 行）
2. 本次 session 要動的檔案／活動所屬的房間（還沒有房間）

## route: before-release — 使用者說 release／deploy／publish／上線／對外發布 時走

1. keep.md — 約束區（本專案的出貨擋門磚）
<!-- 每當有房間出現 ⚠before-release 行，就把它加成一站 -->

## route: patrol — 巡查觸發時走

1. chronicle.md — 把未整理的記錄按 locus 聚類
2. 所有房間，固定順序：（還沒有）
3. keep.md — 預算檢查
4. routes.md — 第 2 站列了所有房間嗎？每個 ⚠ 標記指的路線都存在嗎？補漏
`;
    const result = parseRoutesMd(md);
    expect(result.routes.map((r) => r.name)).toEqual(['session-start', 'before-release', 'patrol']);
    expect(result.warnings).toHaveLength(0);

    const sessionStart = result.routes[0];
    expect(sessionStart.stops[0]).toEqual({ target: 'keep', read: 'all' });
    expect(sessionStart.stops[1]).toEqual({ target: 'rooms-by-locus', read: 'all' });

    const beforeRelease = result.routes[1];
    expect(beforeRelease.stops[0]).toEqual({ target: 'keep', read: 'section:constraints' });

    const patrol = result.routes[2];
    expect(patrol.stops[0]).toEqual({ target: 'chronicle', read: 'all' });
    expect(patrol.stops[1]).toEqual({ target: 'all-rooms', read: 'all' });
    expect(patrol.stops[2]).toEqual({ target: 'keep', read: 'all' });
    // Stop 4 mentions routes.md AND a bare ⚠ (without 只讀) — must resolve to
    // target routes / read all, not route-warnings.
    expect(patrol.stops[3]).toEqual({ target: 'routes', read: 'all' });
  });

  it('honours the explicit `target/read` tokens of the v0.5 templates/routes.md, 0 warnings', async () => {
    const template = await readFile(join(here, '..', '..', 'templates', 'routes.md'), 'utf8');
    const md = template
      .replace(/\{\{PROJECT_NAME\}\}/g, 'Demo')
      .replace(/\{\{房間名\}\}/g, '後端服務')
      .replace(/\{\{房間檔名\}\}/g, 'backend')
      .replace(/\{\{房間清單[^}]*\}\}/g, '（還沒有）');
    const result = parseRoutesMd(md, 'routes.md', [{ slug: 'backend', name: '後端服務' }]);
    expect(result.warnings).toEqual([]);
    expect(result.routes.map((r) => [r.name, r.stops.map((s) => `${s.target}/${s.read}`)])).toEqual([
      ['session-start', ['patrol-check/due', 'keep/all', 'chronicle/last-handover', 'rooms-by-locus/all']],
      ['before-release', ['keep/section:constraints', 'room:backend/route-warnings']],
      ['patrol', ['chronicle/all', 'all-rooms/all', 'keep/all', 'routes/all']],
    ]);
    expect(result.routes.flatMap((r) => r.stops).some((s) => 'note' in s)).toBe(false);
  });

  it('an explicit token wins over the keyword mapping on the same line', () => {
    // Keyword mapping alone would read this as keep/all (mentions keep.md).
    const md = '## route: custom — x\n\n1. 先讀 keep.md 的話題 `chronicle/last-handover` — 只讀最新交接\n';
    expect(parseRoutesMd(md).routes[0].stops).toEqual([{ target: 'chronicle', read: 'last-handover' }]);
  });

  it('imports an explicit token outside the walk whitelist as written, with a warning', () => {
    const md = '## route: custom — x\n\n1. keep.md `keep/everything` — 錯字\n';
    const result = parseRoutesMd(md);
    expect(result.routes[0].stops).toEqual([{ target: 'keep', read: 'everything' }]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].reason).toBe('route stop token outside the walk whitelist');
  });

  it('tolerates a plain-hyphen route heading separator', () => {
    const md = `## route: patrol - patrol time\n\n1. keep.md - full read\n`;
    const result = parseRoutesMd(md);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].name).toBe('patrol');
    expect(result.routes[0].occasion).toBe('patrol time');
  });

  it('maps a stop naming a known room to room:<slug>', () => {
    const md = `## route: before-release — release time\n\n1. 後端服務 — 只讀 ⚠before-release 行\n`;
    const result = parseRoutesMd(md, 'routes.md', [{ slug: 'backend', name: '後端服務' }]);
    expect(result.routes[0].stops[0]).toEqual({ target: 'room:backend', read: 'route-warnings' });
  });

  it('keeps unmappable stop text in a note field and reports a warning', () => {
    const md = `## route: mystery — some occasion\n\n1. 完全無法辨識的站點文字\n`;
    const result = parseRoutesMd(md);
    expect(result.routes[0].stops[0].target).toBe('unknown');
    expect(result.routes[0].stops[0].note).toBe('完全無法辨識的站點文字');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].reason).toBe('unmappable route stop');
  });
});
