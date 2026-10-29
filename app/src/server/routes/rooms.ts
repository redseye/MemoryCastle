// Room delete is yellow-level (confirm required); everything else is a plain
// CRUD wrapper over castle.rooms — PATCH is how the UI fixes locus drift.
// Record appends are budget-checked: a room at roomMax refuses with 409
// over_budget unless the body carries override:true.

import type { Hono } from 'hono';
import { HttpError } from '../http-errors.js';
import { openProjectCastle } from '../project-context.js';
import { checkAppendBudget, loadRecordRules, parseRecordInput, parseRoomInput, parseRoomPatch } from '../records-validate.js';
import { jsonBody } from '../request.js';

export function registerRoomRoutes(app: Hono): void {
  app.get('/projects/:id/rooms', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    return c.json({ rooms: await castle.rooms.list() });
  });

  app.post('/projects/:id/rooms', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    const input = parseRoomInput(await jsonBody<Record<string, unknown>>(c));
    const room = await castle.rooms.append(input);
    return c.json(room, 201);
  });

  app.get('/projects/:id/rooms/:slug', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    const slug = c.req.param('slug');
    const room = await castle.rooms.get(slug);
    if (!room) throw new HttpError(404, 'not_found', `找不到房間：${slug}`);
    return c.json(room);
  });

  app.patch('/projects/:id/rooms/:slug', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    const patch = parseRoomPatch(await jsonBody<Record<string, unknown>>(c));
    const room = await castle.rooms.update(c.req.param('slug'), patch); // NotFoundError -> 404 centrally
    return c.json(room);
  });

  app.post('/projects/:id/rooms/:slug/records', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    const slug = c.req.param('slug');
    const body = await jsonBody<Record<string, unknown>>(c);
    const input = parseRecordInput(body, await loadRecordRules(castle));
    const room = await castle.rooms.get(slug);
    if (!room) throw new HttpError(404, 'not_found', `找不到房間：${slug}`);
    const meta = await castle.getMeta();
    checkAppendBudget(body, room.records.length, meta.budgets.roomMax, `房間 ${slug}`);
    const record = await castle.rooms.appendRecord(slug, input);
    return c.json(record, 201);
  });

  app.delete('/projects/:id/rooms/:slug', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    if (c.req.query('confirm') !== 'true') {
      throw new HttpError(400, 'confirm_required', '刪除房間需要 confirm=true 確認');
    }
    const room = await castle.rooms.remove(c.req.param('slug')); // NotFoundError -> 404 centrally
    return c.json(room);
  });
}
