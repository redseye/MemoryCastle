# MemoryCastle REST API

Agent-facing reference for every `/api/v1` endpoint. Point Claude Code, the
Gemini CLI, Codex, or any HTTP-capable agent at this one file and it can
operate a MemoryCastle instance end to end: register a project, initialize a
castle, write and recall memory, walk a route, and run the consolidation
patrol.

## Base URL and transport

```
http://127.0.0.1:<port>/api/v1
```

- The server binds `127.0.0.1` only (loopback) — there is no auth and no
  CORS layer, by design (see `app/README.md`). Do not expose this port
  beyond localhost.
- Default port is `7420` (`~/.memorycastle/config.json`); override per-launch
  with `--port` on the CLI or the `MEMORYCASTLE_PORT` env var.
- All request/response bodies are JSON. `Content-Type: application/json` is
  required on any request with a body.
- **Encoding caveat (Windows shells)**: bodies must be UTF-8. Inlining
  Chinese text in a `curl -d '...'` argument from Git Bash / cmd can send
  cp950-mangled bytes that get stored verbatim (the request still returns
  201). Write the payload to a UTF-8 file and send it with
  `curl --data-binary @payload.json` instead.
- When `memorycastle serve` is run against a built web UI (`npm run
  build:all`), the same port also serves the UI at `/`; every non-`/api/*`
  path is either a static asset or falls back to the SPA's `index.html`.

## Errors

Every error response has this shape, regardless of endpoint:

```json
{ "error": { "code": "string", "message": "string (繁體中文)" } }
```

Common codes across endpoints:

| Code | Status | Meaning |
|---|---|---|
| `invalid_json` | 400 | Request body is not valid JSON |
| `invalid_body` | 400 | Body is valid JSON but fails field validation |
| `confirm_required` | 400 | A yellow-level write/delete was sent without `confirm:true` (body) or `?confirm=true` (query) |
| `root_not_found` | 400 | `POST /projects` root path does not exist on disk |
| `project_not_found` | 404 | `:id` does not match a registered project |
| `not_found` | 404 | Record/room/route/job not found, or the path itself doesn't match any endpoint |
| `route_not_found` | 404 | `POST /walks` named a route that doesn't exist in `routes.json` |
| `no_castle` | 409 | Project is registered but has no castle scaffold yet — call `POST /projects/:id/init` |
| `castle_exists` | 409 | `init` or `import/apply` refused to overwrite an existing castle |
| `llm_not_configured` | 409 | Endpoint needs an LLM and none is configured (see key-optional table below) |
| `invalid_api_key` | 401 | Configured provider rejected the API key |
| `llm_bad_output` | 502 | Provider's structured output failed schema validation after one retry |
| `internal_error` | 500 | Unhandled error (message included, no stack trace) |

## Key-optional vs key-required

No endpoint requires a key to exist or respond — every endpoint is reachable
with an empty `llm.apiKey`. Only these specific operations need a configured
provider to do their LLM-dependent work, and return `409 llm_not_configured`
otherwise:

| Endpoint | Needs a key for |
|---|---|
| `POST /projects/:id/remember` | The admission-gate judgment (novel/reusable/verifiable/no-secret) |
| `GET /projects/:id/recall/standing?fuzzy=true` | LLM-assisted room disambiguation (fuzzy=false or omitted is key-optional) |
| `POST /settings/test` | Verifying the configured key against the provider |
| `POST /projects/:id/patrol` (partially) | Only the clustering/contradiction/promotion **proposals**. The deterministic pre-pass (budget/staleness/route-gap `warnings`) always runs and is returned even with no key. |
| `GET /projects/:id/patrol/jobs/:id`, `POST .../apply` | Never — these read/apply an already-generated job and never call the LLM |

Everything else — health, settings CRUD, projects, init, castle overview,
keep/chronicle/rooms/routes CRUD, standing recall (non-fuzzy), search, walks,
and import — is fully deterministic and key-optional.

In **CLI mode** (`llm.mode: "cli"`, see Settings below) every row in this
table applies the same way, except "a configured provider" means a
locally-installed, logged-in CLI rather than an API key — `apiKey` is not
required.

---

## Health

### `GET /health`

Response `200`: `{ "ok": true, "version": "0.1.0", "projects": 2 }`

---

## Settings (`~/.memorycastle/config.json`)

### `GET /settings`

Response `200`: the user config with `llm.apiKey` masked (e.g. `"****7890"`, or `""` if unset).

