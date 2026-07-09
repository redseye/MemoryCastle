// config -> LlmService (plan §4). Missing key preserves the M3
// NotConfiguredLlmService fallback (409 llm_not_configured) with no code
// changes needed elsewhere.

import { readConfig } from '../config/index.js';
import type { LlmConfig } from '../config/index.js';
import { NotConfiguredLlmService } from '../server/llm-seam.js';
import type { JudgeTask, LlmService } from '../server/llm-seam.js';
import { createAnthropicService } from './anthropic.js';
import { createCliService } from './cli.js';
import { createGeminiService } from './gemini.js';
import { createOpenAiService } from './openai.js';

export function createLlmService(llmConfig: LlmConfig): LlmService {
  // M8: CLI mode shells out to a local CLI instead of calling an HTTP API —
  // no apiKey needed. mode is absent on every config written before M8, so
  // this branch is only ever taken when a user explicitly opts in.
  if (llmConfig.mode === 'cli') return createCliService(llmConfig);

  if (!llmConfig.apiKey) return new NotConfiguredLlmService();

  switch (llmConfig.provider) {
    case 'anthropic':
      return createAnthropicService({ apiKey: llmConfig.apiKey, model: llmConfig.model });
    case 'gemini':
      return createGeminiService({ apiKey: llmConfig.apiKey, model: llmConfig.model });
    case 'openai':
      return createOpenAiService({ apiKey: llmConfig.apiKey, model: llmConfig.model });
    default:
      return new NotConfiguredLlmService();
  }
}

// A settings change made through the running Web UI (PUT /settings) must
// take effect on the next call without a server restart, so this wrapper
// re-reads config.json and rebuilds the concrete service per call instead of
// capturing one at server-start time. The rebuild cost (constructing an SDK
// client) is negligible for a local, low-traffic tool.
export function createDynamicLlmService(): LlmService {
  return {
    async verifyKey(): Promise<void> {
      const config = await readConfig();
      return createLlmService(config.llm).verifyKey();
    },
    async judge<T>(task: JudgeTask<T>): Promise<T> {
      const config = await readConfig();
      return createLlmService(config.llm).judge<T>(task);
    },
  };
}
