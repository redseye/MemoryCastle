// Settings never echo the raw apiKey back: GET and the PUT response both run
// the config through maskApiKey (config/config.ts) before serializing. On
// PUT, an omitted llm.apiKey field means "leave unchanged"; a present field
// (including "") replaces it — the client must round-trip the masked value
// deliberately to clear a key, never by accident.

import type { Hono } from 'hono';
import { maskApiKey, readConfig, writeConfig } from '../../config/index.js';
import type { LlmMode, LlmProviderId } from '../../config/index.js';
import { getCliStatus } from '../../llm/cli.js';
import { HttpError } from '../http-errors.js';
import type { LlmService } from '../llm-seam.js';
import { jsonBody } from '../request.js';

const PROVIDERS: LlmProviderId[] = ['anthropic', 'gemini', 'openai'];
const MODES: LlmMode[] = ['api', 'cli'];

interface SettingsBody {
  port?: number;
  llm?: {
    provider?: string;
    apiKey?: string;
    model?: string;
    mode?: string;
  };
}

export function registerSettingsRoutes(app: Hono, deps: { llmService: LlmService }): void {
  app.get('/settings', async (c) => {
    const config = await readConfig();
    return c.json(maskApiKey(config));
  });

  app.put('/settings', async (c) => {
    const body = await jsonBody<SettingsBody>(c);
    const config = await readConfig();
    const next = { ...config, llm: { ...config.llm } };

    if (typeof body.port === 'number') next.port = body.port;
    if (body.llm) {
      if (body.llm.provider !== undefined) {
        if (!PROVIDERS.includes(body.llm.provider as LlmProviderId)) {
          throw new HttpError(400, 'invalid_body', `未知的 provider：${body.llm.provider}`);
        }
        next.llm.provider = body.llm.provider as LlmProviderId;
      }
      if (body.llm.apiKey !== undefined) next.llm.apiKey = body.llm.apiKey;
      if (body.llm.model !== undefined) next.llm.model = body.llm.model;
      if (body.llm.mode !== undefined) {
        if (!MODES.includes(body.llm.mode as LlmMode)) {
          throw new HttpError(400, 'invalid_body', `未知的 mode：${body.llm.mode}`);
        }
        next.llm.mode = body.llm.mode as LlmMode;
      }
    }

    await writeConfig(next);
    return c.json(maskApiKey(next));
  });

  app.post('/settings/test', async (c) => {
    await deps.llmService.verifyKey();
    return c.json({ ok: true });
  });

  // Detection only (PATH presence + an optional --version read) — never a
  // probe call, so this never costs quota or requires login.
  app.get('/settings/cli-status', async (c) => {
    const status = await getCliStatus();
    return c.json(status);
  });
}