```json
{ "schema": 1, "port": 7420, "llm": { "provider": "anthropic", "apiKey": "", "model": "claude-sonnet-5", "mode": "api" }, "projects": [] }
```

`llm.mode` is `"api"` (default) or `"cli"`; absent on any config written
before this field existed, which reads back as `"api"`.

### `PUT /settings`

Body (all fields optional; omitted `llm.apiKey` leaves it unchanged — you
must resend the masked value to keep it, or send `""` to clear it):

```json
{ "port": 7420, "llm": { "provider": "anthropic", "apiKey": "sk-...", "model": "claude-sonnet-5", "mode": "api" } }
```

Response `200`: same shape as GET, masked. Errors: `invalid_body` (400) for
an unknown `provider` or an unknown `mode` (only `"api"`/`"cli"` are valid).

**CLI mode** (`llm.mode: "cli"`) shells out to a locally-installed,
already-logged-in official CLI instead of calling the provider's HTTP API —
`provider` still selects which one (`anthropic`→`claude`, `openai`→`codex`,
`gemini`→`agy`), `model` is passed through to its `--model` flag if set, and
`apiKey` is ignored. This is a personal-use grey zone with no official
third-party endorsement, has materially higher latency (a subprocess starts
per call), and the CLI's own quota/terms can change independent of this
tool — **API mode is the default and recommended path**; use CLI mode only
to reuse an existing subscription. See `GET /settings/cli-status` to check
which CLIs are installed before switching.

### `POST /settings/test`

