// Google Gemini adapter (plan §4). Structured output via
// `config: { responseMimeType: 'application/json', responseJsonSchema }` on
// `models.generateContent` — verified against the installed @google/genai
// type defs (node.d.ts GenerationConfig): `responseJsonSchema` accepts a
// standard JSON Schema object directly (the alternative `responseSchema`
// field wants Gemini's own restricted OpenAPI-subset Schema type, which
// would need a converter — responseJsonSchema lets us reuse the same
// literal schema across all three providers).
//
// verifyKey uses `models.get({ model })` — a metadata call, not a
// generation call.

import { GoogleGenAI } from '@google/genai';
import { InvalidApiKeyError } from '../server/llm-seam.js';
import type { JudgeTask, LlmService } from '../server/llm-seam.js';
import { judgeWithRetry, systemWithContext } from './judge-helpers.js';

export interface GeminiClientLike {
  models: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generateContent(params: any): Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(params: any): Promise<any>;
  };
}

export interface GeminiServiceConfig {
  apiKey: string;
  model: string;
}

function isUnauthorized(err: unknown): boolean {
  const status = (err as { status?: number } | undefined)?.status;
  return status === 401 || status === 403;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText(response: any): string {
  const text = response.text;
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('gemini response had no text content');
  }
  return text;
}

export function createGeminiService(config: GeminiServiceConfig, clientOverride?: GeminiClientLike): LlmService {
  const client: GeminiClientLike = clientOverride ?? new GoogleGenAI({ apiKey: config.apiKey });

  return {
    async verifyKey(): Promise<void> {
      try {
        await client.models.get({ model: config.model });
      } catch (err) {
        if (isUnauthorized(err)) throw new InvalidApiKeyError('gemini');
        throw err;
      }
    },

    async judge<T>(task: JudgeTask<T>): Promise<T> {
      const buildConfig = (contents: string) => ({
        model: config.model,
        contents,
        config: {
          systemInstruction: systemWithContext(task),
          responseMimeType: 'application/json',
          responseJsonSchema: task.schema,
          maxOutputTokens: task.maxTokens,
          // Patrol cancel: @google/genai's GenerateContentConfig carries the
          // abort signal here (verified in @google/genai/dist/node/node.d.ts),
          // not as a second call argument like the Anthropic/OpenAI SDKs.
          abortSignal: task.signal,
        },
      });

      const callOnce = async () => {
        try {
          const response = await client.models.generateContent(buildConfig(task.user));
          return extractText(response);
        } catch (err) {
          if (isUnauthorized(err)) throw new InvalidApiKeyError('gemini');
          throw err;
        }
      };

      const callRetry = async (previousRawOutput: string, validationError: string) => {
        const retryContents = `${task.user}\n\n--- Your previous output ---\n${previousRawOutput}\n--- End previous output ---\nThat output failed JSON schema validation: ${validationError}\nReturn corrected JSON that matches the schema exactly, with no extra commentary.`;
        try {
          const response = await client.models.generateContent(buildConfig(retryContents));
          return extractText(response);
        } catch (err) {
          if (isUnauthorized(err)) throw new InvalidApiKeyError('gemini');
          throw err;
        }
      };

      return judgeWithRetry<T>(task.schema, callOnce, callRetry);
    },
  };
}
