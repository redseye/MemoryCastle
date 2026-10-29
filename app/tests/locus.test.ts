import { describe, it, expect } from 'vitest';
import { isPathLikeLocus, matchesLocus, matchPathsToRooms, roomsForPaths } from '../src/core/index.js';
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

describe('matchesLocus v0.5 normalization (contract C7)', () => {
  const root = 'D:/Project/MemoryCastle';

  it('makes an absolute path relative to the project root before matching', () => {
    expect(matchesLocus('D:/Project/MemoryCastle/app/src/core/locus.ts', 'app/**', root)).toBe(true);
    expect(matchesLocus('D:\\Project\\MemoryCastle\\app\\src\\core\\locus.ts', 'app/**', root)).toBe(true);
  });

  it('compares the root prefix and the path case-insensitively', () => {
    expect(matchesLocus('d:/project/memorycastle/APP/src/x.ts', 'app/**', root)).toBe(true);
    expect(matchesLocus('App/Src/X.ts', 'app/src/**', root)).toBe(true);
    expect(matchesLocus('DOCS/Architecture.MD', 'docs/architecture.md')).toBe(true);
  });

  it('never matches an absolute path outside the project root', () => {
    expect(matchesLocus('D:/Project/Other/app/x.ts', 'app/**', root)).toBe(false);
    expect(matchesLocus('D:/Project/MemoryCastleX/app/x.ts', 'app/**', root)).toBe(false);
    expect(matchesLocus('D:/Project/MemoryCastle/../Other/app/x.ts', 'app/**', root)).toBe(false);
    expect(matchesLocus('../app/x.ts', 'app/**', root)).toBe(false);
  });

  it('strips a leading ./ from the path and the pattern', () => {
    expect(matchesLocus('./app/x.ts', 'app/**')).toBe(true);
    expect(matchesLocus('app/x.ts', './app/**')).toBe(true);
    expect(matchesLocus('.\\scripts\\build.mjs', 'scripts/**')).toBe(true);
  });

  it('**/x matches x at any depth but never as a name suffix', () => {
    expect(matchesLocus('x', '**/x')).toBe(true);
    expect(matchesLocus('a/b/x', '**/x')).toBe(true);
    expect(matchesLocus('barx', '**/x')).toBe(false);
    expect(matchesLocus('a/barx', '**/x')).toBe(false);
    expect(matchesLocus('a/b', 'a/**/b')).toBe(true);
    expect(matchesLocus('a/x/y/b', 'a/**/b')).toBe(true);
    expect(matchesLocus('a/xb', 'a/**/b')).toBe(false);
  });

  it('a trailing /** owns the directory itself and everything under it, but not a sibling prefix', () => {
    expect(matchesLocus('app', 'app/**')).toBe(true);
    expect(matchesLocus('app/a/b.ts', 'app/**')).toBe(true);
    expect(matchesLocus('apple/x.ts', 'app/**')).toBe(false);
  });

  it('* and ? stay within one path segment', () => {
    expect(matchesLocus('src/a.ts', 'src/*.ts')).toBe(true);
    expect(matchesLocus('src/sub/a.ts', 'src/*.ts')).toBe(false);
    expect(matchesLocus('src/a1.ts', 'src/a?.ts')).toBe(true);
    expect(matchesLocus('src/a12.ts', 'src/a?.ts')).toBe(false);
    expect(matchesLocus('src/a/.ts', 'src/a?.ts')).toBe(false);
  });

  it('only path-like loci (with /, *, or a file extension) ever match a path', () => {
    expect(isPathLikeLocus('app/**')).toBe(true);
    expect(isPathLikeLocus('*.md')).toBe(true);
    expect(isPathLikeLocus('README.md')).toBe(true);
    expect(isPathLikeLocus('部署活動')).toBe(false);
    expect(isPathLikeLocus('scripts')).toBe(false);
    expect(isPathLikeLocus('v0.1 里程碑一')).toBe(false);
    expect(isPathLikeLocus('rooms／routes／keep 模板設計')).toBe(false);
    expect(matchesLocus('scripts/build.mjs', 'scripts')).toBe(false);
    expect(matchesLocus('README.md', 'README.md')).toBe(true);
  });
});

describe('matchPathsToRooms', () => {
  const appRoom = room({ slug: 'app', locus: ['app/**'] });
  const coreRoom = room({ slug: 'core', locus: ['app/src/core/**'] });
  const docsRoom = room({ slug: 'docs', locus: ['docs/**', 'README.md'] });

  it('returns every room whose locus owns a path when loci overlap, in room order', () => {
    const result = matchPathsToRooms([appRoom, coreRoom, docsRoom], ['app/src/core/locus.ts']);
    expect(result.rooms.map((r) => r.slug)).toEqual(['app', 'core']);
    expect(result.unmatchedPaths).toEqual([]);
  });

  it('reports each path no room owns, normalized relative to the root', () => {
    const result = matchPathsToRooms([appRoom, docsRoom], ['D:/P/app/a.ts', 'D:/P/scripts/x.mjs', './README.md'], 'D:/P');
    expect(result.rooms.map((r) => r.slug)).toEqual(['app', 'docs']);
    expect(result.unmatchedPaths).toEqual(['scripts/x.mjs']);
  });

  it('reports an outside-root path as given', () => {
    const result = matchPathsToRooms([appRoom], ['E:/elsewhere/app/a.ts'], 'D:/P');
    expect(result.rooms).toEqual([]);
    expect(result.unmatchedPaths).toEqual(['E:/elsewhere/app/a.ts']);
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
