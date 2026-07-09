// Route-level mapping tests for POST /system/pick-folder, independent of
// the real pick-folder.ts module: registerSystemRoutes accepts a DI'd
// pickFolderFn (test-only, see src/server/routes/system.ts's file comment)
// so branches the real module can't reach on this Windows dev machine —
// not_supported, busy, timeout — still get their HTTP mapping verified.
// tests/api.e2e.ts covers the ok/cancelled shapes through the full
// createApp() stack via the MEMORYCASTLE_FAKE_PICKER env seam instead.

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { registerSystemRoutes } from '../src/server/routes/system.js';
import type { PickFolderResult } from '../src/server/pick-folder.js';

function buildApp(result: PickFolderResult): Hono {
  const app = new Hono().basePath('/api/v1');
  registerSystemRoutes(app, { pickFolderFn: async () => result });
  app.onError((err, c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (err as any).status ?? 500;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const code = (err as any).code ?? 'internal_error';
    return c.json({ error: { code, message: err.message } }, status);
  });
  return app;
}

async function post(app: Hono, path: string) {
  const res = await app.request(`/api/v1${path}`, { method: 'POST' });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

describe('POST /system/pick-folder route mapping', () => {
  it('maps not_supported to 501', async () => {
    const res = await post(buildApp({ kind: 'not_supported' }), '/system/pick-folder');
    expect(res.status).toBe(501);
    expect(res.json.error.code).toBe('not_supported');
  });

  it('maps busy to 409 picker_busy', async () => {
    const res = await post(buildApp({ kind: 'busy' }), '/system/pick-folder');
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('picker_busy');
  });

  it('maps timeout to 408 picker_timeout', async () => {
    const res = await post(buildApp({ kind: 'timeout' }), '/system/pick-folder');
    expect(res.status).toBe(408);
    expect(res.json.error.code).toBe('picker_timeout');
  });

  it('maps ok to 200 with the path', async () => {
    const res = await post(buildApp({ kind: 'ok', path: 'C:/x' }), '/system/pick-folder');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ path: 'C:/x' });
  });

  it('maps cancelled to 200 with cancelled:true', async () => {
    const res = await post(buildApp({ kind: 'cancelled' }), '/system/pick-folder');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ cancelled: true });
  });
});
