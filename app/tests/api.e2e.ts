// End-to-end coverage for the M3 REST API (plan §5). Drives the Hono app
// in-process via app.request() — no real port needed — against temp
// projects, exercising every endpoint's status code and response shape.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';
import { createApp } from '../src/server/index.js';
import { cleanupTempDir, makeTempDir } from './helpers.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_ROOT = join(here, 'fixtures', 'memorycastle-castle');

interface ApiResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

async function req(app: Hono, method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await app.request(`/api/v1${path}`, init);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

// Registers root (creating the directory first) and, if it comes back
// 409 no_castle (the expected case for a bare directory), initializes it —
// mirroring the real register -> init flow plan §5 describes.
async function registerAndInit(app: Hono, root: string, name: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const reg = await req(app, 'POST', '/projects', { root, name });
  const id: string = reg.json.project.id;
  if (reg.status === 409) {
    const init = await req(app, 'POST', `/projects/${id}/init`);
    expect(init.status).toBe(201);
  } else {
    expect(reg.status).toBe(201);
  }
  return id;
}

describe('REST API e2e', () => {
  let container: string;
  let app: Hono;
  let projectId: string;
  const originalConfigEnv = process.env.MEMORYCASTLE_CONFIG;

  beforeEach(async () => {
    container = await makeTempDir();
    process.env.MEMORYCASTLE_CONFIG = join(container, 'config.json');
    app = createApp();
    projectId = await registerAndInit(app, join(container, 'project'), 'Test Project');
  });

  afterEach(async () => {
    await cleanupTempDir(container);
    if (originalConfigEnv === undefined) delete process.env.MEMORYCASTLE_CONFIG;
    else process.env.MEMORYCASTLE_CONFIG = originalConfigEnv;
  });

  it('GET /health reports ok, a version string, and the registered project count', async () => {
    const res = await req(app, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(typeof res.json.version).toBe('string');
    expect(res.json.projects).toBe(1);
  });

  describe('settings', () => {
    it('masks apiKey on GET and after PUT, and the masked value round-trips', async () => {
      let res = await req(app, 'GET', '/settings');
      expect(res.status).toBe(200);
      expect(res.json.llm.apiKey).toBe('');

      res = await req(app, 'PUT', '/settings', { llm: { apiKey: 'sk-test-1234567890' } });
      expect(res.status).toBe(200);
      expect(res.json.llm.apiKey).not.toContain('sk-test');
      expect(res.json.llm.apiKey.endsWith('7890')).toBe(true);

      res = await req(app, 'GET', '/settings');
      expect(res.json.llm.apiKey.endsWith('7890')).toBe(true);
    });

    it('rejects an unknown provider with 400 invalid_body', async () => {
      const res = await req(app, 'PUT', '/settings', { llm: { provider: 'bogus' } });
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe('invalid_body');
    });

    it('POST /settings/test returns 409 llm_not_configured', async () => {
      const res = await req(app, 'POST', '/settings/test');
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('llm_not_configured');
    });

    it('GET /settings defaults llm.mode to "api" and PUT round-trips mode:"cli"', async () => {
      let res = await req(app, 'GET', '/settings');
      expect(res.json.llm.mode).toBe('api');

      res = await req(app, 'PUT', '/settings', { llm: { provider: 'gemini', mode: 'cli' } });
      expect(res.status).toBe(200);
      expect(res.json.llm.mode).toBe('cli');
      expect(res.json.llm.provider).toBe('gemini');

      res = await req(app, 'GET', '/settings');
      expect(res.json.llm.mode).toBe('cli');
    });

    it('rejects an unknown mode with 400 invalid_body', async () => {
      const res = await req(app, 'PUT', '/settings', { llm: { mode: 'bogus' } });
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe('invalid_body');
    });

    it('GET /settings/cli-status returns the {claude, codex, agy} shape', async () => {
      const res = await req(app, 'GET', '/settings/cli-status');
      expect(res.status).toBe(200);
      expect(Object.keys(res.json).sort()).toEqual(['agy', 'claude', 'codex']);
      for (const name of ['claude', 'codex', 'agy']) {
        expect(typeof res.json[name].found).toBe('boolean');
      }
    });
  });

  describe('system: pick-folder', () => {
    const originalFake = process.env.MEMORYCASTLE_FAKE_PICKER;

    afterEach(() => {
      if (originalFake === undefined) delete process.env.MEMORYCASTLE_FAKE_PICKER;
      else process.env.MEMORYCASTLE_FAKE_PICKER = originalFake;
    });

    // MEMORYCASTLE_FAKE_PICKER short-circuits before any spawn — see
    // src/server/routes/system.ts. A Chinese path here exercises the same
    // JSON round-trip the real UTF-8-temp-file path relies on, without
    // needing an actual dialog click.
    it('returns 200 with the fake path when MEMORYCASTLE_FAKE_PICKER is set', async () => {
      process.env.MEMORYCASTLE_FAKE_PICKER = 'D:/Project/示範專案';
      const res = await req(app, 'POST', '/system/pick-folder');
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ path: 'D:/Project/示範專案' });
    });

    it('returns 200 with cancelled:true when MEMORYCASTLE_FAKE_PICKER=cancel', async () => {
      process.env.MEMORYCASTLE_FAKE_PICKER = 'cancel';
      const res = await req(app, 'POST', '/system/pick-folder');
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ cancelled: true });
    });
  });

  describe('projects', () => {
    it('POST on a directory with no castle registers it anyway and returns 409 with an init hint', async () => {
      const dir = join(container, 'bare');
      await mkdir(dir, { recursive: true });
      const res = await req(app, 'POST', '/projects', { root: dir, name: 'Bare' });
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('no_castle');
      expect(res.json.project.id).toBe('bare');

      const list = await req(app, 'GET', '/projects');
      expect(list.json.projects.some((p: { id: string }) => p.id === 'bare')).toBe(true);
    });

    it('POST on a directory that already has a castle returns 201', async () => {
      const res = await req(app, 'POST', '/projects', { root: join(container, 'project'), name: 'Test Project Again' });
      expect(res.status).toBe(201);
    });

    it('POST init on an already-initialized project returns 409 castle_exists', async () => {
      const res = await req(app, 'POST', `/projects/${projectId}/init`);
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('castle_exists');
    });

    it('GET /projects/:id/castle returns budgets, counts, patrolDue, lastPatrolAt', async () => {
      const res = await req(app, 'GET', `/projects/${projectId}/castle`);
      expect(res.status).toBe(200);
      expect(res.json.budgets.keepMax).toBe(30);
      expect(res.json.counts.keepCount).toBe(0);
      expect(res.json.patrolDue).toHaveProperty('due');
      expect(typeof res.json.lastPatrolAt).toBe('string');
    });

    it('unknown project id returns 404 project_not_found', async () => {
      const res = await req(app, 'GET', '/projects/does-not-exist/castle');
      expect(res.status).toBe(404);
      expect(res.json.error.code).toBe('project_not_found');
    });

    it('GET /projects/:id/routes returns the 3 default routes on a fresh castle', async () => {
      const res = await req(app, 'GET', `/projects/${projectId}/routes`);
      expect(res.status).toBe(200);
      expect(res.json.routes.map((r: { name: string }) => r.name)).toEqual([
        'session-start',
        'before-release',
        'patrol',
      ]);
      expect(res.json.routes[0].stops.length).toBeGreaterThan(0);
    });

    it('DELETE unregisters without touching the castle on disk', async () => {
      const del = await req(app, 'DELETE', `/projects/${projectId}`);
      expect(del.status).toBe(200);

      const gone = await req(app, 'GET', `/projects/${projectId}/castle`);
      expect(gone.status).toBe(404);

      // Re-registering the same root finds the untouched castle again.
      const reReg = await req(app, 'POST', '/projects', { root: join(container, 'project'), name: 'Test Project' });
      expect(reReg.status).toBe(201);
    });
  });

  describe('keep', () => {
    it('POST without confirm:true is rejected with 400 confirm_required', async () => {
      const res = await req(app, 'POST', `/projects/${projectId}/keep/records`, {
        section: 'identity',
        confidence: 'high',
        source: 'user',
        fact: '測試身分事實',
      });
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe('confirm_required');
    });

    it('POST with confirm:true appends to the given section, and GET reflects it', async () => {
      const res = await req(app, 'POST', `/projects/${projectId}/keep/records`, {
        section: 'constraints',
        confirm: true,
        confidence: 'high',
        source: 'user',
        fact: '測試約束事實',
        tags: ['t1'],
      });
      expect(res.status).toBe(201);
      expect(res.json.fact).toBe('測試約束事實');
      const rid = res.json.id;

      const list = await req(app, 'GET', `/projects/${projectId}/keep`);
      expect(list.status).toBe(200);
      expect(list.json.sections.constraints.map((r: { id: string }) => r.id)).toContain(rid);

      const delNoConfirm = await req(app, 'DELETE', `/projects/${projectId}/keep/records/${rid}`);
      expect(delNoConfirm.status).toBe(400);
      expect(delNoConfirm.json.error.code).toBe('confirm_required');

      const delConfirmed = await req(app, 'DELETE', `/projects/${projectId}/keep/records/${rid}?confirm=true`);
      expect(delConfirmed.status).toBe(200);
      expect(delConfirmed.json.id).toBe(rid);
    });
  });

  describe('chronicle', () => {
    it('POST appends directly (green level, no confirm needed) and GET lists it', async () => {
      const res = await req(app, 'POST', `/projects/${projectId}/chronicle/records`, {
        confidence: 'med',
        source: 'agent',
        fact: '測試時間軸事實',
      });
      expect(res.status).toBe(201);

      const list = await req(app, 'GET', `/projects/${projectId}/chronicle`);
      expect(list.status).toBe(200);
      expect(list.json.entries).toHaveLength(1);
      expect(list.json.entries[0].fact).toBe('測試時間軸事實');
    });

    it('rejects a body missing a required field with 400 invalid_body', async () => {
      const res = await req(app, 'POST', `/projects/${projectId}/chronicle/records`, { source: 'agent', fact: 'x' });
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe('invalid_body');
    });
  });

  describe('rooms', () => {
    it('full CRUD + record append, and delete requires confirm=true', async () => {
      let res = await req(app, 'POST', `/projects/${projectId}/rooms`, { name: '測試房間', locus: ['src/**'] });
      expect(res.status).toBe(201);
      const slug = res.json.slug;

      res = await req(app, 'GET', `/projects/${projectId}/rooms`);
      expect(res.json.rooms.map((r: { slug: string }) => r.slug)).toContain(slug);

      res = await req(app, 'GET', `/projects/${projectId}/rooms/${slug}`);
      expect(res.status).toBe(200);
      expect(res.json.name).toBe('測試房間');

      res = await req(app, 'PATCH', `/projects/${projectId}/rooms/${slug}`, { adjacent: ['other'] });
      expect(res.status).toBe(200);
      expect(res.json.adjacent).toEqual(['other']);

      res = await req(app, 'POST', `/projects/${projectId}/rooms/${slug}/records`, {
        confidence: 'low',
        source: 'agent',
        fact: '房間裡的事實',
      });
      expect(res.status).toBe(201);

      res = await req(app, 'DELETE', `/projects/${projectId}/rooms/${slug}`);
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe('confirm_required');

      res = await req(app, 'DELETE', `/projects/${projectId}/rooms/${slug}?confirm=true`);
      expect(res.status).toBe(200);

      res = await req(app, 'GET', `/projects/${projectId}/rooms/${slug}`);
      expect(res.status).toBe(404);
    });
  });

  describe('recall', () => {
    it('standing recall matches rooms by locus deterministically', async () => {
      await req(app, 'POST', `/projects/${projectId}/rooms`, { name: 'Src Room', locus: ['src/**'] });
      const res = await req(app, 'GET', `/projects/${projectId}/recall/standing?paths=src/index.ts`);
      expect(res.status).toBe(200);
      expect(res.json.rooms).toHaveLength(1);
      expect(res.json.rooms[0].name).toBe('Src Room');
    });

    it('standing recall with fuzzy=true returns 409 llm_not_configured', async () => {
      const res = await req(app, 'GET', `/projects/${projectId}/recall/standing?paths=src/index.ts&fuzzy=true`);
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('llm_not_configured');
    });

    it('search finds a substring match by tag and by text', async () => {
      await req(app, 'POST', `/projects/${projectId}/chronicle/records`, {
        confidence: 'high',
        source: 'user',
        fact: '可搜尋的關鍵字事實',
        tags: ['searchable'],
      });
      const byText = await req(app, 'GET', `/projects/${projectId}/recall/search?q=關鍵字`);
      expect(byText.status).toBe(200);
      expect(byText.json.results).toHaveLength(1);

      const byTag = await req(app, 'GET', `/projects/${projectId}/recall/search?q=&tag=searchable`);
      expect(byTag.json.results).toHaveLength(1);
    });
  });

  describe('walks', () => {
    it('reports N/N with the exact contracted text; rooms-by-locus is deferred when no paths are given', async () => {
      const res = await req(app, 'POST', `/projects/${projectId}/walks`, { route: 'session-start' });
      expect(res.status).toBe(200);
      expect(res.json.stops.some((s: { target: string }) => s.target === 'keep')).toBe(true);
      expect(res.json.report.text).toBe('巡行 0/0 房，發現 0 項注意；延後 1 站');
      expect(res.json.report.valid).toBe(true);
      expect(res.json.stops.find((s: { target: string }) => s.target === 'rooms-by-locus')).toEqual({
        target: 'rooms-by-locus',
        lines: [],
        deferred: true,
      });
    });

    it('an invalid read value skips the stop and invalidates the walk (no 500)', async () => {
      const castleRoutesPath = join(container, 'project', '.claude', 'castle', 'routes.json');
      const routesFile = JSON.parse(await readFile(castleRoutesPath, 'utf8'));
      routesFile.routes.push({ name: 'bad', occasion: 'test', stops: [{ target: 'keep', read: 'everything' }] });
      await writeFile(castleRoutesPath, JSON.stringify(routesFile));
      const res = await req(app, 'POST', `/projects/${projectId}/walks`, { route: 'bad' });
      expect(res.status).toBe(200);
      expect(res.json.report.valid).toBe(false);
      expect(res.json.stops).toEqual([{ target: 'keep', lines: [], read: 'everything', skipped: true }]);
    });

    it('an absolute Windows-style path inside the project loads the owning room', async () => {
      await req(app, 'POST', `/projects/${projectId}/rooms`, { name: 'App Room', locus: ['app/**'] });
      const abs = join(container, 'project', 'App', 'src', 'core', 'locus.ts').replace(/\//g, '\\');
      const res = await req(app, 'POST', `/projects/${projectId}/walks`, { route: 'session-start', paths: [abs] });
      expect(res.json.report.text).toBe('巡行 1/1 房，發現 0 項注意');
      expect(res.json.stops.map((s: { target: string }) => s.target)).toContain('room:app-room');
    });

    it('visits a locus-matched room when paths are given', async () => {
      await req(app, 'POST', `/projects/${projectId}/rooms`, { name: 'Src Room', locus: ['src/**'] });
      const res = await req(app, 'POST', `/projects/${projectId}/walks`, {
        route: 'session-start',
        paths: ['src/index.ts'],
      });
      expect(res.status).toBe(200);
      expect(res.json.report.text).toBe('巡行 1/1 房，發現 0 項注意');
    });

    it('an unknown route returns 404 route_not_found', async () => {
      const res = await req(app, 'POST', `/projects/${projectId}/walks`, { route: 'no-such-route' });
      expect(res.status).toBe(404);
      expect(res.json.error.code).toBe('route_not_found');
    });
  });

  describe('import', () => {
    it('preview then apply on a copy of the real markdown castle, then a second apply is 409', async () => {
      const importRoot = join(container, 'import-project');
      await cp(FIXTURE_ROOT, importRoot, { recursive: true });
      const reg = await req(app, 'POST', '/projects', { root: importRoot, name: 'Import Project' });
      expect(reg.status).toBe(409); // markdown only, no castle.json yet
      const id = reg.json.project.id;

      const preview = await req(app, 'POST', `/projects/${id}/import`);
      expect(preview.status).toBe(200);
      expect(preview.json.counts).toEqual({ keep: 6, chronicle: 16, routes: 3, rooms: 0, archiveMonths: 0 });
      expect(preview.json.warnings).toEqual([]);

      const apply = await req(app, 'POST', `/projects/${id}/import/apply`);
      expect(apply.status).toBe(201);
      expect(apply.json.counts).toEqual({ keep: 6, chronicle: 16, routes: 3, rooms: 0, archiveMonths: 0 });
      expect(apply.json.movedFiles.length).toBeGreaterThan(0);

      const applyAgain = await req(app, 'POST', `/projects/${id}/import/apply`);
      expect(applyAgain.status).toBe(409);
      expect(applyAgain.json.error.code).toBe('castle_exists');

      const routes = await req(app, 'GET', `/projects/${id}/routes`);
      expect(routes.status).toBe(200);
      expect(routes.json.routes).toHaveLength(3);
      expect(routes.json.routes.map((r: { name: string }) => r.name)).toEqual([
        'session-start',
        'before-release',
        'patrol',
      ]);
    });
  });

  describe('v0.5 record validation (contract C1/C2)', () => {
    const base = { confidence: 'med', source: 'agent' };

    it('accepts a 200-char fact and rejects a 201-char fact with 400 fact_too_long', async () => {
      const ok = await req(app, 'POST', `/projects/${projectId}/chronicle/records`, { ...base, fact: '字'.repeat(200) });
      expect(ok.status).toBe(201);
      const tooLong = await req(app, 'POST', `/projects/${projectId}/chronicle/records`, { ...base, fact: '字'.repeat(201) });
      expect(tooLong.status).toBe(400);
      expect(tooLong.json.error.code).toBe('fact_too_long');
    });

    it('honors a castle-specific factMaxChars from castle.json', async () => {
      const metaPath = join(container, 'project', '.claude', 'castle', 'castle.json');
      const meta = JSON.parse(await readFile(metaPath, 'utf8'));
      meta.budgets.factMaxChars = 10;
      await writeFile(metaPath, JSON.stringify(meta));
      const res = await req(app, 'POST', `/projects/${projectId}/chronicle/records`, { ...base, fact: 'x'.repeat(11) });
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe('fact_too_long');
    });

    it('defaults factMaxChars to 200 for a castle.json written before the field existed', async () => {
      const metaPath = join(container, 'project', '.claude', 'castle', 'castle.json');
      const meta = JSON.parse(await readFile(metaPath, 'utf8'));
      delete meta.budgets.factMaxChars;
      await writeFile(metaPath, JSON.stringify(meta));
      const castle = await req(app, 'GET', `/projects/${projectId}/castle`);
      expect(castle.json.budgets.factMaxChars).toBe(200);
      const res = await req(app, 'POST', `/projects/${projectId}/chronicle/records`, { ...base, fact: 'x'.repeat(201) });
      expect(res.json.error.code).toBe('fact_too_long');
    });

    it('rejects a multiline fact with 400 fact_multiline', async () => {
      const res = await req(app, 'POST', `/projects/${projectId}/chronicle/records`, { ...base, fact: '第一行\n第二行' });
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe('fact_multiline');
    });

    it('rejects a routeWarning naming a route that does not exist, accepts an existing one', async () => {
      const bad = await req(app, 'POST', `/projects/${projectId}/chronicle/records`, { ...base, fact: 'x', routeWarning: 'no-such-route' });
      expect(bad.status).toBe(400);
      expect(bad.json.error.code).toBe('route_warning_invalid');
      const good = await req(app, 'POST', `/projects/${projectId}/chronicle/records`, { ...base, fact: 'x', routeWarning: 'before-release' });
      expect(good.status).toBe(201);
      expect(good.json.routeWarning).toBe('before-release');
    });

    it('accepts a YYYY-MM-DD verifiedAt and rejects a malformed one', async () => {
      const good = await req(app, 'POST', `/projects/${projectId}/chronicle/records`, { ...base, fact: 'x', verifiedAt: '2026-10-28' });
      expect(good.status).toBe(201);
      expect(good.json.verifiedAt).toBe('2026-10-28');
      for (const verifiedAt of ['2026/10/28', '2026-02-30', 20261028]) {
        const bad = await req(app, 'POST', `/projects/${projectId}/chronicle/records`, { ...base, fact: 'x', verifiedAt });
        expect(bad.status).toBe(400);
        expect(bad.json.error.code).toBe('invalid_body');
      }
    });

    it('applies the same fact cap to keep and room appends', async () => {
      const keep = await req(app, 'POST', `/projects/${projectId}/keep/records`, {
        ...base,
        section: 'core',
        confirm: true,
        fact: 'x'.repeat(201),
      });
      expect(keep.json.error.code).toBe('fact_too_long');
      const room = await req(app, 'POST', `/projects/${projectId}/rooms`, { name: 'Cap Room', locus: ['src/**'] });
      const rec = await req(app, 'POST', `/projects/${projectId}/rooms/${room.json.slug}/records`, { ...base, fact: 'a\r\nb' });
      expect(rec.json.error.code).toBe('fact_multiline');
    });
  });

  describe('v0.5 write-time budgets', () => {
    it('the 31st keep append is 409 over_budget; override:true lets it through with 201', async () => {
      for (let i = 0; i < 30; i++) {
        const res = await req(app, 'POST', `/projects/${projectId}/keep/records`, {
          section: 'core',
          confirm: true,
          confidence: 'high',
          source: 'user',
          fact: `k${i}`,
        });
        expect(res.status).toBe(201);
      }
      const body = { section: 'identity', confirm: true, confidence: 'high', source: 'user', fact: 'k30' };
      const refused = await req(app, 'POST', `/projects/${projectId}/keep/records`, body);
      expect(refused.status).toBe(409);
      expect(refused.json.error.code).toBe('over_budget');
      const overridden = await req(app, 'POST', `/projects/${projectId}/keep/records`, { ...body, override: true });
      expect(overridden.status).toBe(201);
      const keep = await req(app, 'GET', `/projects/${projectId}/keep`);
      expect(keep.json.sections.core.length + keep.json.sections.identity.length).toBe(31);
    }, 30000);

    it('a room at roomMax refuses the next record with 409 over_budget unless override:true', async () => {
      const metaPath = join(container, 'project', '.claude', 'castle', 'castle.json');
      const meta = JSON.parse(await readFile(metaPath, 'utf8'));
      meta.budgets.roomMax = 2;
      await writeFile(metaPath, JSON.stringify(meta));
      const room = await req(app, 'POST', `/projects/${projectId}/rooms`, { name: 'Small Room', locus: ['src/**'] });
      const path = `/projects/${projectId}/rooms/${room.json.slug}/records`;
      const rec = { confidence: 'high', source: 'user', fact: 'r' };
      expect((await req(app, 'POST', path, rec)).status).toBe(201);
      expect((await req(app, 'POST', path, rec)).status).toBe(201);
      const refused = await req(app, 'POST', path, rec);
      expect(refused.status).toBe(409);
      expect(refused.json.error.code).toBe('over_budget');
      expect((await req(app, 'POST', path, { ...rec, override: true })).status).toBe(201);
    });

    it('a record append to a missing room is still 404', async () => {
      const res = await req(app, 'POST', `/projects/${projectId}/rooms/ghost/records`, { confidence: 'high', source: 'user', fact: 'r' });
      expect(res.status).toBe(404);
    });
  });

  describe('v0.5 search and recall limits', () => {
    it('search with neither q nor tag is 400 invalid_query (never "return everything")', async () => {
      await req(app, 'POST', `/projects/${projectId}/chronicle/records`, { confidence: 'high', source: 'user', fact: 'x' });
      for (const qs of ['', '?q=', '?q=%20&tag=']) {
        const res = await req(app, 'GET', `/projects/${projectId}/recall/search${qs}`);
        expect(res.status).toBe(400);
        expect(res.json.error.code).toBe('invalid_query');
      }
    });

    it('caps results at 20 by default and at most 100; rejects a non-positive limit', async () => {
      const castleRoot = join(container, 'project', '.claude', 'castle', 'chronicle.json');
      const chronicle = JSON.parse(await readFile(castleRoot, 'utf8'));
      for (let i = 0; i < 120; i++) {
        chronicle.entries.push({ id: `id${i}`, date: '2026-10-01', confidence: 'high', source: 'user', fact: `命中 ${i}`, tags: [] });
      }
      await writeFile(castleRoot, JSON.stringify(chronicle));
      const byDefault = await req(app, 'GET', `/projects/${projectId}/recall/search?q=命中`);
      expect(byDefault.json.results).toHaveLength(20);
      const fifty = await req(app, 'GET', `/projects/${projectId}/recall/search?q=命中&limit=50`);
      expect(fifty.json.results).toHaveLength(50);
      const capped = await req(app, 'GET', `/projects/${projectId}/recall/search?q=命中&limit=500`);
      expect(capped.json.results).toHaveLength(100);
      const bad = await req(app, 'GET', `/projects/${projectId}/recall/search?q=命中&limit=0`);
      expect(bad.status).toBe(400);
      expect(bad.json.error.code).toBe('invalid_query');
    });

    it('fuzzy=true does not call the LLM when deterministic locus matching already found a room', async () => {
      await req(app, 'POST', `/projects/${projectId}/rooms`, { name: 'Src Room', locus: ['src/**'] });
      // No key configured: reaching the LLM would 409 llm_not_configured.
      const res = await req(app, 'GET', `/projects/${projectId}/recall/standing?paths=src/index.ts&fuzzy=true`);
      expect(res.status).toBe(200);
      expect(res.json.rooms.map((r: { name: string }) => r.name)).toEqual(['Src Room']);
    });
  });

  describe('LLM-dependent endpoints (M4 seam)', () => {
    it('POST /remember returns 409 llm_not_configured for a valid body', async () => {
      const res = await req(app, 'POST', `/projects/${projectId}/remember`, { text: 'README 都寫的事' });
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('llm_not_configured');
    });

    it('POST /patrol runs its deterministic pre-pass and succeeds with zero proposals when no key is configured', async () => {
      const res = await req(app, 'POST', `/projects/${projectId}/patrol`);
      expect(res.status).toBe(201);
      expect(res.json.status).toBe('proposed');
      expect(Array.isArray(res.json.warnings)).toBe(true);
      expect(res.json.proposals).toEqual([]);
    });

    it('GET /patrol/jobs/:id is key-optional: reads back a no-key job, 404 for unknown ids', async () => {
      const created = await req(app, 'POST', `/projects/${projectId}/patrol`);
      expect(created.status).toBe(201);
      const res = await req(app, 'GET', `/projects/${projectId}/patrol/jobs/${created.json.id}`);
      expect(res.status).toBe(200);
      expect(res.json.id).toBe(created.json.id);
      expect(Array.isArray(res.json.warnings)).toBe(true);

      const missing = await req(app, 'GET', `/projects/${projectId}/patrol/jobs/no-such-job`);
      expect(missing.status).toBe(404);
      expect(missing.json.error.code).toBe('not_found');
    });

    it('POST /patrol/jobs/:id/apply is key-optional: applying a proposal-less job is an empty no-op', async () => {
      const created = await req(app, 'POST', `/projects/${projectId}/patrol`);
      const res = await req(app, 'POST', `/projects/${projectId}/patrol/jobs/${created.json.id}/apply`);
      expect(res.status).toBe(200);
      expect(res.json.applyReport.appliedIds).toEqual([]);
      expect(res.json.applyReport.skippedYellowIds).toEqual([]);
    });
  });
});