No body. Calls the configured provider's `verifyKey()` — in CLI mode this
resolves the CLI binary on PATH and makes one minimal probe call to confirm
it's logged in. Response `200`: `{ "ok": true }`. Errors: `llm_not_configured`
(409, missing API key **or**, in CLI mode, the CLI binary isn't on PATH or
isn't logged in), `invalid_api_key` (401, API mode only).

### `GET /settings/cli-status`

Detection only — resolves each CLI on PATH and reads its version if cheaply
available; never makes a probe/generation call, so it costs no quota and
needs no login. Response `200`:

```json
{
  "claude": { "found": true, "version": "2.x.x" },
  "codex": { "found": true, "version": "codex-cli 0.142.5" },
  "agy": { "found": true }
}
```

`version` is omitted when a CLI has no cheap version flag (agy) or when the
binary wasn't found (`found: false`).

---

## System

### `POST /system/pick-folder`

No body. Opens the native Windows folder-selection dialog on the *server*
process (not the browser/Electron) and returns the chosen path — a
convenience for the register-project form's 「瀏覽…」 button. Same result
either way the app is used: Electron window or a plain browser tab, since
the dialog runs server-side.

- **Windows only**: on any other `process.platform`, response is `501
  not_supported`.
- **One dialog at a time**: a second call while one is already open gets
  `409 picker_busy`.
- Response `200 { "path": "C:/Users/.../示範專案" }` on a chosen folder, or
  `200 { "cancelled": true }` if the user cancels. Path uses forward
  slashes, matching the rest of the app's convention.
- Times out after 5 minutes of no interaction → `408 picker_timeout` (the
  dialog process is killed server-side).
- Test-only env seams (never set these in normal use): `MEMORYCASTLE_FAKE_PICKER`
  (a path, or the literal string `cancel`) returns immediately without
  spawning anything; `MEMORYCASTLE_PICKER_TIMEOUT_MS` shortens the timeout.

---

## Projects

### `GET /projects`

Response `200`: `{ "projects": [{ "id": "my-app", "name": "My App", "root": "C:/path" }] }`

### `POST /projects`

Body: `{ "root": "C:/path/to/project", "name": "Optional Name" }`

The project is registered either way. Response `201` if a castle already
exists at `root`; response `409 no_castle` (with `project` in the body) if
it doesn't yet — call init next.

### `DELETE /projects/:id`

Unregisters only — never touches the castle on disk. Response `200`: `{ "ok": true }`.

### `POST /projects/:id/init`

Scaffolds `castle.json`, `keep.json`, `chronicle.json`, `routes.json` (3
default routes), `rooms/`, `archive/`. Response `201`: the castle meta
object. Errors: `castle_exists` (409).

### `GET /projects/:id/castle`

Response `200`:
```json
{
  "budgets": { "keepMax": 30, "roomMax": 120, "chronicleSweep": 20, "patrolDays": 30, "stalenessDays": 90 },
  "counts": { "keepCount": 6, "chronicleCount": 16, "rooms": [], "maxRoomCount": 0 },
  "patrolDue": { "due": false, "reasons": [] },
  "lastPatrolAt": "2026-07-06"
}
```

### `GET /projects/:id/routes`

Response `200`: `{ "routes": [{ "name": "session-start", "occasion": "...", "stops": [{ "target": "keep", "read": "all" }] }, ...] }`
— the route *definitions* (name/occasion/stops), read-only and deterministic.
To actually execute a route, use `POST /projects/:id/walks` below.

---

## Keep (yellow-level: writes/deletes need `confirm`)

### `GET /projects/:id/keep`

Response `200`: `{ "sections": { "identity": [Record], "constraints": [Record], "core": [Record] } }`

A Record: `{ "id": "m7k2x9ab", "date": "2026-07-06", "confidence": "high"|"med"|"low", "source": "user", "fact": "...", "tags": ["build"], "routeWarning": "before-release" }` (`routeWarning` optional).

### `POST /projects/:id/keep/records`

Body: `{ "section": "identity"|"constraints"|"core", "confirm": true, "confidence": "high", "source": "user", "fact": "...", "tags": ["t1"], "date": "optional", "routeWarning": "optional" }`

Response `201`: the created Record. Errors: `confirm_required` (400, if
`confirm` isn't `true`), `invalid_body` (400).

### `DELETE /projects/:id/keep/records/:rid?confirm=true`

Response `200`: the removed Record. Errors: `confirm_required` (400), `not_found` (404).

---

## Chronicle (green-level: direct append)

### `GET /projects/:id/chronicle`

Response `200`: `{ "entries": [Record] }`

### `POST /projects/:id/chronicle/records`

Body: `{ "confidence": "med", "source": "agent", "fact": "...", "tags": [], "date": "optional", "routeWarning": "optional" }`
(no `confirm` needed — this is the direct-write green path for an agent
that has already gated the fact itself, e.g. via `POST /remember` first, or
its own judgment).

Response `201`: the created Record. Errors: `invalid_body` (400).

---

## Remember (LLM admission gate)

### `POST /projects/:id/remember`

Body: `{ "text": "...", "source": "optional (default: agent)", "dryRun": false }`

Runs the four-question gate (novel / reusable / verifiable / no secret) via
the configured LLM, then appends to chronicle on pass.

- Pass, `dryRun` omitted/false: `201`, the created chronicle Record.
- Pass, `dryRun: true`: `200`, `{ "passed": true, "dryRun": true }` — nothing written.
- Fail: `422`, `{ "failedTests": ["novel", ...], "reason": "..." }`.
- No key configured: `409 llm_not_configured`.

---

## Rooms

### `GET /projects/:id/rooms`

Response `200`: `{ "rooms": [RoomFile] }`. A RoomFile: `{ "schema": 1, "slug": "build", "name": "Build Pipeline", "locus": ["scripts/**"], "adjacent": ["environment"], "emblem": null, "createdAt": "2026-07-06", "records": [Record] }`.

### `POST /projects/:id/rooms`

Body: `{ "name": "Build Pipeline", "locus": ["scripts/**"], "adjacent": [], "emblem": null, "slug": "optional" }`

Response `201`: the created RoomFile.

### `GET /projects/:id/rooms/:slug`

Response `200`: the RoomFile. Errors: `not_found` (404).

### `PATCH /projects/:id/rooms/:slug`

Body: any of `{ "name", "locus", "adjacent", "emblem" }` — used to fix locus drift. Response `200`: the updated RoomFile.

### `POST /projects/:id/rooms/:slug/records`

Body: same Record input as chronicle (`confidence`, `source`, `fact`, `tags?`, `date?`, `routeWarning?`). Response `201`: the created Record.

### `DELETE /projects/:id/rooms/:slug?confirm=true`

Response `200`: the removed RoomFile. Errors: `confirm_required` (400), `not_found` (404).

---

## Recall

### `GET /projects/:id/recall/standing?paths=a,b&fuzzy=true`

Deterministic locus matching (comma-separated `paths` against each room's
`locus` globs). Add `&fuzzy=true` to also ask the LLM to pick among
ambiguous/unmatched rooms — merged into the result by slug.

Response `200`: `{ "rooms": [RoomFile] }`. Errors: `llm_not_configured` (409, only when `fuzzy=true` and no key is set).

### `GET /projects/:id/recall/search?q=keyword&tag=t1`

Substring search across keep + chronicle + rooms. Either `q` or `tag` (or both) may be given.

Response `200`: `{ "results": [{ "record": Record, "location": "keep:identity"|"chronicle"|"room:<slug>" }] }`

---

## Walks

### `POST /projects/:id/walks`

Body: `{ "route": "session-start", "paths": ["scripts/build.mjs"] }` (`paths` optional — feeds `rooms-by-locus` dynamic stops).

Response `200`:
```json
{
  "stops": [{ "target": "keep", "lines": ["..."] }],
  "report": { "visited": 2, "total": 2, "warnings": 0, "valid": true, "text": "巡行 2/2 房，發現 0 項注意" }
}
```

Errors: `route_not_found` (404, unknown route name).

---

## Patrol (key-optional pre-pass + key-required proposals)

### `POST /projects/:id/patrol`

No body. Always runs the deterministic pre-pass (budget over-limits, staleness, route gaps) into `warnings`. If a key is configured, also runs
LLM clustering/distillation/contradiction/promotion into `proposals`
(otherwise `proposals` is `[]`, not an error).

Response `201`:
```json
{
  "id": "p8x2...",
  "status": "proposed",
  "createdAt": "2026-07-07",
  "warnings": [{ "kind": "over-budget"|"stale"|"route-gap", "target": "chronicle", "detail": "..." }],
  "proposals": [{ "id": "...", "kind": "roomRecord"|"roomCreate"|"contradiction"|"keepPromotion", "tier": "green"|"yellow", "summary": "...", "payload": { "...": "..." } }]
}
```

### `GET /projects/:id/patrol/jobs/:jobId`

Response `200`: the same job shape. Errors: `not_found` (404). Key-optional — never calls the LLM.

### `POST /projects/:id/patrol/jobs/:jobId/apply`

Body: `{ "approvals": ["proposalId1", ...] }` (optional; omitted/empty = apply
green proposals only). All `green` proposals apply automatically; `yellow`
proposals (room creation, contradiction/supersede, keep promotion) apply
only if their `id` is in `approvals`.

Response `200`: the job with `status: "applied"` and
`applyReport: { "appliedIds": [...], "skippedYellowIds": [...] }`.
Errors: `not_found` (404, unknown job id). Key-optional — never calls the LLM.

---

## Import (one-time markdown → JSON)

### `POST /projects/:id/import`

Preview only — no writes. Response `200`:
```json
{ "counts": { "keep": 6, "chronicle": 16, "routes": 3, "rooms": 0, "archiveMonths": 0 }, "warnings": [{ "file": "chronicle.md", "line": 12, "text": "...", "reason": "..." }] }
```

### `POST /projects/:id/import/apply`

Applies the import: writes the JSON castle, moves the original `.md` files
to `archive/markdown-original/`. Response `201`: same shape as preview plus
`movedFiles: string[]`. Errors: `castle_exists` (409, already imported/inited).

---

## curl walkthrough: register → init → remember → walk

```bash
# 1. Register a project (adjust root to your project path)
curl -s -X POST http://127.0.0.1:7420/api/v1/projects \
  -H "Content-Type: application/json" \
  -d '{"root":"C:/path/to/my-project","name":"My Project"}'
# -> 409 no_castle the first time; note the returned project.id, e.g. "my-project"

# 2. Initialize the castle scaffold
curl -s -X POST http://127.0.0.1:7420/api/v1/projects/my-project/init

# 3. Set an LLM key (needed for remember's gate judgment)
curl -s -X PUT http://127.0.0.1:7420/api/v1/settings \
  -H "Content-Type: application/json" \
  -d '{"llm":{"provider":"anthropic","apiKey":"sk-ant-...","model":"claude-sonnet-5"}}'

# 4. Remember a lesson through the admission gate
curl -s -X POST http://127.0.0.1:7420/api/v1/projects/my-project/remember \
  -H "Content-Type: application/json" \
  -d '{"text":"CI 上 npm ci 前必須先清 node_modules 快取，否則會用到跨平台不相容的 optional dependency","source":"user"}'

# 5. Walk the session-start route
curl -s -X POST http://127.0.0.1:7420/api/v1/projects/my-project/walks \
  -H "Content-Type: application/json" \
  -d '{"route":"session-start"}'
```
