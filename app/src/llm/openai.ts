// OpenAI adapter (plan §4). Uses the Responses API — OpenAI's current
// recommended entrypoint for new integrations (better cache reuse and tool
// support than Chat Completions per OpenAI's own migration guidance) —
// rather than `chat.completions.create`. Structured output via
// `text: { format: { type: 'json_schema', name, schema, strict: true } }`,
// verified against the installed `openai` SDK type defs
// (resources/responses/responses.d.ts: ResponseTextConfig.format /
// ResponseFormatTextJSONSchemaConfig). `response.output_text` is the SDK's
// convenience getter for the concatenated output text.
//
// verifyKey uses `models.list()` — a metadata call, not a generation call.

import OpenAI from 'openai';
import { InvalidApiKeyError } from '../server/llm-seam.js';
import type { JudgeTask, LlmService } from '../server/llm-seam.js';
import { judgeWithRetry } from './judge-helpers.js';

export interface OpenAiClientLike {
  responses: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create(params: any): Promise<any>;
  };
  models: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    list(): Promise<any>;
  };
}

export interface OpenAiServiceConfig {
  apiKey: string;
  model: string;
}

// Fixed schema name: JudgeTask carries no task identifier, and OpenAI only
// uses this for its schema-compilation cache — it does not need to vary.
const SCHEMA_NAME = 'memorycastle_judgment';

function isUnauthorized(err: unknown): boolean {
  const status = (err as { status?: number } | undefined)?.status;
  return status === 401 || status === 403;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText(response: any): string {
  const text = response.output_text;
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('openai response had no output_text');
  }
  return text;
}

export function createOpenAiService(config: OpenAiServiceConfig, clientOverride?: OpenAiClientLike): LlmService {
  const client: OpenAiClientLike = clientOverride ?? new OpenAI({ apiKey: config.apiKey });

  return {
    async verifyKey(): Promise<void> {
      try {
        await client.models.list();
      } catch (err) {
        if (isUnauthorized(err)) throw new InvalidApiKeyError('openai');
        throw err;
      }
    },

    async judge<T>(task: JudgeTask<T>): Promise<T> {
      const buildParams = (input: string) => ({
        model: config.model,
        instructions: task.system,
        input,
        max_output_tokens: task.maxTokens,
        text: {
          format: {
            type: 'json_schema' as const,
            name: SCHEMA_NAME,
            schema: task.schema,
            strict: true,
          },
        },
      });

      const callOnce = async () => {
        try {
          const response = await client.responses.create(buildParams(task.user));
          return extractText(response);
        } catch (err) {
          if (isUnauthorized(err)) throw new InvalidApiKeyError('openai');
          throw err;
        }
      };

      const callRetry = async (previousRawOutput: string, validationError: string) => {
        const retryInput = `${task.user}\n\n--- Your previous output ---\n${previousRawOutput}\n--- End previous output ---\nThat output failed JSON schema validation: ${validationError}\nReturn corrected JSON that matches the schema exactly, with no extra commentary.`;
        try {
          const response = await client.responses.create(buildParams(retryInput));
          return extractText(response);
        } catch (err) {
          if (isUnauthorized(err)) throw new InvalidApiKeyError('openai');
          throw err;
        }
      };

      return judgeWithRetry<T>(task.schema, callOnce, callRetry);
    },
  };
}
