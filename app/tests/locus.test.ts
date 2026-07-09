import { describe, it, expect } from 'vitest';
import { matchesLocus, roomsForPaths } from '../src/core/index.js';
import type { RoomFile } from '../src/core/types.js';

function room(overrides: Partial<RoomFile>): RoomFile {
  return {
    schema: 1,
    slug: 'r',
    name: 'Room',
    locus: [],
    adjacent: [],
    emblem: null,
    createdAt: '2026-07-06',
    records: [],
    ...overrides,
  };
}

describe('matchesLocus', () => {
  it('matches a glob locus pattern', () => {
    expect(matchesLocus('scripts/foo.mjs', 'scripts/**')).toBe(true);
    expect(matchesLocus('other/foo.mjs', 'scripts/**')).toBe(false);
  });

  it('matches a plain (non-glob) locus as a directory prefix', () => {
    expect(matchesLocus('src/core/castle.ts', 'src/core')).toBe(true);
    expect(matchesLocus('src/core', 'src/core')).toBe(true);
    expect(matchesLocus('src/corex/other.ts', 'src/core')).toBe(false);
  });

  it('normalizes Windows backslash input before matching', () => {
    expect(matchesLocus('scripts\\foo\\bar.mjs', 'scripts/**')).toBe(true);
    expect(matchesLocus('src\\core\\castle.ts', 'src/core')).toBe(true);
  });

  it('normalizes a backslash locus pattern too', () => {
    expect(matchesLocus('scripts/foo.mjs', 'scripts\\**')).toBe(true);
  });
});

describe('roomsForPaths', () => {
  const scriptsRoom = room({ slug: 'scripts', locus: ['scripts/**'] });
  const coreRoom = room({ slug: 'core', locus: ['src/core'] });
  const rooms = [scriptsRoom, coreRoom];

  it('returns rooms whose locus owns any of the given paths', () => {
    expect(roomsForPaths(rooms, ['scripts/build.mjs'])).toEqual([scriptsRoom]);
  });

  it('normalizes Windows backslash input paths before matching', () => {
    expect(roomsForPaths(rooms, ['scripts\\build.mjs'])).toEqual([scriptsRoom]);
    expect(roomsForPaths(rooms, ['src\\core\\castle.ts'])).toEqual([coreRoom]);
  });

  it('returns no rooms when nothing matches', () => {
    expect(roomsForPaths(rooms, ['unrelated/file.txt'])).toEqual([]);
  });

  it('does not mechanically match a non-path activity locus (needs semantic judgment)', () => {
    const activityRoom = room({ slug: 'deploy', locus: ['部署活動'] });
    expect(roomsForPaths([activityRoom], ['scripts/deploy.mjs'])).toEqual([]);
  });
});
