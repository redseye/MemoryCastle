import { describe, it, expect } from 'vitest';
import { parseChronicleMd } from '../src/importer/chronicle.js';

describe('parseChronicleMd', () => {
  it('parses every record line and skips boilerplate', () => {
    const md = `# Chronicle — 測試專案

> 只增不改的情節日誌。
> 第二行說明。

- [2026-07-05 | conf:high | src:castle-init] 城堡初始化完成。#meta
- [2026-07-06 | conf:high | src:user] 第二條記錄。#decision
`;
    const result = parseChronicleMd(md);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].fact).toBe('城堡初始化完成。');
    expect(result.warnings).toHaveLength(0);
  });

  it('reports an unparseable non-empty line as a warning', () => {
    const md = `# Chronicle — Test

not a record and not boilerplate
- [2026-07-06 | conf:high | src:user] a real record.
`;
    const result = parseChronicleMd(md);
    expect(result.entries).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].line).toBe(3);
  });
});
