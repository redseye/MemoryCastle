// End-to-end coverage for the M4 flows (rememberFlow / patrolFlow) driven
// through the real HTTP routes with a stubbed LlmService injected via
// createApp({ llmService }) — no network call, no provider adapter involved.
// This is the seam plan §5 designed for: routes/flows don't change shape
// whether the seam is a stub or a real provider.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { createApp } from '../src/server/index.js';
import type { JudgeTask, LlmService } from '../src/server/llm-seam.js';
import {
  CLUSTER_ENTRIES_SCHEMA,
  CONTRADICTION_CHECK_SCHEMA,
  DISTILL_CLUSTER_SCHEMA,
  DISTILL_SCHEMA,
  GATE_DECISION_SCHEMA,
  KEEP_PROMOTION_SCHEMA,
  ROOM_PROPOSAL_SCHEMA,
} from '../src/llm/schemas.js';
import { cleanupTempDir, makeTempDir } from './helpers.js';

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

interface GateDecisionStub {
  novel: boolean;
  reusable: boolean;
  verifiable: boolean;
  secretRefusal: boolean;
  reason: string;
}

function makeRememberStub(gateDecision?: Partial<GateDecisionStub>): LlmService {
  const decision: GateDecisionStub = {
    novel: true,
    reusable: true,
    verifiable: true,
    secretRefusal: false,
    reason: '通過城門',
    ...gateDecision,
  };
  return {
    async verifyKey() {},
    async judge<T>(task: JudgeTask<T>): Promise<T> {
      if (task.schema === GATE_DECISION_SCHEMA) return decision as unknown as T;
      if (task.schema === DISTILL_SCHEMA) return { fact: '測試教訓', confidence: 'high', tags: ['test'] } as unknown as T;
      throw new Error(`unexpected schema in remember stub: ${JSON.stringify(task.schema)}`);
    },
  };
}

