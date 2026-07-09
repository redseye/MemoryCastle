import type { Hono } from 'hono';
import { importApply, importPreview } from '../../importer/index.js';
import { findProject } from '../project-context.js';

export function registerImportRoutes(app: Hono): void {
  app.post('/projects/:id/import', async (c) => {
    const project = await findProject(c.req.param('id'));
    return c.json(await importPreview(project.root));
  });

  app.post('/projects/:id/import/apply', async (c) => {
    const project = await findProject(c.req.param('id'));
    const result = await importApply(project.root); // CastleExistsError -> 409 centrally
    return c.json(result, 201);
  });
}
