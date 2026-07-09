import { describe, it, expect } from 'vitest';
import { parseRoomMd } from '../src/importer/rooms.js';

describe('parseRoomMd', () => {
  it('parses name/locus/adjacent/emblem and record lines', () => {
    const md = `# Room: 後端服務

locus: src/server／scripts、部署活動
adjacent: frontend, infra
emblem: 齒輪

> 地點錨定的記憶說明。

- [2026-07-06 | conf:med | src:session] 後端第一條事實。#backend
`;
    const room = parseRoomMd(md, 'backend', 'rooms/backend.md');
    expect(room.name).toBe('後端服務');
    expect(room.locus).toEqual(['src/server', 'scripts', '部署活動']);
    expect(room.adjacent).toEqual(['frontend', 'infra']);
    expect(room.emblem).toBe('齒輪');
    expect(room.records).toHaveLength(1);
    expect(room.warnings).toHaveLength(0);
  });

  it('maps adjacent "none" to an empty array', () => {
    const md = `# Room: 獨立房間

locus: scripts
adjacent: none
`;
    const room = parseRoomMd(md, 'solo', 'rooms/solo.md');
    expect(room.adjacent).toEqual([]);
  });

  it('defaults emblem to null when the line is absent', () => {
    const md = `# Room: 無象徵房間

locus: scripts
adjacent: none
`;
    const room = parseRoomMd(md, 'no-emblem', 'rooms/no-emblem.md');
    expect(room.emblem).toBeNull();
  });

  it('warns on an unparseable non-boilerplate line', () => {
    const md = `# Room: 測試房間

locus: scripts
adjacent: none

not boilerplate and not a record
- [2026-07-06 | conf:med | src:session] 真正的記錄。
`;
    const room = parseRoomMd(md, 'test-room', 'rooms/test-room.md');
    expect(room.records).toHaveLength(1);
    expect(room.warnings).toHaveLength(1);
    expect(room.warnings[0].file).toBe('rooms/test-room.md');
  });
});