describe('LLM flows e2e (stubbed LlmService)', () => {
  let container: string;
  const originalConfigEnv = process.env.MEMORYCASTLE_CONFIG;

  beforeEach(async () => {
    container = await makeTempDir();
    process.env.MEMORYCASTLE_CONFIG = join(container, 'config.json');
  });

  afterEach(async () => {
    await cleanupTempDir(container);
    if (originalConfigEnv === undefined) delete process.env.MEMORYCASTLE_CONFIG;
    else process.env.MEMORYCASTLE_CONFIG = originalConfigEnv;
  });

  describe('remember', () => {
    it('a valid lesson passes the gate, distills, and appends a chronicle record (201)', async () => {
      const app = createApp({ llmService: makeRememberStub() });
      const projectId = await registerAndInit(app, join(container, 'remember-pass'), 'Remember Pass');

      const res = await req(app, 'POST', `/projects/${projectId}/remember`, {
        text: 'build 前必須先跑 codegen，否則會拿到舊型別',
        source: 'user',
      });

      expect(res.status).toBe(201);
      expect(res.json.fact).toBe('測試教訓');
      expect(res.json.confidence).toBe('high');
      expect(res.json.tags).toEqual(['test']);

      const list = await req(app, 'GET', `/projects/${projectId}/chronicle`);
      expect(list.json.entries).toHaveLength(1);
      expect(list.json.entries[0].id).toBe(res.json.id);
    });

    it('a README-derivable fact fails novelty and returns 422 with failedTests + reason', async () => {
      const app = createApp({
        llmService: makeRememberStub({ novel: false, reason: 'README 第一行就寫了，不通過 novel 測試' }),
      });
      const projectId = await registerAndInit(app, join(container, 'remember-fail'), 'Remember Fail');

      const res = await req(app, 'POST', `/projects/${projectId}/remember`, {
        text: 'README 第一行就查得到的事實',
      });

      expect(res.status).toBe(422);
      expect(res.json.failedTests).toEqual(['novel']);
      expect(res.json.reason).toBe('README 第一行就寫了，不通過 novel 測試');

      const list = await req(app, 'GET', `/projects/${projectId}/chronicle`);
      expect(list.json.entries).toHaveLength(0);
    });

    it('dryRun:true reports the passing decision without writing a record', async () => {
      const app = createApp({ llmService: makeRememberStub() });
      const projectId = await registerAndInit(app, join(container, 'remember-dry'), 'Remember Dry');

      const res = await req(app, 'POST', `/projects/${projectId}/remember`, { text: '任何文字', dryRun: true });

      expect(res.status).toBe(200);
      expect(res.json).toEqual({ passed: true, dryRun: true });

      const list = await req(app, 'GET', `/projects/${projectId}/chronicle`);
      expect(list.json.entries).toHaveLength(0);
    });
  });

  describe('patrol', () => {
    it('propose builds green + yellow proposals; apply executes green + only the approved yellow', async () => {
      const state = { roomSlug: '', entryAId: '', entryBId: '', entryCId: '', keepLoserId: '', keepWinnerId: '' };

      const stub: LlmService = {
        async verifyKey() {},
        async judge<T>(task: JudgeTask<T>): Promise<T> {
          if (task.schema === CLUSTER_ENTRIES_SCHEMA) {
            return {
              clusters: [{ entryIds: [state.entryAId, state.entryBId], locus: 'src/**', topic: 'src 相關' }],
            } as unknown as T;
          }
          if (task.schema === DISTILL_CLUSTER_SCHEMA) {
            return { records: [{ fact: '整併後的 src 事實', confidence: 'med', tags: [] }] } as unknown as T;
          }
          if (task.schema === ROOM_PROPOSAL_SCHEMA) {
            return { targetRoomSlug: state.roomSlug, name: '', locus: [], adjacent: [], reason: '符合既有房間' } as unknown as T;
          }
          if (task.schema === CONTRADICTION_CHECK_SCHEMA) {
            return {
              contradictions: [{ loserId: state.keepLoserId, winnerId: state.keepWinnerId, reason: '較新版本正確' }],
            } as unknown as T;
          }
          if (task.schema === KEEP_PROMOTION_SCHEMA) {
            return { promotions: [{ recordId: state.entryCId, section: 'core', reason: '常用事實' }] } as unknown as T;
          }
          throw new Error(`unexpected schema in patrol stub: ${JSON.stringify(task.schema)}`);
        },
      };

      const app = createApp({ llmService: stub });
      const projectId = await registerAndInit(app, join(container, 'patrol-project'), 'Patrol Test');

      const roomRes = await req(app, 'POST', `/projects/${projectId}/rooms`, { name: 'Src Room', locus: ['src/**'] });
      state.roomSlug = roomRes.json.slug;

      const keepLoser = await req(app, 'POST', `/projects/${projectId}/keep/records`, {
        section: 'core',
        confirm: true,
        confidence: 'low',
        source: 'agent',
        fact: '舊版事實（將被取代）',
      });
      const keepWinner = await req(app, 'POST', `/projects/${projectId}/keep/records`, {
        section: 'core',
        confirm: true,
        confidence: 'high',
        source: 'user',
        fact: '新版事實（正確）',
      });
      state.keepLoserId = keepLoser.json.id;
      state.keepWinnerId = keepWinner.json.id;

      const entryA = await req(app, 'POST', `/projects/${projectId}/chronicle/records`, { confidence: 'med', source: 'agent', fact: 'A 事實' });
      const entryB = await req(app, 'POST', `/projects/${projectId}/chronicle/records`, { confidence: 'med', source: 'agent', fact: 'B 事實' });
      const entryC = await req(app, 'POST', `/projects/${projectId}/chronicle/records`, { confidence: 'low', source: 'agent', fact: 'C 事實' });
      state.entryAId = entryA.json.id;
      state.entryBId = entryB.json.id;
      state.entryCId = entryC.json.id;

      const patrolRes = await req(app, 'POST', `/projects/${projectId}/patrol`);
      expect(patrolRes.status).toBe(201);
      // POST /patrol returns the full job (not just an id wrapper) so
      // deterministic warnings are visible even without a follow-up GET.
      const jobId = patrolRes.json.id;
      expect(typeof jobId).toBe('string');
      expect(Array.isArray(patrolRes.json.warnings)).toBe(true);

      const jobRes = await req(app, 'GET', `/projects/${projectId}/patrol/jobs/${jobId}`);
      expect(jobRes.status).toBe(200);
      expect(jobRes.json.status).toBe('proposed');

      interface Proposal { id: string; kind: string; tier: string }
      const proposals: Proposal[] = jobRes.json.proposals;
      const greenProposal = proposals.find((p) => p.tier === 'green');
      const contradictionProposal = proposals.find((p) => p.kind === 'contradiction');
      const keepPromotionProposal = proposals.find((p) => p.kind === 'keepPromotion');

      expect(greenProposal?.kind).toBe('roomRecord');
      expect(contradictionProposal?.tier).toBe('yellow');
      expect(keepPromotionProposal?.tier).toBe('yellow');

      // Approve only the contradiction proposal — keepPromotion stays unapproved.
      const applyRes = await req(app, 'POST', `/projects/${projectId}/patrol/jobs/${jobId}/apply`, {
        approvals: [contradictionProposal!.id],
      });
      expect(applyRes.status).toBe(200);
      expect(applyRes.json.status).toBe('applied');
      const report = applyRes.json.applyReport as { appliedIds: string[]; skippedYellowIds: string[] };
      expect(report.appliedIds).toEqual(expect.arrayContaining([greenProposal!.id, contradictionProposal!.id]));
      expect(report.appliedIds).not.toContain(keepPromotionProposal!.id);
      expect(report.skippedYellowIds).toEqual([keepPromotionProposal!.id]);

      // Green roomRecord applied: room got the distilled record, A/B swept.
      const roomAfter = await req(app, 'GET', `/projects/${projectId}/rooms/${state.roomSlug}`);
      expect(roomAfter.json.records).toHaveLength(1);
      expect(roomAfter.json.records[0].fact).toBe('整併後的 src 事實');

      const chronicleAfter = await req(app, 'GET', `/projects/${projectId}/chronicle`);
      // Only C remains — it was never clustered, and its keepPromotion was
      // never approved, so it stays in chronicle untouched.
      expect(chronicleAfter.json.entries.map((e: { id: string }) => e.id)).toEqual([state.entryCId]);

      // Approved yellow (contradiction) applied: loser superseded, winner kept.
      const keepAfter = await req(app, 'GET', `/projects/${projectId}/keep`);
      const coreIds: string[] = keepAfter.json.sections.core.map((r: { id: string }) => r.id);
      expect(coreIds).toContain(state.keepWinnerId);
      expect(coreIds).not.toContain(state.keepLoserId);
      // Unapproved yellow (keepPromotion) never executed: keep gained no new fact.
      expect(coreIds).toHaveLength(1);
    });

    it('a cluster distilled into 2 records adds 2 separate room records and sweeps both entries', async () => {
      const state = { roomSlug: '', entryAId: '', entryBId: '' };

      const stub: LlmService = {
        async verifyKey() {},
        async judge<T>(task: JudgeTask<T>): Promise<T> {
          if (task.schema === CLUSTER_ENTRIES_SCHEMA) {
            return {
              clusters: [{ entryIds: [state.entryAId, state.entryBId], locus: 'src/**', topic: 'src 相關' }],
            } as unknown as T;
          }
          if (task.schema === DISTILL_CLUSTER_SCHEMA) {
            return {
              records: [
                { fact: '事實一', confidence: 'high', tags: [] },
                { fact: '事實二', confidence: 'med', tags: [] },
              ],
            } as unknown as T;
          }
          if (task.schema === ROOM_PROPOSAL_SCHEMA) {
            return { targetRoomSlug: state.roomSlug, name: '', locus: [], adjacent: [], reason: '符合既有房間' } as unknown as T;
          }
          if (task.schema === CONTRADICTION_CHECK_SCHEMA) {
            return { contradictions: [] } as unknown as T;
          }
          if (task.schema === KEEP_PROMOTION_SCHEMA) {
            return { promotions: [] } as unknown as T;
          }
          throw new Error(`unexpected schema in multi-record distill stub: ${JSON.stringify(task.schema)}`);
        },
      };

      const app = createApp({ llmService: stub });
      const projectId = await registerAndInit(app, join(container, 'patrol-multi-records'), 'Patrol Multi Records');

      const roomRes = await req(app, 'POST', `/projects/${projectId}/rooms`, { name: 'Src Room', locus: ['src/**'] });
      state.roomSlug = roomRes.json.slug;

      const entryA = await req(app, 'POST', `/projects/${projectId}/chronicle/records`, { confidence: 'med', source: 'agent', fact: 'A 事實' });
      const entryB = await req(app, 'POST', `/projects/${projectId}/chronicle/records`, { confidence: 'med', source: 'agent', fact: 'B 事實' });
      state.entryAId = entryA.json.id;
      state.entryBId = entryB.json.id;

      const patrolRes = await req(app, 'POST', `/projects/${projectId}/patrol`);
      expect(patrolRes.status).toBe(201);
      const jobId = patrolRes.json.id;

      const jobRes = await req(app, 'GET', `/projects/${projectId}/patrol/jobs/${jobId}`);
      interface Proposal { id: string; kind: string; tier: string }
      const proposals: Proposal[] = jobRes.json.proposals;
      const greenProposal = proposals.find((p) => p.kind === 'roomRecord');
      expect(greenProposal?.tier).toBe('green');

      const applyRes = await req(app, 'POST', `/projects/${projectId}/patrol/jobs/${jobId}/apply`, { approvals: [] });
      expect(applyRes.status).toBe(200);

      // 2 distilled records -> 2 separate room records, not 1 fused record.
      const roomAfter = await req(app, 'GET', `/projects/${projectId}/rooms/${state.roomSlug}`);
      expect(roomAfter.json.records).toHaveLength(2);
      expect(roomAfter.json.records.map((r: { fact: string }) => r.fact)).toEqual(['事實一', '事實二']);

      // Both cluster entries swept out of chronicle in the single sweep call.
      const chronicleAfter = await req(app, 'GET', `/projects/${projectId}/chronicle`);
      expect(chronicleAfter.json.entries).toHaveLength(0);
    });
  });
});
