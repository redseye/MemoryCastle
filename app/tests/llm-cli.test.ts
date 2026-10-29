// Unit tests for the CLI-mode adapter (plan M8). Every test injects a fake
// spawn function — no real CLI process is ever started here (see
// tests/llm-live-smoke.test.ts for the real end-to-end run).

import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createCliService, getCliStatus, CliCancelledError, CliInvocationError, CliTimeoutError, type SpawnFn } from '../src/llm/cli.js';
import { LlmNotConfiguredError } from '../src/server/llm-seam.js';

const SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
} as const;

// Deliberately never sets `pid` — killChild() only attempts the real
// Windows taskkill path when a numeric pid is present, and a fake pid could
// coincidentally collide with a real OS process. See cli.ts's killChild().
function makeFakeChild() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  return proc;
}

// Scripts a fixed { stdout, stderr, code } response, emitted asynchronously
// like a real child process would.
function scriptedSpawn(
  results: { stdout?: string; stderr?: string; code?: number }[],
): { spawnFn: SpawnFn; calls: { command: string; args: string[] }[] } {
  const calls: { command: string; args: string[] }[] = [];
  let call = 0;
  const spawnFn: SpawnFn = vi.fn((command: string, args: string[]) => {
    calls.push({ command, args });
    const result = results[Math.min(call, results.length - 1)];
    call += 1;
    const child = makeFakeChild();
    setImmediate(() => {
      if (result.stdout) child.stdout.emit('data', result.stdout);
      if (result.stderr) child.stderr.emit('data', result.stderr);
      child.emit('close', result.code ?? 0);
    });
    return child;
  });
  return { spawnFn, calls };
}

// codex reads its answer from the `-o <file>` path rather than stdout — the
// fake spawn has to actually write that file for the adapter's readFile to
// find anything, so this variant inspects args for `-o` and writes there.
function scriptedCodexSpawn(
  results: { fileContent?: string; stderr?: string; code?: number }[],
): { spawnFn: SpawnFn; calls: { command: string; args: string[] }[] } {
  const calls: { command: string; args: string[] }[] = [];
  let call = 0;
  const spawnFn: SpawnFn = vi.fn((command: string, args: string[]) => {
    calls.push({ command, args });
    const result = results[Math.min(call, results.length - 1)];
    call += 1;
    const child = makeFakeChild();
    setImmediate(async () => {
      const oIndex = args.indexOf('-o');
      const outputFile = oIndex >= 0 ? args[oIndex + 1] : undefined;
      if (outputFile && result.fileContent !== undefined) {
        const fs = await import('node:fs/promises');
        await fs.writeFile(outputFile, result.fileContent, 'utf8');
      }
      if (result.stderr) child.stderr.emit('data', result.stderr);
      child.emit('close', result.code ?? 0);
    });
    return child;
  });
  return { spawnFn, calls };
}

const resolveFound = async (name: string) => `/fake/bin/${name}`;

