// Read-only, deterministic health check over a project's castle: wraps
// core/doctor.ts's runDoctor() the same way projects.ts's GET /castle wraps
// countBudgets/patrolDue. No LLM involved, so this endpoint never needs a key.

import type { Hono } from 'hono';
import { runDoctor } from '../../core/index.js';
import { findProject } from '../project-context.js';

export function registerDoctorRoutes(app: Hono): void {
  app.get('/projects/:id/doctor', async (c) => {
    const project = await findProject(c.req.param('id')); // project_not_found -> 404 centrally
    const report = await runDoctor(project.root); // NoCastleError -> 409 centrally
    return c.json(report);
  });
}
