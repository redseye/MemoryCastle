import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  estimateTokens,
  initCastle,
  makeChronicleCollection,
  makeKeepCollection,
  makeRoomsCollection,
  measureCastle,
  renderRecordLine,
} from '../src/core/index.js';
import { runCli } from '../src/cli.js';
import { makeTempDir, cleanupTempDir } from './helpers.js';

describe('estimateTokens', () => {
  it('counts each CJK character as 1 and every other character as 1/4', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('中文')).toBe(2);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('中文abcdefgh')).toBe(4);
    expect(estimateTokens('「全形」，')).toBe(5);
  });
});

describe('measureCastle', () => {
  let dir: string;
  let castleDir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    castleDir = await initCastle(dir);
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('session start = patrol-check + keep + last handover + one room (mean/max); flat = every live record', async () => {
    const keep = makeKeepCollection(castleDir);
    const k = await keep.append('core', { date: '2026-10-01', confidence: 'high', source: 'user', fact: '核心事實甲' });
    const chronicle = makeChronicleCollection(castleDir);
    const old = await chronicle.append({ date: '2026-10-01', confidence: 'high', source: 'session', fact: '舊交接', tags: ['handover'] });
    const handover = await chronicle.append({ date: '2026-10-20', confidence: 'high', source: 'session', fact: '新交接', tags: ['handover'] });
    const rooms = makeRoomsCollection(castleDir);
    const small = await rooms.append({ name: 'Small', locus: ['a/**'] });
    const r1 = await rooms.appendRecord(small.slug, { date: '2026-10-01', confidence: 'med', source: 'session', fact: '小' });
    const big = await rooms.append({ name: 'Big', locus: ['b/**'] });
    const r2 = await rooms.appendRecord(big.slug, { date: '2026-10-01', confidence: 'med', source: 'session', fact: '大房間的事實' });
    const r3 = await rooms.appendRecord(big.slug, { date: '2026-10-01', confidence: 'med', source: 'session', fact: '第二條' });

    const t = (records: Parameters<typeof renderRecordLine>[0][]) => estimateTokens(records.map(renderRecordLine).join('\n'));
    const m = await measureCastle(dir);

    expect(m.sessionStart.patrolCheck).toBe(0);
    expect(m.sessionStart.keep).toBe(t([k]));
    expect(m.sessionStart.lastHandover).toBe(t([handover]));
    expect(m.sessionStart.roomMax).toBe(t([r2, r3]));
    expect(m.sessionStart.roomMean).toBe(Math.round((t([r1]) + t([r2, r3])) / 2));
    expect(m.sessionStart.totalMax).toBe(t([k]) + t([handover]) + t([r2, r3]));
    expect(m.maxRoomSlug).toBe(big.slug);
    expect(m.flat.records).toBe(6);
    expect(m.flat.tokens).toBe(t([k, r1, r2, r3, old, handover]));
    expect(m.patrol).toBeGreaterThan(m.flat.tokens);
    expect(m.ratioMax).toBeCloseTo(m.sessionStart.totalMax / m.flat.tokens);
    expect(m.ratioMax!).toBeLessThan(1);
    expect(m.sessionStartStored.keep).toBeGreaterThan(m.sessionStart.keep); // JSON keys/ids cost extra
  });

  it('reports a null ratio on an empty castle instead of dividing by zero', async () => {
    const m = await measureCastle(dir);
    expect(m.flat.tokens).toBe(0);
    expect(m.ratioMean).toBeNull();
    expect(m.maxRoomSlug).toBeNull();
  });

  it('CLI measure prints the labelled estimate bilingually and exits 0; exits 1 without a castle', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await runCli(['measure', dir])).toBe(0);
      const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(out).toContain('estimate only');
      expect(out).toContain('估算');
      expect(out).toContain('(a) session-start');
      expect(out).toContain('(b) flat-file equivalent');
      expect(out).toContain('(c) patrol payload');
      expect(out).toContain('Ratio a/b: n/a');
      const bare = await makeTempDir();
      try {
        expect(await runCli(['measure', bare])).toBe(1);
      } finally {
        await cleanupTempDir(bare);
      }
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
