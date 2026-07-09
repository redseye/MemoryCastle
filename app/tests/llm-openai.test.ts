// Contract tests for the OpenAI adapter (plan §4 M4). Intercepts the SDK at
// its lowest seam — a fake client matching OpenAiClientLike. Uses the
// Responses API shape (instructions/input/text.format), not Chat
// Completions.

import { describe, expect, it, vi } from 'vitest';
import { createOpenAiService, type OpenAiClientLike } from '../src/llm/openai.js';
import { InvalidApiKeyError, LlmBadOutputError } from '../src/server/llm-seam.js';

const SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
} as const;

describe('openai adapter', () => {
  it('sends model/instructions/input/text.format(json_schema, strict) via responses.create and parses output_text', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: '{"ok":true}' });
    const client: OpenAiClientLike = { responses: { create }, models: { list: vi.fn() } };
    const service = createOpenAiService({ apiKey: 'sk-test', model: 'gpt-5.4-mini' }, client);

    const result = await service.judge<{ ok: boolean }>({ system: 'sys', user: 'usr', schema: SCHEMA, maxTokens: 300 });

    expect(result).toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.model).toBe('gpt-5.4-mini');
    expect(params.instructions).toBe('sys');
    expect(params.input).toBe('usr');
    expect(params.max_output_tokens).toBe(300);
    expect(params.text.format.type).toBe('json_schema');
    expect(params.text.format.schema).toEqual(SCHEMA);
    expect(params.text.format.strict).toBe(true);
    expect(typeof params.text.format.name).toBe('string');
  });

  it('retries once with the validation error appended, then succeeds', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ output_text: '{"ok":"nope"}' })
      .mockResolvedValueOnce({ output_text: '{"ok":true}' });
    const client: OpenAiClientLike = { responses: { create }, models: { list: vi.fn() } };
    const service = createOpenAiService({ apiKey: 'sk-test', model: 'gpt-5.4-mini' }, client);

    const result = await service.judge<{ ok: boolean }>({ system: 'sys', user: 'usr', schema: SCHEMA });

    expect(result).toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(2);
    const retryParams = create.mock.calls[1][0];
    expect(retryParams.input).toContain('expected boolean');
    expect(retryParams.input).toContain('usr');
  });

  it('throws LlmBadOutputError when the retry also fails validation', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: 'not json' });
    const client: OpenAiClientLike = { responses: { create }, models: { list: vi.fn() } };
    const service = createOpenAiService({ apiKey: 'sk-test', model: 'gpt-5.4-mini' }, client);

    await expect(service.judge({ system: 'sys', user: 'usr', schema: SCHEMA })).rejects.toThrow(LlmBadOutputError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('maps a 401 from responses.create to InvalidApiKeyError', async () => {
    const create = vi.fn().mockRejectedValue({ status: 401, message: 'Incorrect API key provided' });
    const client: OpenAiClientLike = { responses: { create }, models: { list: vi.fn() } };
    const service = createOpenAiService({ apiKey: 'bad', model: 'gpt-5.4-mini' }, client);

    await expect(service.judge({ system: 'sys', user: 'usr', schema: SCHEMA })).rejects.toThrow(InvalidApiKeyError);
  });

  it('verifyKey calls models.list and maps a 401 to InvalidApiKeyError', async () => {
    const list = vi.fn().mockRejectedValue({ status: 401 });
    const client: OpenAiClientLike = { responses: { create: vi.fn() }, models: { list } };
    const service = createOpenAiService({ apiKey: 'bad', model: 'gpt-5.4-mini' }, client);

    await expect(service.verifyKey()).rejects.toThrow(InvalidApiKeyError);
    expect(list).toHaveBeenCalled();
  });

  it('verifyKey resolves when the key is valid', async () => {
    const list = vi.fn().mockResolvedValue({ data: [] });
    const client: OpenAiClientLike = { responses: { create: vi.fn() }, models: { list } };
    const service = createOpenAiService({ apiKey: 'good', model: 'gpt-5.4-mini' }, client);

    await expect(service.verifyKey()).resolves.toBeUndefined();
  });
});
