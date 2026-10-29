// Parses routes.md (plan §8): `## route: <name> — <occasion>` sections
// (tolerating em-dash or plain-hyphen separators — the route name itself is
// matched as a single non-space token so internal hyphens like
// "session-start" are never mistaken for the separator), followed by
// numbered stop lines mapped onto the target/read vocabulary. A stop that
// carries an explicit backticked `target/read` token (the v0.5 templates do,
// e.g. `patrol-check/due`, `room:web/route-warnings`) is taken verbatim;
// older files fall back to the Chinese keyword mapping below. Stop text that
// can't be mapped keeps its original text in `note` and is also reported as
// a warning, as is an explicit token outside the walk whitelist.

import type { RouteDef, RouteStop } from '../core/types.js';
import { invalidStopReason } from '../core/walk.js';
import type { ImportWarning } from './types.js';
import { isBlank, isCommentLine, splitLines } from './line-helpers.js';

const ROUTE_HEADING_RE = /^##\s*route:\s*(\S+)\s*[—-]\s*(.+)$/;
const STOP_RE = /^(\d+)\.\s*(.+)$/;
const STOP_TOKEN_RE = /`([a-z][a-z-]*(?::[^\s`/]+)?)\/([a-z][a-z-]*(?::[a-z-]+)?)`/;

export interface KnownRoom {
  slug: string;
  name: string;
}

function detectTarget(text: string, knownRooms: KnownRoom[]): { target: string; note?: string } {
  if (text.includes('keep.md')) return { target: 'keep' };
  if (text.includes('chronicle.md')) return { target: 'chronicle' };
  if (text.includes('routes.md')) return { target: 'routes' };
  if (text.includes('所有房間')) return { target: 'all-rooms' };
  if (text.includes('所屬的房間') || text.includes('工作檔案所屬')) return { target: 'rooms-by-locus' };
  const room = knownRooms.find((r) => text.includes(r.name));
  if (room) return { target: `room:${room.slug}` };
  return { target: 'unknown', note: text };
}

// Only "只讀 ⚠X 行"-shaped text means route-warnings; a bare "⚠" mention (e.g.
// patrol's routes.md stop describing what to check for) must not trigger it.
function detectRead(text: string): string {
  if (text.includes('只讀') && text.includes('⚠')) return 'route-warnings';
  if (text.includes('約束區')) return 'section:constraints';
  return 'all';
}

export interface ParseRoutesResult {
  routes: RouteDef[];
  warnings: ImportWarning[];
}

export function parseRoutesMd(content: string, file = 'routes.md', knownRooms: KnownRoom[] = []): ParseRoutesResult {
  const routes: RouteDef[] = [];
  const warnings: ImportWarning[] = [];
  let current: RouteDef | undefined;

  splitLines(content).forEach((line, i) => {
    const lineNo = i + 1;
    const trimmed = line.trim();
    if (isBlank(line) || isCommentLine(line)) return;

    const headingMatch = ROUTE_HEADING_RE.exec(trimmed);
    if (headingMatch) {
      current = { name: headingMatch[1], occasion: headingMatch[2].trim(), stops: [] };
      routes.push(current);
      return;
    }

    if (trimmed.startsWith('#') || trimmed.startsWith('>')) return; // title / blockquote intro

    const stopMatch = STOP_RE.exec(trimmed);
    if (stopMatch) {
      if (!current) {
        warnings.push({ file, line: lineNo, text: line, reason: 'stop line found before any route heading' });
        return;
      }
      const stopText = stopMatch[2];
      const token = STOP_TOKEN_RE.exec(stopText);
      if (token) {
        const stop: RouteStop = { target: token[1], read: token[2] };
        if (invalidStopReason(stop)) {
          warnings.push({ file, line: lineNo, text: line, reason: 'route stop token outside the walk whitelist' });
        }
        current.stops.push(stop);
        return;
      }
      const { target, note } = detectTarget(stopText, knownRooms);
      const stop: RouteStop = { target, read: detectRead(stopText) };
      if (note !== undefined) {
        stop.note = note;
        warnings.push({ file, line: lineNo, text: line, reason: 'unmappable route stop' });
      }
      current.stops.push(stop);
      return;
    }

    warnings.push({ file, line: lineNo, text: line, reason: 'unparseable line' });
  });

  return { routes, warnings };
}
