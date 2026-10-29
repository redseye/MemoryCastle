// Contract tests for the Anthropic adapter (plan §4 M4). Intercepts the SDK
// at its lowest seam — a fake client matching AnthropicClientLike — so no
// network call or real API key is needed.

import { describe, expect, it, vi } from 'vitest';
import { createAnthropicService, type AnthropicClientLike } from '../src/llm/anthropic.js';
import { InvalidApiKeyError, LlmBadOutputError } from '../src/server/llm-seam.js';

const SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
} as const;

function textResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

describe('anthropic adapter', () => {
  it('sends model/max_tokens/system/messages/output_config.format and parses the returned JSON', async () => {
    const create = vi.fn().mockResolvedValue(textResponse('{"ok":true}'));
    const client: AnthropicClientLike = { messages: { create }, models: { list: vi.fn() } };
    const service = createAnthropicService({ apiKey: 'sk-test', model: 'claude-sonnet-5' }, client);

    const result = await service.judge<{ ok: boolean }>({ system: 'sys', user: 'usr', schema: SCHEMA, maxTokens: 512 });

    expect(result).toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.max_tokens).toBe(512);
    expect(params.system).toBe('sys');
    expect(params.messages).toEqual([{ role: 'user', content: 'usr' }]);
    expect(params.output_config).toEqual({ format: { type: 'json_schema', schema: SCHEMA } });
  });

  it('a shared context goes first in system as its own block, marked cache_control ephemeral (v0.5)', async () => {
    const create = vi.fn().mockResolvedValue(textResponse('{"ok":true}'));
    const client: AnthropicClientLike = { messages: { create }, models: { list: vi.fn() } };
    const service = createAnthropicService({ apiKey: 'sk-test', model: 'claude-sonnet-5' }, client);

    await service.judge<{ ok: boolean }>({ context: 'castle map', system: 'sys', user: 'usr', schema: SCHEMA });

    const params = create.mock.calls[0][0];
    expect(params.system).toEqual([
      { type: 'text', text: 'castle map', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'sys' },
    ]);
    expect(params.messages).toEqual([{ role: 'user', content: 'usr' }]);
  });

  it('retries once with the validation error appended, then succeeds', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(textResponse('{"ok":"not-a-boolean"}'))
      .mockResolvedValueOnce(textResponse('{"ok":true}'));
    const client: AnthropicClientLike = { messages: { create }, models: { list: vi.fn() } };
    const service = createAnthropicService({ apiKey: 'sk-test', model: 'claude-sonnet-5' }, client);

    const result = await service.judge<{ ok: boolean }>({ system: 'sys', user: 'usr', schema: SCHEMA });

    expect(result).toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(2);
    const retryParams = create.mock.calls[1][0];
    expect(retryParams.messages).toHaveLength(3);
    expect(retryParams.messages[1]).toEqual({ role: 'assistant', content: '{"ok":"not-a-boolean"}' });
    expect(retryParams.messages[2].role).toBe('user');
    expect(retryParams.messages[2].content).toContain('expected boolean');
  });

  it('throws LlmBadOutputError when the retry also fails validation', async () => {
    const create = vi.fn().mockResolvedValue(textResponse('not json at all'));
    const client: AnthropicClientLike = { messages: { create }, models: { list: vi.fn() } };
    const service = createAnthropicService({ apiKey: 'sk-test', model: 'claude-sonnet-5' }, client);

    await expect(service.judge({ system: 'sys', user: 'usr', schema: SCHEMA })).rejects.toThrow(LlmBadOutputError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('maps a 401 from messages.create to InvalidApiKeyError', async () => {
    const create = vi.fn().mockRejectedValue({ status: 401, message: 'invalid x-api-key' });
    const client: AnthropicClientLike = { messages: { create }, models: { list: vi.fn() } };
    const service = createAnthropicService({ apiKey: 'sk-bad', model: 'claude-sonnet-5' }, client);

    await expect(service.judge({ system: 'sys', user: 'usr', schema: SCHEMA })).rejects.toThrow(InvalidApiKeyError);
  });

  it('verifyKey calls models.list and maps a 401 to InvalidApiKeyError', async () => {
    const list = vi.fn().mockRejectedValue({ status: 401 });
    const client: AnthropicClientLike = { messages: { create: vi.fn() }, models: { list } };
    const service = createAnthropicService({ apiKey: 'sk-bad', model: 'claude-sonnet-5' }, client);

    await expect(service.verifyKey()).rejects.toThrow(InvalidApiKeyError);
    expect(list).toHaveBeenCalledWith({ limit: 1 });
  });

  it('verifyKey resolves when the key is valid', async () => {
    const list = vi.fn().mockResolvedValue({ data: [] });
    const client: AnthropicClientLike = { messages: { create: vi.fn() }, models: { list } };
    const service = createAnthropicService({ apiKey: 'sk-good', model: 'claude-sonnet-5' }, client);

    await expect(service.verifyKey()).resolves.toBeUndefined();
  });
});
