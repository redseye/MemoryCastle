// Anthropic adapter (plan §4). Structured output via
// `output_config: { format: { type: 'json_schema', schema } }` on
// `messages.create` — verified against the installed @anthropic-ai/sdk type
// defs (messages.d.ts): OutputConfig.format is JSONOutputFormat
// `{ type: 'json_schema'; schema }`. We call `.create()` rather than
// `.parse()` because `.parse()` only auto-populates `parsed_output` for
// formats built via `zodOutputFormat()`; a raw schema literal still comes
// back as plain text we parse and validate ourselves (judge-helpers.ts).
//
// verifyKey uses `models.list({ limit: 1 })` — a metadata call, not a
// generation call, so verifying a key never costs a completion.

import Anthropic from '@anthropic-ai/sdk';
import { InvalidApiKeyError } from '../server/llm-seam.js';
import type { JudgeTask, LlmService } from '../server/llm-seam.js';
import { DEFAULT_MAX_TOKENS } from './constants.js';
import { judgeWithRetry } from './judge-helpers.js';

// The subset of the SDK client this adapter calls — narrow on purpose so
// contract tests can inject a fake without constructing a real Anthropic
// client or SDK error instances.
export interface AnthropicClientLike {
  messages: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create(params: any): Promise<any>;
  };
  models: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    list(params?: any): Promise<any>;
  };
}

export interface AnthropicServiceConfig {
  apiKey: string;
  model: string;
}

function isUnauthorized(err: unknown): boolean {
  const status = (err as { status?: number } | undefined)?.status;
  return status === 401 || status === 403;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText(response: any): string {
  const block = (response.content ?? []).find((b: { type: string }) => b.type === 'text');
  if (!block || typeof block.text !== 'string') {
    throw new Error('anthropic response had no text content block');
  }
  return block.text;
}

export function createAnthropicService(config: AnthropicServiceConfig, clientOverride?: AnthropicClientLike): LlmService {
  const client: AnthropicClientLike = clientOverride ?? new Anthropic({ apiKey: config.apiKey });

  return {
    async verifyKey(): Promise<void> {
      try {
        await client.models.list({ limit: 1 });
      } catch (err) {
        if (isUnauthorized(err)) throw new InvalidApiKeyError('anthropic');
        throw err;
      }
    },

    async judge<T>(task: JudgeTask<T>): Promise<T> {
      const baseParams = {
        model: config.model,
        max_tokens: task.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: task.system,
        output_config: { format: { type: 'json_schema' as const, schema: task.schema } },
      };

      const callOnce = async () => {
        try {
          const response = await client.messages.create({
            ...baseParams,
            messages: [{ role: 'user', content: task.user }],
          });
          return extractText(response);
        } catch (err) {
          if (isUnauthorized(err)) throw new InvalidApiKeyError('anthropic');
          throw err;
        }
      };

      const callRetry = async (previousRawOutput: string, validationError: string) => {
        try {
          const response = await client.messages.create({
            ...baseParams,
            messages: [
              { role: 'user', content: task.user },
              { role: 'assistant', content: previousRawOutput },
              {
                role: 'user',
                content: `Your previous output failed JSON schema validation: ${validationError}\nReturn corrected JSON that matches the schema exactly, with no extra commentary.`,
              },
            ],
          });
          return extractText(response);
        } catch (err) {
          if (isUnauthorized(err)) throw new InvalidApiKeyError('anthropic');
          throw err;
        }
      };

      return judgeWithRetry<T>(task.schema, callOnce, callRetry);
    },
  };
}
