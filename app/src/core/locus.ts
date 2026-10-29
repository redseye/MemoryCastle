// Mechanical locus matching (architecture §6: "which locus owns these paths"
// needs no semantic guessing; contract C7). Only path-like locus entries
// (containing "/", "*", or a file extension) participate; activity loci
// (e.g. "部署活動") never match a path lookup — that membership is a
// semantic (LLM) judgment made elsewhere.
//
// Paths are normalized before matching: backslash -> slash, absolute paths
// made relative to the project root (a path outside the root never
// matches), leading "./" stripped; comparison is case-insensitive.

import { posix, resolve } from 'node:path';
import { toForwardSlash } from '../storage/paths.js';
import type { RoomFile } from './types.js';

const FILE_EXTENSION_RE = /^[\w.-]+\.[a-z][a-z0-9]{0,5}$/i;

export function isPathLikeLocus(entry: string): boolean {
  const norm = toForwardSlash(entry.trim());
  return norm.includes('/') || norm.includes('*') || FILE_EXTENSION_RE.test(norm);
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[a-z]:\//i.test(p);
}

// Returns the root-relative, forward-slash form of `path`, or undefined when
// it can't belong to the project (absolute outside `root`, or escaping it via
// ".."). An absolute path with no root given is kept as-is.
export function normalizeLocusPath(path: string, root?: string): string | undefined {
  let p = toForwardSlash(path.trim());
  if (p === '') return '';
  p = posix.normalize(p);
  if (isAbsolutePath(p)) {
    if (root === undefined) return p.replace(/\/+$/, '');
    const fwdRoot = toForwardSlash(root);
    const r = posix.normalize(isAbsolutePath(fwdRoot) ? fwdRoot : toForwardSlash(resolve(root))).replace(/\/+$/, '');
    const pLower = p.toLowerCase().replace(/\/+$/, '');
    const rLower = r.toLowerCase();
    if (pLower === rLower) return '';
    if (!pLower.startsWith(`${rLower}/`)) return undefined;
    p = p.slice(r.length + 1);
  }
  if (p === '.' || p === './') return '';
  if (p === '..' || p.startsWith('../')) return undefined;
  return p.replace(/\/+$/, '');
}

function escapeRegexChar(c: string): string {
  return '.+^${}()|[]\\'.includes(c) ? `\\${c}` : c;
}

// "**/" spans zero or more whole directories (so "**/x" matches "x" and
// "a/b/x" but never "barx"); a trailing "/**" also matches the directory
// itself; "*" and "?" never cross a "/".
function globToRegex(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '/' && pattern.slice(i) === '/**') {
      re += '(?:/.*)?';
      break;
    }
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        const atSegmentStart = i === 0 || pattern[i - 1] === '/';
        i++;
        if (atSegmentStart && pattern[i + 1] === '/') {
          re += '(?:.*/)?';
          i++;
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += escapeRegexChar(c);
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

function matchesNormalized(normPath: string, locusPattern: string): boolean {
  if (!isPathLikeLocus(locusPattern)) return false;
  let pattern = toForwardSlash(locusPattern.trim());
  while (pattern.startsWith('./')) pattern = pattern.slice(2);
  if (pattern.includes('*') || pattern.includes('?')) {
    return globToRegex(pattern).test(normPath);
  }
  const stripped = pattern.replace(/\/+$/, '').toLowerCase();
  const lowerPath = normPath.toLowerCase();
  return lowerPath === stripped || lowerPath.startsWith(`${stripped}/`);
}

export function matchesLocus(path: string, locusPattern: string, root?: string): boolean {
  const normPath = normalizeLocusPath(path, root);
  if (normPath === undefined) return false;
  return matchesNormalized(normPath, locusPattern);
}

export interface LocusMatch {
  rooms: RoomFile[];
  unmatchedPaths: string[]; // root-relative where possible, else as given
}

export function matchPathsToRooms(rooms: RoomFile[], paths: string[], root?: string): LocusMatch {
  const matched = new Set<RoomFile>();
  const unmatchedPaths: string[] = [];
  for (const path of paths) {
    const normPath = normalizeLocusPath(path, root);
    const owners =
      normPath === undefined ? [] : rooms.filter((room) => room.locus.some((locus) => matchesNormalized(normPath, locus)));
    if (owners.length === 0) unmatchedPaths.push(normPath || path);
    for (const room of owners) matched.add(room);
  }
  return { rooms: rooms.filter((r) => matched.has(r)), unmatchedPaths };
}

export function roomsForPaths(rooms: RoomFile[], paths: string[], root?: string): RoomFile[] {
  return matchPathsToRooms(rooms, paths, root).rooms;
}
