// Single source of truth for provider defaults, so a model-catalog update is
// a one-line change here instead of a hunt across three adapter files.
// Verified current against each provider's official docs/SDK type defs on
// 2026-07-07 (see the M4 delivery report for sources):
//   - Anthropic: claude-sonnet-5 is GA and structured-output capable.
//   - Gemini: gemini-3.5-flash is the current flagship flash-tier model (GA
//     2026-05-19), the closest cost/quality analogue to claude-sonnet-5.
//   - OpenAI: gpt-5.4-mini is OpenAI's current recommended mini-tier model
//     (confirmed present in the installed `openai` SDK's ChatModel union).
export const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-5',
  gemini: 'gemini-3.5-flash',
  openai: 'gpt-5.4-mini',
} as const;

// Judgment tasks are short classification/extraction calls, not open-ended
// generation — this ceiling is generous headroom, not a target.
export const DEFAULT_MAX_TOKENS = 4096;

// M8: CLI mode (src/llm/cli.ts) shells out to each provider's official CLI
// instead of calling its HTTP API. Verified installed/working on this
// machine 2026-07-08 (see the M8 delivery report for the `--help` evidence
// behind each flag choice in cli.ts).
export const CLI_BINARY_NAMES = {
  anthropic: 'claude',
  gemini: 'agy',
  openai: 'codex',
} as const;

// Each judge()/verifyKey() call spawns a fresh CLI process. 0 disables the
// per-call timeout entirely (user decision 2026-07-13): a real patrol
// contradiction check over a 54-record castle measured 162s of legitimate
// work — the old 120s ceiling killed it 42s before the (valid) answer
// landed, and any fixed ceiling loses to a growing castle. The patrol UI
// shows elapsed seconds, so a genuinely wedged call is visible to the user.
// Consequence: agy runaway containment now rests on --sandbox alone (see
// cli.ts's file-level comment).
export const CLI_CALL_TIMEOUT_MS = 0;
