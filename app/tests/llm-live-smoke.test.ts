// Live smoke test against a real provider (plan §4/M4 checkpoint). Skipped
// by default — set MEMORYCASTLE_LIVE_SMOKE=1 plus MEMORYCASTLE_LIVE_API_KEY
// (and optionally MEMORYCASTLE_LIVE_PROVIDER=anthropic|gemini|openai,
// MEMORYCASTLE_LIVE_MODEL) to run it against a real account. The rest of the
// suite must pass with zero configuration — this file exercises real network
// calls and real cost, so it never runs in CI by default.

import { describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../src/server/index.js';
import { createLlmService } from '../src/llm/factory.js';
import { REMEMBER_SCHEMA } from '../src/llm/schemas.js';
import { rememberPrompt } from '../src/llm/prompts.js';
import type { LlmProviderId } from '../src/config/index.js';
import { cleanupTempDir, makeTempDir } from './helpers.js';

const liveEnabled = process.env.MEMORYCASTLE_LIVE_SMOKE === '1' && !!process.env.MEMORYCASTLE_LIVE_API_KEY;

// M8 CLI-mode live smoke: shells out to a real, locally-installed, logged-in
// CLI — no API key needed, so this is gated on its own env var. Real cost:
// one minimal verifyKey() probe + one real judge() call per enabled provider.
const cliSmokeEnabled = process.env.MEMORYCASTLE_CLI_SMOKE === '1';
const cliProvider = (process.env.MEMORYCASTLE_CLI_PROVIDER as LlmProviderId | undefined) ?? 'anthropic';
const cliModel = process.env.MEMORYCASTLE_CLI_MODEL; // optional — CLI's own default is used when unset

describe.skipIf(!cliSmokeEnabled)('LLM CLI-mode live smoke (real local CLI, env-gated)', () => {
  it('verifyKey() succeeds against the real, already-logged-in CLI', async () => {
    const llmService = createLlmService({ provider: cliProvider, apiKey: '', model: cliModel ?? '', mode: 'cli' });
    await expect(llmService.verifyKey()).resolves.toBeUndefined();
  }, 60_000);

  it('judge() runs a real remember-shaped (gate + distill) call end-to-end through the CLI adapter', async () => {
    const llmService = createLlmService({ provider: cliProvider, apiKey: '', model: cliModel ?? '', mode: 'cli' });
    const { system, user } = rememberPrompt({
      text: 'CI 上 npm ci 前必須先清 node_modules 快取，否則會用到跨平台不相容的 optional dependency 導致建置失敗',
      source: 'user',
      factMaxChars: 200,
      hits: [],
    });

    const result = await llmService.judge<{
      novel: boolean;
      reusable: boolean;
      verifiable: boolean;
      secretRefusal: boolean;
      reason: string;
      fact: string;
    }>({ system, user, schema: REMEMBER_SCHEMA });

    expect(typeof result.novel).toBe('boolean');
    expect(typeof result.reusable).toBe('boolean');
    expect(typeof result.verifiable).toBe('boolean');
    expect(typeof result.secretRefusal).toBe('boolean');
    expect(typeof result.reason).toBe('string');
    expect(typeof result.fact).toBe('string');
    // eslint-disable-next-line no-console
    console.log('CLI-mode live smoke parsed remember result:', JSON.stringify(result));
  }, 60_000);
});

describe.skipIf(!liveEnabled)('LLM live smoke (real provider, env-gated)', () => {
  it('POST /remember: a valid lesson passes the gate (201); a README-obvious fact fails it (422)', async () => {
    const provider = (process.env.MEMORYCASTLE_LIVE_PROVIDER as LlmProviderId | undefined) ?? 'anthropic';
    const apiKey = process.env.MEMORYCASTLE_LIVE_API_KEY!;
    const model =
      process.env.MEMORYCASTLE_LIVE_MODEL ??
      { anthropic: 'claude-sonnet-5', gemini: 'gemini-3.5-flash', openai: 'gpt-5.4-mini' }[provider];

    const llmService = createLlmService({ provider, apiKey, model });
    const app = createApp({ llmService });

    const container = await makeTempDir();
    try {
      const root = join(container, 'live-smoke-project');
      await mkdir(root, { recursive: true });
      const reg = await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root, name: 'Live Smoke' }),
      });
      const regJson = await reg.json();
      const projectId = regJson.project.id;
      if (reg.status === 409) {
        await app.request(`/api/v1/projects/${projectId}/init`, { method: 'POST' });
      }

      const validRes = await app.request(`/api/v1/projects/${projectId}/remember`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'CI 上 npm ci 前必須先清 node_modules 快取，否則會用到跨平台不相容的 optional dependency 導致建置失敗',
          source: 'user',
        }),
      });
      expect(validRes.status).toBe(201);

      const obviousRes = await app.request(`/api/v1/projects/${projectId}/remember`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'This project has a README.md file in its root directory.' }),
      });
      expect(obviousRes.status).toBe(422);
      const obviousJson = await obviousRes.json();
      expect(Array.isArray(obviousJson.failedTests)).toBe(true);
    } finally {
      await cleanupTempDir(container);
    }
  }, 60_000);
});
