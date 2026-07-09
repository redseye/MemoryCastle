// Deterministic pre-pass of the consolidation patrol (flows/patrolFlow.ts):
// budgets, staleness, and route-gap detection all run without any LLM, and
// must produce a valid job (warnings populated, zero proposals) even when
// the LlmService is the NotConfiguredLlmService seam default.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initCastle, openCastle } from '../src/core/index.js';
import { LlmNotConfiguredError, NotConfiguredLlmService } from '../src/server/llm-seam.js';
import type { LlmService } from '../src/server/llm-seam.js';
import { runPatrol } from '../src/flows/patrolFlow.js';
import { cleanupTempDir, makeTempDir } from './helpers.js';

describe('patrol deterministic pre-pass (warnings)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
    await initCastle(dir);
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('runs with a NotConfiguredLlmService: succeeds, warnings populated (possibly empty), zero proposals', async () => {
    const castle = await openCastle(dir);
    const job = await runPatrol(castle, new NotConfiguredLlmService());

    expect(job.status).toBe('proposed');
    expect(job.proposals).toEqual([]);
    expect(Array.isArray(job.warnings)).toBe(true);
    // A freshly-init'd castle has nothing over budget, nothing stale, and
    // the default patrol route's all-rooms stop covers every (zero) room.
    expect(job.warnings).toEqual([]);
  });

  it('flags keep/chronicle/room over-budget', async () => {
    const castle = await openCastle(dir);
    for (let i = 0; i < 31; i++) {
      await castle.keep.append('core', { confidence: 'high', source: 'user', fact: `k${i}` });
    }
    for (let i = 0; i < 20; i++) {
      await castle.chronicle.append({ confidence: 'high', source: 'user', fact: `c${i}` });
    }
    const room = await castle.rooms.append({ name: 'Big Room' });
    for (let i = 0; i < 121; i++) {
      await castle.rooms.appendRecord(room.slug, { confidence: 'high', source: 'user', fact: `r${i}` });
    }

    const job = await runPatrol(castle, new NotConfiguredLlmService());
    const overBudgetTargets = job.warnings.filter((w) => w.kind === 'over-budget').map((w) => w.target);

    expect(overBudgetTargets).toContain('keep');
    expect(overBudgetTargets).toContain('chronicle');
    expect(overBudgetTargets).toContain(`room:${room.slug}`);
  });

  it('flags stale keep and room records (older than the 90-day staleness threshold)', async () => {
    const castle = await openCastle(dir);
    await castle.keep.append('core', { date: '2020-01-01', confidence: 'high', source: 'user', fact: '很舊的 keep 事實' });
    const room = await castle.rooms.append({ name: 'Room' });
    await castle.rooms.appendRecord(room.slug, {
      date: '2020-01-01',
      confidence: 'high',
      source: 'user',
      fact: '房間裡很舊的事實',
    });

    const job = await runPatrol(castle, new NotConfiguredLlmService());
    const staleTargets = job.warnings.filter((w) => w.kind === 'stale').map((w) => w.target);

    expect(staleTargets.some((t) => t.startsWith('keep:'))).toBe(true);
    expect(staleTargets.some((t) => t.startsWith(`room:${room.slug}:`))).toBe(true);
  });

  // Regression (found by M5's UI verification): the real server wires in
  // createDynamicLlmService(), a plain object literal that is never
  // `instanceof NotConfiguredLlmService` — with no key it throws
  // LlmNotConfiguredError from inside judge() once buildProposals runs
  // (≥2 chronicle entries). That must degrade to zero proposals, not fail
  // the whole patrol job.
  it('degrades to zero proposals when a dynamic-style service throws LlmNotConfiguredError mid-run', async () => {
    const castle = await openCastle(dir);
    await castle.chronicle.append({ confidence: 'high', source: 'user', fact: '第一條記錄' });
    await castle.chronicle.append({ confidence: 'high', source: 'user', fact: '第二條記錄' });

    const dynamicUnconfigured: LlmService = {
      async verifyKey() {
        throw new LlmNotConfiguredError();
      },
      async judge() {
        throw new LlmNotConfiguredError();
      },
    };

    const job = await runPatrol(castle, dynamicUnconfigured);
    expect(job.status).toBe('proposed');
    expect(job.proposals).toEqual([]);
    expect(Array.isArray(job.warnings)).toBe(true);
  });

  it('flags an orphaned room and a route stop referencing a nonexistent room', async () => {
    const castle = await openCastle(dir);
    // Strip the default patrol route's all-rooms coverage so a room becomes orphaned.
    await castle.routes.update('patrol', { stops: [{ target: 'chronicle', read: 'all' }] });
    const orphan = await castle.rooms.append({ name: 'Orphan Room' });
    await castle.routes.append({
      name: 'broken',
      occasion: 'test route with a dangling reference',
      stops: [{ target: 'room:does-not-exist', read: 'all' }],
    });

    const job = await runPatrol(castle, new NotConfiguredLlmService());
    const gaps = job.warnings.filter((w) => w.kind === 'route-gap');

    expect(gaps.some((w) => w.target === orphan.slug)).toBe(true);
    expect(gaps.some((w) => w.target === 'broken -> room:does-not-exist')).toBe(true);
  });
});
