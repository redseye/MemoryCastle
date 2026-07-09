// CLI-mode adapter (plan M8): shells out to a locally-installed,
// already-logged-in official CLI (claude / codex / agy) instead of calling
// the provider's HTTP API with an apiKey. This is a personal-use grey zone
// (no official third-party endorsement) — API mode stays the default and
// recommended path; this adapter only activates when llm.mode === 'cli'.
//
// Flags below are verified against each CLI's own --help output on this
// machine (2026-07-08), not memory:
//   - claude: `-p` (--print) reads the prompt from stdin when no positional
//     prompt is given; `--output-format json` wraps the answer in a single
//     JSON envelope `{ type, subtype, is_error, result, ... }` where `result`
//     is the model's raw text. Confirmed live: `echo '...' | claude -p
//     --output-format json` returns exactly that envelope on one line.
//   - codex: `codex exec` reads the prompt from stdin when no positional
//     PROMPT is given (its own --help: "If not provided as an argument ...
//     instructions are read from stdin"). `-o/--output-last-message <FILE>`
//     writes just the agent's final message to a file — confirmed live this
//     contains exactly the answer text with no envelope, which is far
//     simpler than parsing the `--json` JSONL event stream. `-s read-only`
//     avoids any tool-approval prompt hanging a non-interactive call.
//   - agy: `-p <prompt>` takes the prompt as a plain argv value (no stdin
//     support advertised in --help). `--model` matches the exact strings
//     `agy models` lists (e.g. "Gemini 3.5 Flash (High)").
//
// CRITICAL, discovered by live testing (not in any doc): giving agy an
// unresolvable --model value does NOT fail cleanly. It silently falls into
// an unrestricted agentic tool-use loop — observed reading files across the
// whole machine (project directories, ~/.gemini config, unrelated desktop
// folders) before eventually exiting 1. `--sandbox` ("run in a sandbox with
// terminal restrictions enabled") contains that exploration to a restricted
// directory instead of the real filesystem. Every agy invocation below
// passes --sandbox unconditionally — this is not optional hardening, it is
// the difference between a failed judge() call and an uncontrolled process
// reading the user's home directory. The per-call timeout (CLI_CALL_TIMEOUT_MS)
// is the second line of defense if a bad model still wastes time inside the
// sandbox.
//
// Windows spawn note: claude and agy resolve to real .exe files (spawn
// directly, shell:false — safe for arbitrary prompt content since no shell
// re-parses argv). codex resolves to an npm-installed .cmd shim, which
// Windows can only execute via cmd.exe, so it needs shell:true; the prompt
// for codex/claude always goes via stdin, never argv, specifically to avoid
// any shell-quoting hazard from JSON-shaped prompt text. agy has no stdin
// input path, so its prompt goes through argv with shell:false, which passes
// arbitrary content (quotes, braces, newlines) to the OS unmodified — that is
// the safe equivalent of stdin here, not a workaround.

import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { LlmConfig, LlmProviderId } from '../config/types.js';
import { LlmNotConfiguredError } from '../server/llm-seam.js';
import type { JudgeTask, LlmService } from '../server/llm-seam.js';
import { CLI_BINARY_NAMES, CLI_CALL_TIMEOUT_MS } from './constants.js';
import { judgeWithRetry } from './judge-helpers.js';

const execFileAsync = promisify(execFile);

// --- errors -----------------------------------------------------------
// Never part of the LlmNotConfiguredError family: those two are reserved for
// "binary missing" / "not logged in", both of which route callers can react
// to the same way as API-mode's missing-key case (409). Everything else here
// is an unexpected failure and falls through to app.ts's generic 500, same
// as an unrecognized error from any HTTP provider adapter.

export class CliTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`${command} 逾時（${timeoutMs}ms）未回應，已強制中止。`);
    this.name = 'CliTimeoutError';
  }
}

export class CliInvocationError extends Error {
  constructor(cliName: string, detail: string) {
    super(`${cliName} 執行失敗：${detail}`);
    this.name = 'CliInvocationError';
  }
}

// --- spawn seam (test injection point, mirrors *ClientLike in the HTTP adapters) ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SpawnFn = (command: string, args: string[], options: any) => any;

export interface CliOverrides {
  spawnFn?: SpawnFn;
  resolveBinaryFn?: (name: string) => Promise<string | null>;
  // Test-only seam: real callers always get CLI_CALL_TIMEOUT_MS. Overriding
  // lets the timeout/kill unit test run in milliseconds instead of 120s.
  timeoutMs?: number;
}

