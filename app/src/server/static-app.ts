// M6: single-port production serving. Wraps the API app (app.ts) together
// with the built web UI (dist/public, produced by `npm run web:build`)
// behind one Hono app: /api/* is delegated whole to the API app (so it keeps
// its own routing, JSON 404, and error envelope); everything else is served
// as a static file, falling back to index.html for client-side routes (SPA)
// so a hard refresh on e.g. /rooms/foo still works.
//
// Dev mode is untouched: `npm run web:dev` runs Vite's own dev server, which
// proxies /api to a separately-running API process (vite.config.ts) — this
// module is only reached via `memorycastle serve` against a real build.

import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app.js';
import type { CreateAppOptions } from './app.js';

export function createProductionApp(publicDir: string, options: CreateAppOptions = {}): Hono {
  const apiApp = createApp(options);
  const app = new Hono();

  app.all('/api/*', (c) => apiApp.fetch(c.req.raw));
  app.use('/*', serveStatic({ root: publicDir }));
  app.use('*', serveStatic({ root: publicDir, path: 'index.html' }));

  return app;
}
