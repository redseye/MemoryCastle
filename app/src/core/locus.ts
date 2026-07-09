// Mechanical locus matching (architecture §6: "which locus owns these paths"
// needs no semantic guessing). Only glob-shaped locus entries participate;
// non-path activity loci (e.g. "部署活動") simply never match a path lookup —
// that membership is a semantic (LLM) judgment made elsewhere.

import { toForwardSlash } from '../storage/paths.js';
import type { RoomFile } from './types.js';

function globToRegex(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesLocus(path: string, locusPattern: string): boolean {
  const normPath = toForwardSlash(path);
  const normPattern = toForwardSlash(locusPattern);
  if (normPattern.includes('*')) {
    return globToRegex(normPattern).test(normPath);
  }
  const stripped = normPattern.replace(/\/$/, '');
  return normPath === stripped || normPath.startsWith(`${stripped}/`);
}

export function roomsForPaths(rooms: RoomFile[], paths: string[]): RoomFile[] {
  const normPaths = paths.map(toForwardSlash);
  return rooms.filter((room) =>
    room.locus.some((locus) => normPaths.some((p) => matchesLocus(p, locus)))
  );
}
