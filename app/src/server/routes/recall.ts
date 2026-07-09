// standing recall (paths -> rooms) is deterministic locus matching by
// default; fuzzy=true additionally asks the LLM to pick among ambiguous or
// unmatched rooms (plan §4 fuzzyRoomSelect), merged with the deterministic
// matches by slug.

import type { Hono } from 'hono';
import type { RoomFile } from '../../core/index.js';
import { fuzzyRecallFlow } from '../../flows/fuzzyRecallFlow.js';
import { openProjectCastle } from '../project-context.js';
import { ensureLlmConfigured, type LlmService } from '../llm-seam.js';

function parseCommaList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function registerRecallRoutes(app: Hono, deps: { llmService: LlmService }): void {
  app.get('/projects/:id/recall/standing', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    const paths = parseCommaList(c.req.query('paths'));
    let rooms = await castle.roomsForPaths(paths);

    if (c.req.query('fuzzy') === 'true') {
      await ensureLlmConfigured(deps.llmService);
      const fuzzyRooms = await fuzzyRecallFlow(castle, deps.llmService, paths);
      const bySlug = new Map<string, RoomFile>(rooms.map((r) => [r.slug, r]));
      for (const room of fuzzyRooms) bySlug.set(room.slug, room);
      rooms = [...bySlug.values()];
    }

    return c.json({ rooms });
  });

  app.get('/projects/:id/recall/search', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    const q = c.req.query('q') ?? '';
    const tags = parseCommaList(c.req.query('tag'));
    const results = await castle.search(q, { tags: tags.length > 0 ? tags : undefined });
    return c.json({ results });
  });
}
