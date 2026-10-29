// Shared "parse + validate + retry once" logic (plan §4) so the three
// provider adapters only have to supply their own request/response shape,
// not reimplement the retry policy three times.

import { LlmBadOutputError } from '../server/llm-seam.js';
import { validateAgainstSchema } from './schemas.js';

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

// Adapters without block-level cache markers (OpenAI, Gemini, CLI) fold the
// shared context in front of the system prompt — first, so an automatic
// prefix cache still sees the same leading text on every call of a flow.
export function systemWithContext(task: { system: string; context?: string }): string {
  return task.context ? `${task.context}\n\n${task.system}` : task.system;
}

function tryParseAndValidate<T>(rawText: string, schema: unknown): ParseResult<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return { ok: false, error: `output is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const result = validateAgainstSchema(schema, parsed);
  if (!result.valid) return { ok: false, error: result.errors.join('; ') };
  return { ok: true, value: parsed as T };
}

// callOnce/callRetry return the raw text the provider produced (already
// extracted from whatever response envelope that SDK uses). On a validation
// failure, callRetry is invoked exactly once with the original output and the
// validation error appended, then the result is validated again; a second
// failure throws LlmBadOutputError.
export async function judgeWithRetry<T>(
  schema: unknown,
  callOnce: () => Promise<string>,
  callRetry: (previousRawOutput: string, validationError: string) => Promise<string>,
): Promise<T> {
  const firstText = await callOnce();
  const first = tryParseAndValidate<T>(firstText, schema);
  if (first.ok) return first.value;

  const secondText = await callRetry(firstText, first.error);
  const second = tryParseAndValidate<T>(secondText, schema);
  if (second.ok) return second.value;

  throw new LlmBadOutputError(second.error);
}
