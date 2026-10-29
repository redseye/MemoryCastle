// standing recall (paths -> rooms) is deterministic locus matching by
// default; fuzzy=true asks the LLM to pick rooms (plan §4 fuzzyRoomSelect)
// only when deterministic matching found nothing — a mechanical hit is never
// second-guessed at LLM cost. Search needs a q or a tag (never "return
// everything") and is capped: limit defaults to 20, at most 100.

import type { Hono } from 'hono';
import { SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT } from '../../core/index.js';
import { fuzzyRecallFlow } from '../../flows/fuzzyRecallFlow.js';
import { HttpError } from '../http-errors.js';
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

    if (c.req.query('fuzzy') === 'true' && rooms.length === 0) {
      await ensureLlmConfigured(deps.llmService);
      rooms = await fuzzyRecallFlow(castle, deps.llmService, paths);
    }

    return c.json({ rooms });
  });

  app.get('/projects/:id/recall/search', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    const q = (c.req.query('q') ?? '').trim();
    const tags = parseCommaList(c.req.query('tag'));
    if (!q && tags.length === 0) {
      throw new HttpError(400, 'invalid_query', '搜尋需要 q 或 tag（不提供「列出全部」）');
    }
    const rawLimit = c.req.query('limit');
    const limit = rawLimit === undefined ? SEARCH_DEFAULT_LIMIT : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new HttpError(400, 'invalid_query', `limit 必須是 1 以上的整數（上限 ${SEARCH_MAX_LIMIT}）`);
    }
    const results = await castle.search(q, { tags: tags.length > 0 ? tags : undefined, limit: Math.min(limit, SEARCH_MAX_LIMIT) });
    return c.json({ results });
  });
}