async function resolveBinaryReal(name: string): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(finder, [name], { windowsHide: true });
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return null;
    if (process.platform === 'win32') {
      // `where` can list several matches (e.g. codex, codex.cmd, codex.ps1
      // for an npm-installed CLI) — an extensionless file is usually a POSIX
      // shell script Windows cannot execute directly, so prefer .cmd/.exe/.bat.
      const preferred = lines.find((l) => /\.(cmd|exe|bat)$/i.test(l));
      return preferred ?? lines[0];
    }
    return lines[0];
  } catch {
    return null;
  }
}

interface Invocation {
  command: string;
  args: string[];
}

// .cmd/.bat shims (e.g. codex's npm-installed launcher) can't be exec'd
// directly by CreateProcess — cmd.exe has to interpret them. The naive fix
// (spawn with shell:true) turned out to be actively broken: verified live
// that Node does not quote the resolved absolute path for the *command*
// itself, so an install under "C:\Program Files\..." (a space in the path)
// makes cmd.exe read "C:\Program" as the executable name and fail with
// "not recognized" — and manually quoting the path plus
// windowsVerbatimArguments still failed the same way. The fix that verified
// clean: invoke `cmd.exe /d /s /c <bare name> ...args` directly (shell:false)
// and let cmd.exe do its own PATH/PATHEXT lookup on the short name — this
// never constructs an absolute path string for cmd.exe to mis-tokenize.
function buildInvocation(resolvedPath: string, bareName: string, args: string[]): Invocation {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolvedPath)) {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', bareName, ...args] };
  }
  return { command: resolvedPath, args };
}

// Windows note: killing only the direct child (cmd.exe, for the .cmd-shim
// case above) can leave its real descendant (e.g. node.exe running codex)
// orphaned. `taskkill /t` kills the whole tree. Guarded to only run when the
// child carries a real pid — test doubles must leave `pid` undefined so this
// never targets an actual OS process by coincidence.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function killChild(child: any): void {
  if (process.platform === 'win32' && typeof child.pid === 'number') {
    try {
      execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => {});
      return;
    } catch {
      // fall through to a plain kill below
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // already exited
  }
}

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function execChild(
  spawnFn: SpawnFn,
  command: string,
  args: string[],
  opts: { stdinData?: string; timeoutMs: number },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let child: any;
    try {
      // shell is always false: buildInvocation() resolves the Windows
      // .cmd-shim case itself (cmd.exe /c <bare name>) instead of relying on
      // spawn's shell:true, which mis-tokenizes an absolute path containing
      // a space (see buildInvocation's comment).
      child = spawnFn(command, args, { windowsHide: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      reject(code === 'ENOENT' ? new CliInvocationError(command, '找不到可執行檔') : err);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killChild(child);
      reject(new CliTimeoutError(command, opts.timeoutMs));
    }, opts.timeoutMs);

    child.stdout?.on('data', (d: Buffer | string) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer | string) => {
      stderr += d.toString();
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err.code === 'ENOENT' ? new CliInvocationError(command, '找不到可執行檔') : err);
    });

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });

    if (opts.stdinData !== undefined) child.stdin?.write(opts.stdinData);
    child.stdin?.end();
  });
}

// --- prompt composition (shared across all three CLIs) -----------------
// Fixed design: one flattened prompt = system + user + an explicit
// instruction to reply with only JSON matching the schema, embedded
// literally. This is the only approach that works uniformly across all
// three CLIs — only claude exposes a native --json-schema flag, so per-CLI
// structured-output modes would not generalize to codex/agy.

function composePrompt(task: JudgeTask<unknown>): string {
  return `${task.system}\n\n${task.user}\n\nReply with ONLY a single JSON object that matches this JSON Schema exactly. Do not include any commentary, explanation, or markdown code fences — output must be raw JSON only, parseable by JSON.parse.\n\nJSON Schema:\n${JSON.stringify(task.schema)}`;
}

function composeRetryPrompt(basePrompt: string, previousRawOutput: string, validationError: string): string {
  return `${basePrompt}\n\n--- Your previous output ---\n${previousRawOutput}\n--- End previous output ---\nThat output failed JSON schema validation: ${validationError}\nReturn corrected JSON that matches the schema exactly, with no extra commentary, no markdown code fences.`;
}

const MINIMAL_PROBE_PROMPT = 'Reply with exactly the single word: ok';

// Deterministic fallback extraction (plan M8 §3): a CLI may wrap the answer
// in banners/log lines around the JSON. Try the whole trimmed text first;
// if that doesn't parse, fall back to the substring from the first `{` to
// the last `}`.
function extractJsonObjectText(raw: string): string {
  const trimmed = raw.trim();
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // fall through
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return trimmed;
  return trimmed.slice(start, end + 1);
}

