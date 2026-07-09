// Contract tests for the Gemini adapter (plan §4 M4). Intercepts the SDK at
// its lowest seam — a fake client matching GeminiClientLike.

import { describe, expect, it, vi } from 'vitest';
import { createGeminiService, type GeminiClientLike } from '../src/llm/gemini.js';
import { InvalidApiKeyError, LlmBadOutputError } from '../src/server/llm-seam.js';

const SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
} as const;

describe('gemini adapter', () => {
  it('sends model/contents/config.responseMimeType/responseJsonSchema/systemInstruction and parses .text', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '{"ok":true}' });
    const client: GeminiClientLike = { models: { generateContent, get: vi.fn() } };
    const service = createGeminiService({ apiKey: 'g-key', model: 'gemini-3.5-flash' }, client);

    const result = await service.judge<{ ok: boolean }>({ system: 'sys', user: 'usr', schema: SCHEMA, maxTokens: 256 });

    expect(result).toEqual({ ok: true });
    expect(generateContent).toHaveBeenCalledTimes(1);
    const params = generateContent.mock.calls[0][0];
    expect(params.model).toBe('gemini-3.5-flash');
    expect(params.contents).toBe('usr');
    expect(params.config.systemInstruction).toBe('sys');
    expect(params.config.responseMimeType).toBe('application/json');
    expect(params.config.responseJsonSchema).toEqual(SCHEMA);
    expect(params.config.maxOutputTokens).toBe(256);
  });

  it('retries once with the validation error appended, then succeeds', async () => {
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce({ text: '{"ok":123}' })
      .mockResolvedValueOnce({ text: '{"ok":true}' });
    const client: GeminiClientLike = { models: { generateContent, get: vi.fn() } };
    const service = createGeminiService({ apiKey: 'g-key', model: 'gemini-3.5-flash' }, client);

    const result = await service.judge<{ ok: boolean }>({ system: 'sys', user: 'usr', schema: SCHEMA });

    expect(result).toEqual({ ok: true });
    expect(generateContent).toHaveBeenCalledTimes(2);
    const retryParams = generateContent.mock.calls[1][0];
    expect(retryParams.contents).toContain('expected boolean');
    expect(retryParams.contents).toContain('usr');
  });

  it('throws LlmBadOutputError when the retry also fails validation', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: 'not json' });
    const client: GeminiClientLike = { models: { generateContent, get: vi.fn() } };
    const service = createGeminiService({ apiKey: 'g-key', model: 'gemini-3.5-flash' }, client);

    await expect(service.judge({ system: 'sys', user: 'usr', schema: SCHEMA })).rejects.toThrow(LlmBadOutputError);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('maps a 401 from generateContent to InvalidApiKeyError', async () => {
    const generateContent = vi.fn().mockRejectedValue({ status: 401, message: 'API key not valid' });
    const client: GeminiClientLike = { models: { generateContent, get: vi.fn() } };
    const service = createGeminiService({ apiKey: 'bad', model: 'gemini-3.5-flash' }, client);

    await expect(service.judge({ system: 'sys', user: 'usr', schema: SCHEMA })).rejects.toThrow(InvalidApiKeyError);
  });

  it('verifyKey calls models.get and maps a 403 to InvalidApiKeyError', async () => {
    const get = vi.fn().mockRejectedValue({ status: 403 });
    const client: GeminiClientLike = { models: { generateContent: vi.fn(), get } };
    const service = createGeminiService({ apiKey: 'bad', model: 'gemini-3.5-flash' }, client);

    await expect(service.verifyKey()).rejects.toThrow(InvalidApiKeyError);
    expect(get).toHaveBeenCalledWith({ model: 'gemini-3.5-flash' });
  });

  it('verifyKey resolves when the key is valid', async () => {
    const get = vi.fn().mockResolvedValue({ name: 'models/gemini-3.5-flash' });
    const client: GeminiClientLike = { models: { generateContent: vi.fn(), get } };
    const service = createGeminiService({ apiKey: 'good', model: 'gemini-3.5-flash' }, client);

    await expect(service.verifyKey()).resolves.toBeUndefined();
  });
});
