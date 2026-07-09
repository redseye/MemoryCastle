// Registration is a config-only operation (mirrors registerProject/
// unregisterProject in config/config.ts, which never touch the castle on
// disk). POST additionally checks whether the target root already has a
// castle scaffold: the project is registered either way (so the caller has
// an id to call init with), but the response is 409 with an init hint when
// there's no castle yet, per plan §5.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Hono } from 'hono';
import { readConfig, registerProject, unregisterProject, writeConfig } from '../../config/index.js';
import { castleDirOf, castleJsonPath, initCastle, openCastle } from '../../core/index.js';
import { HttpError } from '../http-errors.js';
import { findProjectSync, openProjectCastle } from '../project-context.js';
import { jsonBody } from '../request.js';

interface RegisterBody {
  root?: string;
  name?: string;
}

export function registerProjectRoutes(app: Hono): void {
  app.get('/projects', async (c) => {
    const config = await readConfig();
    return c.json({ projects: config.projects });
  });

  app.post('/projects', async (c) => {
    const body = await jsonBody<RegisterBody>(c);
    if (!body.root || typeof body.root !== 'string') {
      throw new HttpError(400, 'invalid_body', 'root 為必填字串');
    }
    const resolvedRoot = resolve(body.root);
    if (!existsSync(resolvedRoot)) {
      throw new HttpError(400, 'root_not_found', `目錄不存在：${resolvedRoot}`);
    }

    const config = await readConfig();
    const { config: nextConfig, project } = registerProject(config, resolvedRoot, body.name);
    await writeConfig(nextConfig);

    const hasCastle = existsSync(castleJsonPath(castleDirOf(resolvedRoot)));
    if (!hasCastle) {
      return c.json(
        {
          error: {
            code: 'no_castle',
            message: `已註冊為 ${project.id}，但此目錄尚無城堡。請呼叫 POST /projects/${project.id}/init 建立城堡。`,
          },
          project,
        },
        409
      );
    }
    return c.json({ project }, 201);
  });

  app.delete('/projects/:id', async (c) => {
    const config = await readConfig();
    const project = findProjectSync(config, c.req.param('id'));
    await writeConfig(unregisterProject(config, project.id));
    return c.json({ ok: true });
  });

  app.post('/projects/:id/init', async (c) => {
    const config = await readConfig();
    const project = findProjectSync(config, c.req.param('id'));
    await initCastle(project.root, project.name); // CastleExistsError -> 409 centrally
    const castle = await openCastle(project.root);
    return c.json(await castle.getMeta(), 201);
  });

  app.get('/projects/:id/castle', async (c) => {
    const config = await readConfig();
    const project = findProjectSync(config, c.req.param('id'));
    const castle = await openCastle(project.root); // NoCastleError -> 409 centrally
    const [meta, counts, patrolDueResult] = await Promise.all([
      castle.getMeta(),
      castle.countBudgets(),
      castle.patrolDue(),
    ]);
    return c.json({ budgets: meta.budgets, counts, patrolDue: patrolDueResult, lastPatrolAt: meta.lastPatrolAt });
  });

  // Read-only, deterministic: the route definitions themselves (name/
  // occasion/stops), not a walk execution (that's POST /walks). Fills the
  // gap noted in web/src/types.ts — the UI used to hardcode the 3 default
  // route names/occasions because there was no way to read routes.json back.
  app.get('/projects/:id/routes', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    return c.json({ routes: await castle.routes.list() });
  });
}
