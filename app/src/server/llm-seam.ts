// M4 seam (plan §4/§5): every LLM-dependent route calls into an LlmService
// instead of a concrete provider. LlmService mirrors the planned LlmProvider
// adapter shape (judge + verifyKey) so M4 only has to supply a real,
// provider-backed implementation of this same interface — no route in M3
// needs to change shape when that lands.
//
// The default NotConfiguredLlmService is what createApp() wires in until a
// real implementation is injected; every method throws LlmNotConfiguredError,
// which app.ts's onError maps to 409 { error: { code: "llm_not_configured" } }.

export interface JudgeTask<T> {
  system: string;
  user: string;
  schema: unknown; // JSON schema literal, shared verbatim with the provider call
  maxTokens?: number;
  // v0.5: a stable block several calls of one flow share verbatim (the
  // patrol's castle map: keep + room directory). Adapters send it FIRST,
  // ahead of `system`, so a provider-side prefix cache can reuse it across
  // those calls; the Anthropic adapter marks it with cache_control.
  context?: string;
  // Patrol cancel (M-cancel): when set, a provider adapter that supports
  // request-level cancellation aborts the in-flight call. Optional so every
  // existing caller (rememberFlow, etc.) is unaffected.
  signal?: AbortSignal;
}

export interface LlmService {
  verifyKey(): Promise<void>;
  judge<T>(task: JudgeTask<T>): Promise<T>;
}

export class LlmNotConfiguredError extends Error {
  // M8: CLI mode reuses this same error family for "binary missing" /
  // "not logged in" (see src/llm/cli.ts) with a more specific message; the
  // default stays the original API-mode message so every existing call site
  // (`new LlmNotConfiguredError()`) is unaffected.
  constructor(message = '尚未設定 LLM：請先於設定填入 provider 與 API key。') {
    super(message);
    this.name = 'LlmNotConfiguredError';
  }
}

// Thrown by a provider adapter (M4) when the configured API key is rejected
// by the provider (401/403). Never includes the key itself in the message.
export class InvalidApiKeyError extends Error {
  constructor(provider: string) {
    super(`${provider} 拒絕了目前設定的 API key，請至設定重新確認。`);
    this.name = 'InvalidApiKeyError';
  }
}

// Thrown when a provider's structured-output response still fails schema
// validation after the one allowed retry (plan §4).
export class LlmBadOutputError extends Error {
  constructor(detail: string) {
    super(`LLM 回傳的內容未通過 schema 驗證（已重試一次）：${detail}`);
    this.name = 'LlmBadOutputError';
  }
}

export class NotConfiguredLlmService implements LlmService {
  async verifyKey(): Promise<void> {
    throw new LlmNotConfiguredError();
  }

  async judge<T>(): Promise<T> {
    throw new LlmNotConfiguredError();
  }
}

// Uniform guard used by every LLM-dependent route before doing anything else.
export async function ensureLlmConfigured(service: LlmService): Promise<void> {
  await service.verifyKey();
}
