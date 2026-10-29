// keep is yellow-level per architecture.md: writes and deletes require an
// explicit confirm flag so the caller (UI confirm dialog, or an agent that
// already asked the user) has to opt in deliberately. Appends are also
// budget-checked: keep at keepMax refuses with 409 over_budget unless the
// body carries override:true.

import type { Hono } from 'hono';
import type { KeepSection } from '../../core/index.js';
import { HttpError } from '../http-errors.js';
import { openProjectCastle } from '../project-context.js';
import { checkAppendBudget, loadRecordRules, parseRecordInput } from '../records-validate.js';
import { jsonBody } from '../request.js';

const SECTIONS: KeepSection[] = ['identity', 'constraints', 'core'];

function isSection(value: unknown): value is KeepSection {
  return typeof value === 'string' && (SECTIONS as string[]).includes(value);
}

export function registerKeepRoutes(app: Hono): void {
  app.get('/projects/:id/keep', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    const [identity, constraints, core] = await Promise.all([
      castle.keep.list('identity'),
      castle.keep.list('constraints'),
      castle.keep.list('core'),
    ]);
    return c.json({ sections: { identity, constraints, core } });
  });

  app.post('/projects/:id/keep/records', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    const body = await jsonBody<Record<string, unknown>>(c);
    if (body.confirm !== true) {
      throw new HttpError(400, 'confirm_required', '寫入 keep 需要 confirm:true 確認');
    }
    if (!isSection(body.section)) {
      throw new HttpError(400, 'invalid_body', 'section 必須是 identity/constraints/core 其中之一');
    }
    const input = parseRecordInput(body, await loadRecordRules(castle));
    const [meta, counts] = await Promise.all([castle.getMeta(), castle.countBudgets()]);
    checkAppendBudget(body, counts.keepCount, meta.budgets.keepMax, 'keep');
    const record = await castle.keep.append(body.section, input);
    return c.json(record, 201);
  });

  app.delete('/projects/:id/keep/records/:rid', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    if (c.req.query('confirm') !== 'true') {
      throw new HttpError(400, 'confirm_required', '刪除 keep 記錄需要 confirm=true 確認');
    }
    const removed = await castle.keep.remove(c.req.param('rid')); // NotFoundError -> 404 centrally
    return c.json(removed);
  });
}