describe('cli adapter: claude (anthropic)', () => {
  it('parses the --output-format json envelope and returns the schema-matching result', async () => {
    const { spawnFn, calls } = scriptedSpawn([
      { stdout: JSON.stringify({ type: 'result', is_error: false, result: '{"ok":true}' }), code: 0 },
    ]);
    const service = createCliService(
      { provider: 'anthropic', apiKey: '', model: 'claude-sonnet-5', mode: 'cli' },
      { spawnFn, resolveBinaryFn: resolveFound },
    );

    const result = await service.judge<{ ok: boolean }>({ system: 'sys', user: 'usr', schema: SCHEMA });

    expect(result).toEqual({ ok: true });
    expect(calls[0].args).toContain('--output-format');
    expect(calls[0].args).toContain('json');
    expect(calls[0].args).toContain('--model');
    expect(calls[0].args).toContain('claude-sonnet-5');
  });

  it('strips banner noise around the envelope and around the inner result text (first { to last })', async () => {
    const envelope = JSON.stringify({
      type: 'result',
      is_error: false,
      result: 'Sure, here you go:\n```json\n{"ok":true}\n```',
    });
    const { spawnFn } = scriptedSpawn([{ stdout: `Checking for updates...\n${envelope}\ndone`, code: 0 }]);
    const service = createCliService(
      { provider: 'anthropic', apiKey: '', model: 'claude-sonnet-5', mode: 'cli' },
      { spawnFn, resolveBinaryFn: resolveFound },
    );

    const result = await service.judge<{ ok: boolean }>({ system: 'sys', user: 'usr', schema: SCHEMA });
    expect(result).toEqual({ ok: true });
  });

  it('retries once with the validation error appended, then succeeds', async () => {
    const { spawnFn, calls } = scriptedSpawn([
      { stdout: JSON.stringify({ type: 'result', is_error: false, result: '{"ok":"nope"}' }), code: 0 },
      { stdout: JSON.stringify({ type: 'result', is_error: false, result: '{"ok":true}' }), code: 0 },
    ]);
    const service = createCliService(
      { provider: 'anthropic', apiKey: '', model: 'claude-sonnet-5', mode: 'cli' },
      { spawnFn, resolveBinaryFn: resolveFound },
    );

    const result = await service.judge<{ ok: boolean }>({ system: 'sys', user: 'usr', schema: SCHEMA });

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    const retryStdin = calls[1]; // stdin content isn't captured in `calls`, but a second spawn proves the retry fired
    expect(retryStdin).toBeDefined();
  });

  it('throws LlmBadOutputError when the retry also fails validation', async () => {
    const { spawnFn } = scriptedSpawn([
      { stdout: JSON.stringify({ type: 'result', is_error: false, result: 'not json at all' }), code: 0 },
    ]);
    const service = createCliService(
      { provider: 'anthropic', apiKey: '', model: 'claude-sonnet-5', mode: 'cli' },
      { spawnFn, resolveBinaryFn: resolveFound },
    );

    await expect(service.judge({ system: 'sys', user: 'usr', schema: SCHEMA })).rejects.toThrow(/schema 驗證/);
  });

  it('maps a non-zero exit code to CliInvocationError with stderr captured', async () => {
    const { spawnFn } = scriptedSpawn([{ stderr: 'boom: unexpected crash', code: 1 }]);
    const service = createCliService(
      { provider: 'anthropic', apiKey: '', model: 'claude-sonnet-5', mode: 'cli' },
      { spawnFn, resolveBinaryFn: resolveFound },
    );

    const err = await service.judge({ system: 'sys', user: 'usr', schema: SCHEMA }).catch((e) => e);
    expect(err).toBeInstanceOf(CliInvocationError);
    expect(err.message).toContain('boom: unexpected crash');
  });

  it('maps an auth-failure exit to LlmNotConfiguredError with a distinct message', async () => {
    const { spawnFn } = scriptedSpawn([{ stderr: 'Error: not logged in. Run `claude auth login` first.', code: 1 }]);
    const service = createCliService(
      { provider: 'anthropic', apiKey: '', model: 'claude-sonnet-5', mode: 'cli' },
      { spawnFn, resolveBinaryFn: resolveFound },
    );

    const err = await service.judge({ system: 'sys', user: 'usr', schema: SCHEMA }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmNotConfiguredError);
    expect(err.message).toContain('claude');
  });

  it('maps is_error:true in the envelope to a failure even when exit code is 0', async () => {
    const { spawnFn } = scriptedSpawn([
      { stdout: JSON.stringify({ type: 'result', is_error: true, subtype: 'error_max_turns', result: 'gave up' }), code: 0 },
    ]);
    const service = createCliService(
      { provider: 'anthropic', apiKey: '', model: 'claude-sonnet-5', mode: 'cli' },
      { spawnFn, resolveBinaryFn: resolveFound },
    );

    await expect(service.judge({ system: 'sys', user: 'usr', schema: SCHEMA })).rejects.toThrow(CliInvocationError);
  });

  it('verifyKey resolves on a successful minimal probe call', async () => {
    const { spawnFn, calls } = scriptedSpawn([
      { stdout: JSON.stringify({ type: 'result', is_error: false, result: 'ok' }), code: 0 },
    ]);
    const service = createCliService(
      { provider: 'anthropic', apiKey: '', model: 'claude-sonnet-5', mode: 'cli' },
      { spawnFn, resolveBinaryFn: resolveFound },
    );

    await expect(service.verifyKey()).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('maps a missing binary (resolveBinaryFn -> null) to LlmNotConfiguredError', async () => {
    const service = createCliService(
      { provider: 'anthropic', apiKey: '', model: 'claude-sonnet-5', mode: 'cli' },
      { spawnFn: vi.fn(), resolveBinaryFn: async () => null },
    );

    const err = await service.verifyKey().catch((e) => e);
    expect(err).toBeInstanceOf(LlmNotConfiguredError);
    expect(err.message).toContain('claude');
  });

  it('kills the child and rejects with CliTimeoutError when a call exceeds the timeout', async () => {
    let killed = false;
    const spawnFn: SpawnFn = vi.fn(() => {
      const child = makeFakeChild();
      child.kill = vi.fn(() => {
        killed = true;
      });
      // never emits 'close' — simulates a hung process
      return child;
    });
    const service = createCliService(
      { provider: 'anthropic', apiKey: '', model: 'claude-sonnet-5', mode: 'cli' },
      { spawnFn, resolveBinaryFn: resolveFound, timeoutMs: 30 },
    );

    await expect(service.judge({ system: 'sys', user: 'usr', schema: SCHEMA })).rejects.toThrow(CliTimeoutError);
    expect(killed).toBe(true);
  });

  it('kills the child and rejects with CliCancelledError when the caller aborts mid-call', async () => {
    let killed = false;
    const controller = new AbortController();
    // resolveBinaryFn/composePrompt run a few microtasks before execChild
    // ever calls spawnFn — abort only once spawnFn has actually fired, so
    // this exercises the "kill an already-spawned child" path rather than
    // racing ahead into the "already aborted before spawn" one.
    let resolveSpawned: (() => void) | undefined;
    const spawned = new Promise<void>((resolve) => {
      resolveSpawned = resolve;
    });
    const spawnFn: SpawnFn = vi.fn(() => {
      const child = makeFakeChild();
      child.kill = vi.fn(() => {
        killed = true;
      });
      resolveSpawned?.();
      // never emits 'close' — simulates a call still in flight when cancelled
      return child;
    });
    const service = createCliService(
      { provider: 'anthropic', apiKey: '', model: 'claude-sonnet-5', mode: 'cli' },
      { spawnFn, resolveBinaryFn: resolveFound },
    );

    const pending = service.judge({ system: 'sys', user: 'usr', schema: SCHEMA, signal: controller.signal });
    await spawned;
    controller.abort();

    await expect(pending).rejects.toThrow(CliCancelledError);
    expect(killed).toBe(true);
  });

  it('rejects with CliCancelledError without spawning when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const spawnFn: SpawnFn = vi.fn(() => makeFakeChild());
    const service = createCliService(
      { provider: 'anthropic', apiKey: '', model: 'claude-sonnet-5', mode: 'cli' },
      { spawnFn, resolveBinaryFn: resolveFound },
    );

    await expect(
      service.judge({ system: 'sys', user: 'usr', schema: SCHEMA, signal: controller.signal }),
    ).rejects.toThrow(CliCancelledError);
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

describe('cli adapter: codex (openai)', () => {
  it('reads the answer from the -o output file, not stdout', async () => {
    const { spawnFn, calls } = scriptedCodexSpawn([{ fileContent: '{"ok":true}', code: 0 }]);
    const service = createCliService(
      { provider: 'openai', apiKey: '', model: 'gpt-5.4-mini', mode: 'cli' },
      { spawnFn, resolveBinaryFn: resolveFound },
    );

    const result = await service.judge<{ ok: boolean }>({ system: 'sys', user: 'usr', schema: SCHEMA });

    expect(result).toEqual({ ok: true });
    expect(calls[0].args).toContain('exec');
    expect(calls[0].args).toContain('-s');
    expect(calls[0].args).toContain('read-only');
    expect(calls[0].args).toContain('-o');
  });

  it('cleans up the temp output file after reading it', async () => {
    const { spawnFn, calls } = scriptedCodexSpawn([{ fileContent: '{"ok":true}', code: 0 }]);
    const service = createCliService(
      { provider: 'openai', apiKey: '', model: 'gpt-5.4-mini', mode: 'cli' },
      { spawnFn, resolveBinaryFn: resolveFound },
    );

    await service.judge<{ ok: boolean }>({ system: 'sys', user: 'usr', schema: SCHEMA });

    const oIndex = calls[0].args.indexOf('-o');
    const outputFile = calls[0].args[oIndex + 1];
    await expect(readFile(outputFile, 'utf8')).rejects.toThrow();
  });

  it('maps a non-zero exit to CliInvocationError with stderr captured', async () => {
    const { spawnFn } = scriptedCodexSpawn([{ stderr: 'sandbox denied', code: 1 }]);
    const service = createCliService(
      { provider: 'openai', apiKey: '', model: 'gpt-5.4-mini', mode: 'cli' },
      { spawnFn, resolveBinaryFn: resolveFound },
    );

    const err = await service.judge({ system: 'sys', user: 'usr', schema: SCHEMA }).catch((e) => e);
    expect(err).toBeInstanceOf(CliInvocationError);
    expect(err.message).toContain('sandbox denied');
  });
});

describe('cli adapter: agy (gemini)', () => {
  it('always passes --sandbox and the prompt via argv (no stdin support)', async () => {
    const { spawnFn, calls } = scriptedSpawn([{ stdout: '{"ok":true}', code: 0 }]);
    const service = createCliService(
      { provider: 'gemini', apiKey: '', model: 'Gemini 3.5 Flash (High)', mode: 'cli' },
      { spawnFn, resolveBinaryFn: resolveFound },
    );

    const result = await service.judge<{ ok: boolean }>({ system: 'sys', user: 'usr', schema: SCHEMA });

    expect(result).toEqual({ ok: true });
    expect(calls[0].args).toContain('--sandbox');
    expect(calls[0].args).toContain('--model');
    expect(calls[0].args).toContain('Gemini 3.5 Flash (High)');
    expect(calls[0].args[0]).toBe('-p');
    // the composed prompt (system+user+schema) must be the argv value right after -p
    expect(calls[0].args[1]).toContain('sys');
    expect(calls[0].args[1]).toContain('usr');
  });

  it('strips narration/banner text around the JSON on stdout', async () => {
    const { spawnFn } = scriptedSpawn([
      { stdout: 'I will answer now.\n{"ok":true}\nDone.', code: 0 },
    ]);
    const service = createCliService(
      { provider: 'gemini', apiKey: '', model: 'Gemini 3.5 Flash (High)', mode: 'cli' },
      { spawnFn, resolveBinaryFn: resolveFound },
    );

    const result = await service.judge<{ ok: boolean }>({ system: 'sys', user: 'usr', schema: SCHEMA });
    expect(result).toEqual({ ok: true });
  });

  it('omits --model when no model is configured', async () => {
    const { spawnFn, calls } = scriptedSpawn([{ stdout: '{"ok":true}', code: 0 }]);
    const service = createCliService(
      { provider: 'gemini', apiKey: '', model: '', mode: 'cli' },
      { spawnFn, resolveBinaryFn: resolveFound },
    );

    await service.judge<{ ok: boolean }>({ system: 'sys', user: 'usr', schema: SCHEMA });
    expect(calls[0].args).not.toContain('--model');
  });
});

describe('getCliStatus', () => {
  it('reports found:false for a binary that does not resolve on PATH', async () => {
    const status = await getCliStatus({ resolveBinaryFn: async (name) => (name === 'claude' ? '/fake/claude' : null) });
    expect(status.claude.found).toBe(true);
    expect(status.codex.found).toBe(false);
    expect(status.agy.found).toBe(false);
  });

  it('returns the {claude, codex, agy} shape', async () => {
    const status = await getCliStatus({ resolveBinaryFn: async () => null });
    expect(Object.keys(status).sort()).toEqual(['agy', 'claude', 'codex']);
  });
});

describe('temp file plumbing sanity (real fs, no fake needed)', () => {
  it('mkdtemp/writeFile/readFile/rm round-trip works on this machine (sanity check for the codex adapter path)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'memorycastle-cli-test-'));
    const file = join(dir, 'out.txt');
    const fs = await import('node:fs/promises');
    await fs.writeFile(file, '{"ok":true}', 'utf8');
    expect(await readFile(file, 'utf8')).toBe('{"ok":true}');
    await rm(dir, { recursive: true, force: true });
  });
});
