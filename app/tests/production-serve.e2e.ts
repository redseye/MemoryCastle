// M6 checkpoint: `npm run build:all` then `node dist/cli.js serve` must serve
// the UI and API on one port. Skipped when dist/public hasn't been built yet
// (mirrors llm-live-smoke.test.ts's describe.skipIf gating pattern) — the
// rest of the suite must still pass with zero build step.

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server/index.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(here, '..', 'dist', 'public');
const built = existsSync(join(PUBLIC_DIR, 'index.html'));

describe.skipIf(!built)('production single-port serving (requires npm run build:all)', () => {
  it('serves the built SPA and the API on one port, with SPA fallback and JSON 404 for unknown API paths', async () => {
    const server = await startServer({ port: 0, publicDir: PUBLIC_DIR });
    try {
      expect(server.servingUi).toBe(true);
      const base = `http://127.0.0.1:${server.port}`;

      const index = await fetch(`${base}/`);
      expect(index.status).toBe(200);
      expect(index.headers.get('content-type')).toContain('text/html');
      expect(await index.text()).toContain('<div id="root">');

      const health = await fetch(`${base}/api/v1/health`);
      expect(health.status).toBe(200);
      expect((await health.json()).ok).toBe(true);

      const spaRoute = await fetch(`${base}/some/spa/route`);
      expect(spaRoute.status).toBe(200);
      expect(spaRoute.headers.get('content-type')).toContain('text/html');

      const missingApi = await fetch(`${base}/api/v1/nope`);
      expect(missingApi.status).toBe(404);
      expect((await missingApi.json()).error.code).toBe('not_found');
    } finally {
      await server.close();
    }
  });
});
