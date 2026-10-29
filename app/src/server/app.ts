// Hono app assembly (plan §5): thin routing + validation over the core
// engine. Every handler resolves the project/castle via project-context.ts
// and calls straight into core/importer — no business logic lives here.
// Mounted at /api/v1; errors always come back as { error: { code, message } }.

import { Hono } from 'hono';
import { CastleExistsError, NoCastleError, NotFoundError } from '../core/index.js';
import { HttpError } from './http-errors.js';
import { InvalidApiKeyError, LlmBadOutputError, LlmNotConfiguredError, NotConfiguredLlmService } from './llm-seam.js';
import type { LlmService } from './llm-seam.js';
import { PatrolAlreadyRunningError, PatrolCancelledError } from '../flows/patrolFlow.js';
import { registerChronicleRoutes } from './routes/chronicle.js';
import { registerDoctorRoutes } from './routes/doctor.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerImportRoutes } from './routes/import.js';
import { registerKeepRoutes } from './routes/keep.js';
import { registerLlmRoutes } from './routes/llm.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerRecallRoutes } from './routes/recall.js';
import { registerRoomRoutes } from './routes/rooms.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerWalkRoutes } from './routes/walks.js';

export interface CreateAppOptions {
  llmService?: LlmService;
}

export function createApp(options: CreateAppOptions = {}): Hono {
  const llmService = options.llmService ?? new NotConfiguredLlmService();
  const app = new Hono().basePath('/api/v1');

  registerHealthRoutes(app);
  registerSettingsRoutes(app, { llmService });
  registerProjectRoutes(app);
  registerKeepRoutes(app);
  registerChronicleRoutes(app);
  registerDoctorRoutes(app);
  registerRoomRoutes(app);
  registerRecallRoutes(app, { llmService });
  registerWalkRoutes(app);
  registerImportRoutes(app);
  registerLlmRoutes(app, { llmService });
  registerSystemRoutes(app);

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as never);
    }
    if (err instanceof CastleExistsError) {
      return c.json({ error: { code: 'castle_exists', message: err.message } }, 409);
    }
    if (err instanceof NoCastleError) {
      return c.json({ error: { code: 'no_castle', message: err.message } }, 409);
    }
    if (err instanceof NotFoundError) {
      return c.json({ error: { code: 'not_found', message: err.message } }, 404);
    }
    if (err instanceof LlmNotConfiguredError) {
      return c.json({ error: { code: 'llm_not_configured', message: err.message } }, 409);
    }
    if (err instanceof InvalidApiKeyError) {
      return c.json({ error: { code: 'invalid_api_key', message: err.message } }, 401);
    }
    if (err instanceof LlmBadOutputError) {
      return c.json({ error: { code: 'llm_bad_output', message: err.message } }, 502);
    }
    if (err instanceof PatrolCancelledError) {
      return c.json({ error: { code: 'patrol_cancelled', message: err.message } }, 409);
    }
    if (err instanceof PatrolAlreadyRunningError) {
      return c.json({ error: { code: 'patrol_already_running', message: err.message } }, 409);
    }
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: { code: 'internal_error', message } }, 500);
  });

  // Hono's default notFound is a plain-text "404 Not Found" body — every
  // other response on this app follows the plan §5 error envelope, so an
  // unmatched /api/v1/* path (typo, wrong verb) should too.
  app.notFound((c) => c.json({ error: { code: 'not_found', message: `找不到路徑：${c.req.path}` } }, 404));

  return app;
}