const AUTH_ISSUE_PATTERN =
  /not logged in|please\s+log\s?in|login required|authentication (failed|required|error)|unauthorized|401|invalid api key|no credentials|not authenticated/i;

function throwClassified(cliName: string, loginHint: string, combinedText: string): never {
  if (AUTH_ISSUE_PATTERN.test(combinedText)) {
    throw new LlmNotConfiguredError(`${cliName} 尚未登入或憑證已過期，請先完成登入：${loginHint}`);
  }
  const detail = combinedText.trim().slice(0, 500) || '(無輸出)';
  throw new CliInvocationError(cliName, detail);
}

// --- per-CLI invocation --------------------------------------------------

async function runClaude(
  binaryPath: string,
  bareName: string,
  prompt: string,
  model: string | undefined,
  timeoutMs: number,
  spawnFn: SpawnFn,
): Promise<string> {
  // Judge calls are pure classification completions, not coding sessions —
  // but a bare `claude -p` still boots a full agent session: user MCP
  // servers, CLAUDE.md discovery, built-in tools, default reasoning effort.
  // Verified live 2026-07-09 on a real 4 KB patrol clusterEntries prompt:
  // default session took 69s (num_turns 2, ~60s of it thinking) — routinely
  // flirting with CLI_CALL_TIMEOUT_MS — vs 6s with the lean flags below,
  // with equivalent judgment output. `--tools ''` doubles as containment
  // (same reasoning as agy's --sandbox: a confused model cannot touch the
  // filesystem). `--effort low` also matches API mode, which never enables
  // extended thinking for judge calls. All flags verified against
  // `claude --help` 2026-07-09; NOT `--bare`, which drops OAuth — the whole
  // point of CLI mode.
  const invocation = buildInvocation(binaryPath, bareName, [
    '-p',
    '--output-format',
    'json',
    '--tools',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--safe-mode',
    '--effort',
    'low',
    ...(model ? ['--model', model] : []),
  ]);
  const { stdout, stderr, code } = await execChild(spawnFn, invocation.command, invocation.args, {
    stdinData: prompt,
    timeoutMs,
  });
  if (code !== 0) throwClassified('claude', 'claude auth login', `${stdout}\n${stderr}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let envelope: any;
  try {
    envelope = JSON.parse(extractJsonObjectText(stdout));
  } catch (err) {
    throw new CliInvocationError('claude', `無法解析輸出：${err instanceof Error ? err.message : String(err)}`);
  }
  if (envelope.is_error) {
    throwClassified('claude', 'claude auth login', String(envelope.result ?? envelope.subtype ?? stderr));
  }
  if (typeof envelope.result !== 'string') {
    throw new CliInvocationError('claude', 'CLI 回傳的 JSON 中沒有 result 欄位');
  }
  return extractJsonObjectText(envelope.result);
}

async function runCodex(
  binaryPath: string,
  bareName: string,
  prompt: string,
  model: string | undefined,
  timeoutMs: number,
  spawnFn: SpawnFn,
): Promise<string> {
  const outputFile = join(tmpdir(), `memorycastle-codex-${randomUUID()}.txt`);
  try {
    const invocation = buildInvocation(binaryPath, bareName, [
      'exec',
      '--skip-git-repo-check',
      '-s',
      'read-only',
      '--json',
      '-o',
      outputFile,
      ...(model ? ['--model', model] : []),
    ]);
    const { stdout, stderr, code } = await execChild(spawnFn, invocation.command, invocation.args, {
      stdinData: prompt,
      timeoutMs,
    });
    if (code !== 0) throwClassified('codex', 'codex login', `${stdout}\n${stderr}`);

    let fileContent: string;
    try {
      fileContent = await readFile(outputFile, 'utf8');
    } catch {
      throw new CliInvocationError('codex', 'CLI 未產生任何輸出檔案');
    }
    if (!fileContent.trim()) throw new CliInvocationError('codex', 'CLI 輸出檔案為空');
    return extractJsonObjectText(fileContent);
  } finally {
    await rm(outputFile, { force: true }).catch(() => {});
  }
}

async function runAgy(
  binaryPath: string,
  bareName: string,
  prompt: string,
  model: string | undefined,
  timeoutMs: number,
  spawnFn: SpawnFn,
): Promise<string> {
  // --sandbox is mandatory — see the file-level comment for why. Prompt goes
  // via argv, not stdin (agy has no stdin support) — safe only because agy
  // resolves to a real .exe (verified) and is spawned directly with
  // shell:false; if it ever resolved to a .cmd shim, buildInvocation's
  // cmd.exe wrapper would re-parse this argv through cmd.exe's own special
  // characters, which JSON-shaped prompt text is not guaranteed to survive.
  const invocation = buildInvocation(binaryPath, bareName, ['-p', prompt, '--sandbox', ...(model ? ['--model', model] : [])]);
  const { stdout, stderr, code } = await execChild(spawnFn, invocation.command, invocation.args, { timeoutMs });
  if (code !== 0) throwClassified('agy', '依 agy 官方文件完成登入（agy 目前未提供獨立 login 子指令）', `${stdout}\n${stderr}`);
  return extractJsonObjectText(stdout);
}

type RunFn = (
  binaryPath: string,
  bareName: string,
  prompt: string,
  model: string | undefined,
  timeoutMs: number,
  spawnFn: SpawnFn,
) => Promise<string>;

interface CliAdapterDef {
  binary: string;
  loginHint: string;
  run: RunFn;
}

const CLI_ADAPTERS: Record<LlmProviderId, CliAdapterDef> = {
  anthropic: { binary: CLI_BINARY_NAMES.anthropic, loginHint: 'claude auth login', run: runClaude },
  openai: { binary: CLI_BINARY_NAMES.openai, loginHint: 'codex login', run: runCodex },
  gemini: {
    binary: CLI_BINARY_NAMES.gemini,
    loginHint: '依 agy 官方文件完成登入（agy 目前未提供獨立 login 子指令）',
    run: runAgy,
  },
};

// --- public API ------------------------------------------------------

export function createCliService(cfg: LlmConfig, overrides: CliOverrides = {}): LlmService {
  const spawnFn: SpawnFn = overrides.spawnFn ?? (spawn as unknown as SpawnFn);
  const resolveBinaryFn = overrides.resolveBinaryFn ?? resolveBinaryReal;
  const timeoutMs = overrides.timeoutMs ?? CLI_CALL_TIMEOUT_MS;
  const adapter = CLI_ADAPTERS[cfg.provider];
  const model = cfg.model || undefined;

  async function resolveOrThrow(): Promise<string> {
    const path = await resolveBinaryFn(adapter.binary);
    if (!path) {
      throw new LlmNotConfiguredError(
        `找不到 ${adapter.binary} CLI（已檢查 PATH）。請先安裝並登入：${adapter.loginHint}`,
      );
    }
    return path;
  }

  return {
    async verifyKey(): Promise<void> {
      const binaryPath = await resolveOrThrow();
      await adapter.run(binaryPath, adapter.binary, MINIMAL_PROBE_PROMPT, model, timeoutMs, spawnFn);
    },

    async judge<T>(task: JudgeTask<T>): Promise<T> {
      const binaryPath = await resolveOrThrow();
      const basePrompt = composePrompt(task);
      const callOnce = () => adapter.run(binaryPath, adapter.binary, basePrompt, model, timeoutMs, spawnFn);
      const callRetry = (previousRawOutput: string, validationError: string) =>
        adapter.run(
          binaryPath,
          adapter.binary,
          composeRetryPrompt(basePrompt, previousRawOutput, validationError),
          model,
          timeoutMs,
          spawnFn,
        );
      return judgeWithRetry<T>(task.schema, callOnce, callRetry);
    },
  };
}

// --- settings UI support: PATH detection only, never a probe call ------

export interface CliBinaryStatus {
  found: boolean;
  version?: string;
}

export type CliStatusReport = Record<'claude' | 'codex' | 'agy', CliBinaryStatus>;

// agy has no --version/-v flag in its `agy --help` output (verified
// 2026-07-08) — status reports PATH presence only for it, no version string.
const VERSION_FLAGS: Partial<Record<'claude' | 'codex' | 'agy', string>> = {
  claude: '--version',
  codex: '--version',
};

export async function getCliStatus(
  overrides: { resolveBinaryFn?: (name: string) => Promise<string | null> } = {},
): Promise<CliStatusReport> {
  const resolveBinaryFn = overrides.resolveBinaryFn ?? resolveBinaryReal;
  const names = ['claude', 'codex', 'agy'] as const;

  const entries = await Promise.all(
    names.map(async (name) => {
      const path = await resolveBinaryFn(name);
      if (!path) return [name, { found: false }] as const;
      const flag = VERSION_FLAGS[name];
      if (!flag) return [name, { found: true }] as const;
      try {
        const { stdout } = await execFileAsync(path, [flag], { windowsHide: true, timeout: 5000 });
        const version = stdout.trim().slice(0, 100);
        return [name, version ? { found: true, version } : { found: true }] as const;
      } catch {
        return [name, { found: true }] as const;
      }
    }),
  );

  return Object.fromEntries(entries) as CliStatusReport;
}
