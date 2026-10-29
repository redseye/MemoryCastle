// remember and the patrol trio all live here. Only remember keeps the
// ensureLlmConfigured guard: it cannot do anything without gate judgment.
// The whole patrol trio is key-optional — POST runs the deterministic
// pre-pass (budgets/staleness/route-gaps) and deterministic proposals
// (handover sweep, staleReview — patrolFlow.ts) and merely skips the LLM
// proposal steps when unconfigured; GET is a pure read of an existing job;
// apply executes already-generated proposals via core ops and never calls
// the LLM.

import type { Hono } from 'hono';
import { HttpError } from '../http-errors.js';
import { ensureLlmConfigured, type LlmService } from '../llm-seam.js';
import { openProjectCastle } from '../project-context.js';
import { jsonBody } from '../request.js';
import { rememberFlow } from '../../flows/rememberFlow.js';
import { applyPatrolJob, cancelPatrol, getPatrolJob, runPatrol, STALE_DECISIONS, type StaleDecision } from '../../flows/patrolFlow.js';

interface RememberBody {
  text?: string;
  source?: string;
  dryRun?: boolean;
}

interface PatrolBody {
  full?: boolean;
}

interface PatrolApplyBody {
  approvals?: string[];
  decisions?: Record<string, unknown>;
}

// decisions: { [staleReview proposal id]: 'verify' | 'archive' | 'delete' }.
function parseDecisions(raw: unknown): Record<string, StaleDecision> {
  if (raw === undefined) return {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new HttpError(400, 'invalid_body', 'decisions 必須是 { proposalId: "verify"|"archive"|"delete" } 物件');
  }
  const out: Record<string, StaleDecision> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!(STALE_DECISIONS as readonly unknown[]).includes(value)) {
      throw new HttpError(400, 'invalid_body', `decisions.${id} 必須是 verify / archive / delete 其中之一`);
    }
    out[id] = value as StaleDecision;
  }
  return out;
}

export function registerLlmRoutes(app: Hono, deps: { llmService: LlmService }): void {
  app.post('/projects/:id/remember', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    const body = await jsonBody<RememberBody>(c);
    if (!body.text || typeof body.text !== 'string') {
      throw new HttpError(400, 'invalid_body', 'text 為必填字串');
    }
    await ensureLlmConfigured(deps.llmService);

    const result = await rememberFlow(castle, deps.llmService, {
      text: body.text,
      source: body.source,
      dryRun: body.dryRun,
    });

    if (!result.passed) {
      return c.json({ failedTests: result.failedTests, reason: result.reason }, 422);
    }
    if (result.dryRun) {
      return c.json({ passed: true, dryRun: true }, 200);
    }
    return c.json(result.record, 201);
  });

  app.post('/projects/:id/patrol', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    // No ensureLlmConfigured guard here on purpose — the deterministic
    // pre-pass always runs; the response body (including `id`, i.e. jobId)
    // is returned directly so warnings are visible even with no key set.
    // The body is optional: { full: true } restores the whole-castle
    // contradiction/promotion pass (default: incremental since lastPatrolAt).
    let body: PatrolBody = {};
    try {
      body = await c.req.json<PatrolBody>();
    } catch {
      body = {};
    }
    const job = await runPatrol(castle, deps.llmService, { full: body.full === true });
    return c.json(job, 201);
  });

  // Cancels the in-flight patrol for this project, if any — the only
  // containment for a runaway CLI-mode judge call now that
  // CLI_CALL_TIMEOUT_MS is disabled (see src/llm/constants.ts). Keyed by
  // castle.root, same as runPatrol's in-flight registry (patrolFlow.ts) —
  // resolving the castle here rather than trusting the raw :id keeps both
  // routes deriving the key identically.
  app.post('/projects/:id/patrol/cancel', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    const cancelled = cancelPatrol(castle.root);
    if (!cancelled) {
      throw new HttpError(404, 'patrol_not_running', '目前沒有正在執行的巡查工作');
    }
    return c.json({ cancelled: true }, 200);
  });

  app.get('/projects/:id/patrol/jobs/:jobId', async (c) => {
    await openProjectCastle(c.req.param('id'));
    const job = getPatrolJob(c.req.param('jobId'));
    if (!job) throw new HttpError(404, 'not_found', `找不到 patrol job：${c.req.param('jobId')}`);
    return c.json(job, 200);
  });

  app.post('/projects/:id/patrol/jobs/:jobId/apply', async (c) => {
    const castle = await openProjectCastle(c.req.param('id'));
    const jobId = c.req.param('jobId');
    if (!getPatrolJob(jobId)) {
      throw new HttpError(404, 'not_found', `找不到 patrol job：${jobId}`);
    }
    // approvals is optional — a bare POST with no body means "apply green
    // proposals only", so an empty/absent body is not a request error here.
    let body: PatrolApplyBody = {};
    try {
      body = await c.req.json<PatrolApplyBody>();
    } catch {
      body = {};
    }
    const job = await applyPatrolJob(castle, jobId, body.approvals ?? [], parseDecisions(body.decisions));
    return c.json(job, 200);
  });
}
