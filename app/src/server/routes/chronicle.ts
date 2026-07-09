// chronicle is green-level: direct append, no confirm flag, for agents that
// have already run their own gate check before calling this endpoint.

import type { Hono } from 'hono';
import { openProjectCastle } from '../project-context.js';
import { parseRecordInput } from '../records-validate.js';
import { jsonBody } from '../request.js';

export function registerChronicleRoutes(app: Hono): void {
  app.get('/projects/:id/chronicle', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    return c.json({ entries: await castle.chronicle.list() });
  });

  app.post('/projects/:id/chronicle/records', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    const body = await jsonBody<Record<string, unknown>>(c);
    const record = await castle.chronicle.append(parseRecordInput(body));
    return c.json(record, 201);
  });
}
