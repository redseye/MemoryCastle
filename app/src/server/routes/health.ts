import type { Hono } from 'hono';
import { readConfig } from '../../config/index.js';
import { VERSION } from '../version.js';

export function registerHealthRoutes(app: Hono): void {
  app.get('/health', async (c) => {
    const config = await readConfig();
    return c.json({ ok: true, version: VERSION, projects: config.projects.length });
  });
}
