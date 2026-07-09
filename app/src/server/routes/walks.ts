import type { Hono } from 'hono';
import { NotFoundError } from '../../core/index.js';
import { HttpError } from '../http-errors.js';
import { openProjectCastle } from '../project-context.js';
import { jsonBody } from '../request.js';

interface WalkBody {
  route?: string;
  paths?: string[];
}

export function registerWalkRoutes(app: Hono): void {
  app.post('/projects/:id/walks', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    const body = await jsonBody<WalkBody>(c);
    if (!body.route || typeof body.route !== 'string') {
      throw new HttpError(400, 'invalid_body', 'route 為必填字串');
    }

    let plan;
    try {
      plan = await castle.planWalk(body.route, { paths: body.paths });
    } catch (err) {
      if (err instanceof NotFoundError) {
        throw new HttpError(404, 'route_not_found', `找不到路線：${body.route}`);
      }
      throw err;
    }

    const report = castle.walkReport(plan);
    return c.json({ stops: plan.stops.map((s) => ({ target: s.target, lines: s.lines })), report });
  });
}
