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
| `fact_too_long` | 400 | A record's `fact` is longer than the castle's `budgets.factMaxChars` (default 200, JS string length) |
| `fact_multiline` | 400 | A record's `fact` contains a newline — one record is one line; put a paragraph in `archive/` and cite its path |
| `route_warning_invalid` | 400 | A record's `routeWarning` names a route that doesn't exist in `routes.json` |
| `invalid_query` | 400 | Search was called with neither `q` nor `tag`, or with a `limit` that isn't a positive integer |
| `confirm_required` | 400 | A yellow-level write/delete was sent without `confirm:true` (body) or `?confirm=true` (query) |
| `root_not_found` | 400 | `POST /projects` root path does not exist on disk |
| `project_not_found` | 404 | `:id` does not match a registered project |
| `not_found` | 404 | Record/room/route/job not found, or the path itself doesn't match any endpoint |
| `route_not_found` | 404 | `POST /walks` named a route that doesn't exist in `routes.json` |
| `no_castle` | 409 | Project is registered but has no castle scaffold yet — call `POST /projects/:id/init` |
| `castle_exists` | 409 | `init` or `import/apply` refused to overwrite an existing castle |
| `over_budget` | 409 | A keep or room record append would exceed `keepMax` / `roomMax`; resend with `override: true` to exceed deliberately |
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
| `GET /projects/:id/recall/standing?fuzzy=true` | LLM-assisted room selection — only reached when deterministic locus matching found no room (fuzzy=false or omitted is key-optional) |
| `POST /settings/test` | Verifying the configured key against the provider |
| `POST /projects/:id/patrol` (partially) | Only the LLM **proposals** (clustering/distill, splits, over-budget cuts, contradiction, promotion). The deterministic pre-pass (budget/staleness/route-gap `warnings`) and the deterministic proposals (handover sweep, `staleReview`) always run, even with no key. |
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
default routes), `rooms/`, `archive/`. The default `session-start` route is
`patrol-check/due → keep/all → chronicle/last-handover → rooms-by-locus/all`.
Response `201`: the castle meta object (budgets include `factMaxChars: 200`).
Errors: `castle_exists` (409).

Castle JSON files are written 2-space indented, but every record, every
route, and every string array (`locus`, `adjacent`, `tags`) sits on one
compact line with canonical key order — `grep '"locus"' rooms/*.json` gives
one line per room, and grepping a keyword returns the whole record including
its date and confidence. Files written by older versions are reformatted on
their next write.

### `GET /projects/:id/castle`

Response `200`:
```json
{
  "budgets": { "keepMax": 30, "roomMax": 120, "chronicleSweep": 20, "patrolDays": 30, "stalenessDays": 90, "factMaxChars": 200 },
  "counts": { "keepCount": 6, "chronicleCount": 16, "rooms": [], "maxRoomCount": 0, "chronicleSinceLastPatrol": 3 },
  "patrolDue": { "due": false, "reasons": [], "triggers": [] },
  "lastPatrolAt": "2026-07-06"
}
```

`budgets` are always complete: a `castle.json` written before a budget
existed reads back with its default (e.g. `factMaxChars: 200`). Every
budget except `factMaxChars` is a record/entry/day count. `patrolDue`
lists **every** fired §4 trigger, including every room over `roomMax`:
`reasons` are short strings (`chronicle>=20`, `room:<slug>>120`, `keep>30`,
`daysSincePatrol>30`) and `triggers` the same set structured as
`{ "kind": "chronicle"|"room"|"keep"|"days", "target", "count", "limit", "reason" }`.
`counts.chronicleSinceLastPatrol` (this endpoint only) sits beside the
`chronicleCount` total: the entries dated after `lastPatrolAt` (all of them
when never patrolled) — the number trigger 1 compares with `chronicleSweep`.

### `GET /projects/:id/routes`

Response `200`: `{ "routes": [{ "name": "session-start", "occasion": "...", "stops": [{ "target": "keep", "read": "all" }] }, ...] }`
— the route *definitions* (name/occasion/stops), read-only and deterministic.
To actually execute a route, use `POST /projects/:id/walks` below.

### `GET /projects/:id/doctor`

Deterministic, LLM-free drift detection ("castle doctor"): whether the
castle's records have fallen behind the code. Read-only — never writes
anything under `.claude/castle`. Same computation as `memorycastle doctor
<project-root>` on the CLI and the Web UI's 「健康檢查」 page.

Response `200`:
```json
{
  "checkedAt": "2026-09-10T03:09:16.252Z",
  "root": "C:/path/to/project",
  "status": "ok" | "warn" | "error",
  "findings": [
    { "kind": "uncommitted-drift", "severity": "warn", "target": "git", "detail": "..." }
  ]
}
```

Finding `kind`: `handover-drift` (last commit later than the newest chronicle
entry), `uncommitted-drift` (uncommitted changes with a stale `#handover`
entry), `patrol-due` (one finding per fired `patrolDue()` trigger),
`over-budget` (keep over `keepMax`, or a room over `roomMax` — one finding
each), `oversize-record` (a live keep/room/chronicle record whose `fact`
exceeds `factMaxChars` or contains a newline; target `keep:<id>` /
`room:<slug>:<id>` / `chronicle:<id>`), `stale-records` (one finding with the
count of keep + room records that are hypotheses under the staleness rule
below), `locus-orphan` (a room's path-like locus entry matches zero files),
`locus-unreachable` (a room with no path-like locus — none containing `/`,
`*`, or a file extension — and no explicit `room:<slug>` stop on a route
other than `patrol`, so standing recall can never load it), `route-gap` (a
route references a missing room, or a room is unreachable by any route),
`route-target-invalid` / `route-read-invalid` (`error`: a stop outside the
walk whitelist — see Walks; walks skip such a stop and come back invalid),
`route-warning-invalid` (a record's `routeWarning` names a missing route),
`git` (`info`: no git repository found, or git unavailable — drift checks
are skipped in that case). `severity`: `ok` | `info` | `warn` | `error`.
`status` is the worst severity among `findings` (`ok`/`info` count as `ok`);
the CLI exits 0 only for `ok`.

**Staleness rule** (used by doctor, walks, and patrol): a record is a
hypothesis when `confidence` is `low`, or when its `source` is not `"user"`
and more than `stalenessDays` have passed since the later of `date` and
`verifiedAt`. `source: "user"` records are standing directives and exempt
from the age rule.

---

## Keep (yellow-level: writes/deletes need `confirm`)

### `GET /projects/:id/keep`

Response `200`: `{ "sections": { "identity": [Record], "constraints": [Record], "core": [Record] } }`

A Record: `{ "id": "m7k2x9ab", "date": "2026-07-06", "confidence": "high"|"med"|"low", "source": "user", "fact": "...", "tags": ["build"], "routeWarning": "before-release", "verifiedAt": "2026-10-28" }` (`routeWarning` and `verifiedAt` optional; `verifiedAt` is the last date the fact was re-verified).

**Record rules on every record write** (keep, chronicle, room records):
`fact` must be one line (`fact_multiline`) of at most `budgets.factMaxChars`
characters (`fact_too_long`); `routeWarning`, when given, must name an
existing route (`route_warning_invalid`); `verifiedAt`, when given, must be a
real `YYYY-MM-DD` date (`invalid_body`).

### `POST /projects/:id/keep/records`

Body: `{ "section": "identity"|"constraints"|"core", "confirm": true, "confidence": "high", "source": "user", "fact": "...", "tags": ["t1"], "date": "optional", "routeWarning": "optional", "verifiedAt": "optional", "override": false }`

Response `201`: the created Record. Errors: `confirm_required` (400, if
`confirm` isn't `true`), `invalid_body` / `fact_too_long` / `fact_multiline`
/ `route_warning_invalid` (400), `over_budget` (409: keep already holds
`keepMax` records across its three sections — the 31st append by default;
send `override: true` to append anyway, leaving the cut to patrol).

### `DELETE /projects/:id/keep/records/:rid?confirm=true`

Response `200`: the removed Record. Errors: `confirm_required` (400), `not_found` (404).

---

## Chronicle (green-level: direct append)

### `GET /projects/:id/chronicle`

Response `200`: `{ "entries": [Record] }`

### `POST /projects/:id/chronicle/records`

Body: `{ "confidence": "med", "source": "agent", "fact": "...", "tags": [], "date": "optional", "routeWarning": "optional", "verifiedAt": "optional" }`
(no `confirm` needed — this is the direct-write green path for an agent
that has already gated the fact itself, e.g. via `POST /remember` first, or
its own judgment).

Response `201`: the created Record. Errors: `invalid_body` /
`fact_too_long` / `fact_multiline` / `route_warning_invalid` (400). Chronicle
has no write-time cap — reaching `chronicleSweep` triggers patrol instead.

---

## Remember (LLM admission gate)

### `POST /projects/:id/remember`

Body: `{ "text": "...", "source": "optional (default: agent)", "dryRun": false }`

Runs the four-question gate (novel / reusable / verifiable / no secret) and
distills the record in **one** LLM call, then appends to chronicle on pass.
The gate also sees the castle's top 5 keyword hits for the text (keep +
rooms + chronicle, handovers excluded; ranked by how many of the text's
terms — ASCII words, CJK bigrams — a record contains), so a duplicate fails
`novel`. The distilled fact must be one line of at most
`budgets.factMaxChars` characters: an offending fact gets one rewrite call,
and if that still does not fit, nothing is written.

- Pass, `dryRun` omitted/false: `201`, the created chronicle Record.
- Pass, `dryRun: true`: `200`, `{ "passed": true, "dryRun": true }` — nothing written.
- Fail: `422`, `{ "failedTests": ["novel", ...], "reason": "..." }`. `failedTests`
  may also be `["factTooLong"]` (the gate passed but the fact could not be
  brought under the cap).
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

Body: same Record input as chronicle (`confidence`, `source`, `fact`, `tags?`, `date?`, `routeWarning?`, `verifiedAt?`) plus optional `override`. Response `201`: the created Record. Errors: the record-rule 400s above, `not_found` (404), `over_budget` (409: the room already holds `roomMax` records; send `override: true` to append anyway).

### `DELETE /projects/:id/rooms/:slug?confirm=true`

Response `200`: the removed RoomFile. Errors: `confirm_required` (400), `not_found` (404).

---

## Recall

### `GET /projects/:id/recall/standing?paths=a,b&fuzzy=true`

Deterministic locus matching (comma-separated `paths` against each room's
`locus` globs). Paths may be relative or absolute: backslashes become `/`,
an absolute path is made relative to the project root (a path outside the
root never matches), a leading `./` is dropped, and matching is
case-insensitive. Only path-like locus entries (containing `/`, `*`, or a
file extension) match; `**/x` matches `x` and `a/b/x` but never `barx`, a
trailing `/**` also matches the directory itself, `*` and `?` stay within
one path segment, and a plain entry like `src/core` owns that directory.

Add `&fuzzy=true` to fall back to the LLM **only when deterministic matching
found no room**; a mechanical hit is returned as-is without an LLM call.

Response `200`: `{ "rooms": [RoomFile] }`. Errors: `llm_not_configured` (409, only when `fuzzy=true`, nothing matched deterministically, and no key is set).

### `GET /projects/:id/recall/search?q=keyword&tag=t1&limit=20`

Substring search across keep + chronicle + rooms. At least one of `q` or
`tag` is required — there is no "list everything" (`invalid_query`, 400).
`limit` defaults to 20 and is capped at 100 (a larger value is clamped; a
non-positive or non-integer value is `invalid_query`).

Response `200`: `{ "results": [{ "record": Record, "location": "keep:identity"|"chronicle"|"room:<slug>" }] }`

---

## Walks

### `POST /projects/:id/walks`

Body: `{ "route": "session-start", "paths": ["scripts/build.mjs"] }` (`paths` optional — feeds `rooms-by-locus` dynamic stops; same normalization as standing recall, so absolute paths work).

Response `200`:
```json
{
  "stops": [
    { "target": "patrol-check", "lines": ["巡查到期：距上次巡查 114 天 > 30"] },
    { "target": "keep", "lines": ["...", "（待驗證）..."] },
    { "target": "chronicle", "lines": ["狀態：…／決定：…／下一步：…"] },
    { "target": "rooms-by-locus", "lines": [], "deferred": true }
  ],
  "report": {
    "visited": 0, "total": 0, "warnings": 1, "deferred": 1, "unmatchedPaths": [], "valid": true,
    "text": "巡行 0/0 房，發現 1 項注意；延後 1 站"
  }
}
```

Stop vocabulary (closed whitelist):

| `target` | valid `read` values | lines |
|---|---|---|
| `keep` | `all`, `route-warnings`, `section:identity` / `section:constraints` / `section:core` | record facts |
| `chronicle` | `all`, `route-warnings`, `last-handover` (only the newest entry tagged `handover`) | record facts |
| `routes` | `all`, `route-warnings` | route names (`route-warnings`: none) |
| `room:<slug>`, `all-rooms`, `rooms-by-locus` | `all`, `route-warnings` | record facts, one stop per room |
| `patrol-check` | `due` (also `all`), `route-warnings` | one line per fired patrol trigger, or none |

- A stop outside the whitelist (unknown `target`, or a `read` not valid for
  its target) is **skipped**: it comes back as `{ "target", "lines": [],
  "read", "skipped": true }` and the walk is `valid: false`. A `room:<slug>`
  stop naming a missing room is skipped the same way.
- `rooms-by-locus` with no `paths` (session start, before any file is
  touched) is **deferred**: `{ "deferred": true }`, neither visited nor
  skipped, and the report text gains `；延後 N 站`. Walk it again with paths
  once you know what you are touching.
- Given paths that no room's locus owns are listed in
  `report.unmatchedPaths` (root-relative where possible) and appended to the
  text as `；無對應房間：a、b`.
- Record lines that are hypotheses under the staleness rule (see Doctor) are
  prefixed `（待驗證）` — verify before acting on them.
- `warnings` (the X in `發現 X 項注意`) counts `route-warnings` lines plus
  `patrol-check` lines.

Errors: `route_not_found` (404, unknown route name).

---

## Patrol (key-optional pre-pass + key-required proposals)

### `POST /projects/:id/patrol`

Body optional: `{ "full": true }` restores the whole-castle pass (see
below); omitted/false = incremental. Always runs the deterministic pre-pass
(budget over-limits — the chronicle one counts only entries dated after
`lastPatrolAt`, exactly like `patrolDue` — staleness, route gaps) into
`warnings`, and the deterministic proposals:

- **Handovers**: every `handover` entry but the newest is swept (green
  `chronicleSweep`, reason `handover`). A handover can hold a durable
  decision, so the proposal's `summary` lists every handover it will sweep
  with its full fact text, and `payload.entries` carries the records — rescue
  a decision (append it as an ordinary chronicle entry) before applying. No
  LLM call. Handovers never reach a prompt and are never promoted.
- **Hypotheses**: a yellow `staleReview` for every hypothesis in keep and rooms.

If a key is configured, also runs the LLM steps (otherwise they are skipped,
not an error, and the job is `complete: false`):

- **Chronicle**: one call clusters the non-handover entries *and* names each
  cluster's room (or a proposed new room, ≥3 entries; a smaller group no room
  owns is not a cluster — its entries go one by one as below) and, for each aged
  orphan (older than `patrolDays`, in no cluster), its room and whether it
  still passes the gate — a tag naming a room's slug, or a path-like tag one
  room's locus owns, decides the room first. Only clusters with a destination
  are distilled, 3 calls in parallel; each distilled fact re-applies the §3
  gate (`passesGate`). Facts that fail are not written, and entries whose
  facts all fail are swept (`chronicleSweep`, reason `gate`). Written
  records are at most `conf: med` and get no `verifiedAt` — the app's patrol
  never verifies a fact itself; a distilled record's `date` is its newest
  source entry's date, never today. An orphan moved verbatim keeps its own
  `date`, `routeWarning`, and `verifiedAt`.
- **Caps**: every model-written fact is checked against `factMaxChars` /
  one line; an offender gets one rewrite (shorten or split), and if still
  over it is dropped with a `fact-dropped` warning (a distill's whole cluster
  then stays in the chronicle). Existing over-cap records that are not
  hypotheses become `recordSplit` proposals.
- **Budgets**: a green room write that would push the room past `roomMax`
  becomes yellow; a room over `roomMax` gets yellow `roomDistill` merge/cut
  proposals, keep over `keepMax` yellow `keepCut` demote/archive proposals.
- **Contradictions / promotion**, incremental: only records dated or
  re-verified on/after `lastPatrolAt`, plus the entries this patrol moves into
  rooms, each checked against keep plus its own room (rooms packed into calls
  of ≤12,000 fact characters); keep-promotion candidates are the new room
  records plus the current chronicle. `full: true`: one contradiction call
  over keep + every room, and every room record as a promotion candidate.
- Calls that need the castle share one stable "castle map" block (keep +
  room directory) sent first; the Anthropic adapter marks it
  `cache_control: ephemeral`, the others put it first in the system prompt
  for their automatic prefix caches.

Response `201`:
```json
{
  "id": "p8x2...",
  "status": "proposed",
  "createdAt": "2026-07-07",
  "mode": "incremental"|"full",
  "complete": true,
  "stats": { "llmCalls": 4, "promptChars": 5210 },
  "warnings": [{ "kind": "over-budget"|"stale"|"route-gap"|"fact-dropped", "target": "chronicle", "detail": "..." }],
  "proposals": [{ "id": "...", "kind": "roomRecord"|"roomCreate"|"contradiction"|"keepPromotion"|"chronicleSweep"|"staleReview"|"recordSplit"|"roomDistill"|"keepCut", "tier": "green"|"yellow", "summary": "...", "payload": { "...": "..." } }]
}
```

`stats.promptChars` sums the characters of context + system + user sent.
Proposal tiers follow architecture §5: green = `chronicleSweep` (reason `handover` / `orphan` / `gate`), `roomRecord`
into an existing room (unless it would overrun `roomMax`), `recordSplit` in a
room; yellow = everything touching keep, `roomCreate`, `contradiction`,
`roomDistill`, `keepCut`, and `staleReview` (the app cannot verify a fact
itself, so the user is the verifier). Distilled room records cite
`source: "chronicle:<id>,<id>"` and carry the newest source entry's date;
swept entries record `promotedTo`. Contradiction proposals are listed (and
applied) first.

### `GET /projects/:id/patrol/jobs/:jobId`

Response `200`: the same job shape. Errors: `not_found` (404). Key-optional — never calls the LLM.

### `POST /projects/:id/patrol/jobs/:jobId/apply`

Body: `{ "approvals": ["proposalId1", ...], "decisions": { "<staleReview id>": "verify"|"archive"|"delete" } }`
(both optional; omitted/empty = apply green proposals only). All `green`
proposals apply automatically; other `yellow` proposals apply only if their
`id` is in `approvals`; a `staleReview` applies only with a decision —
`verify` stamps `verifiedAt` = today, `archive` moves the record to
`archive/room-records-YYYY-MM.json`, `delete` removes it and appends one chronicle note
saying so. An approved `contradiction` sweeps a chronicle loser to its
monthly chronicle archive and moves a room or keep loser to
`archive/room-records-YYYY-MM.json` with `archiveNote: "superseded by <id>: <why>"`
— byte-for-byte the file `castle.mjs archive` writes: `{schema, month,
entries}`, `month` = the archiving month, each entry the record's own fields
then `archivedAt`, `archivedFrom` (`room:<slug>`, or `keep`), `archiveNote`.
Archive and cut decisions land there too. Pre-v0.5 `archive/records.json` /
`archive/superseded.json` files are left as they are (never auto-loaded) and
no longer written. Every write re-checks the record rules: a fact over
`factMaxChars` or multi-line is never written, and a green room write that
would now overrun `roomMax` is not applied.

Response `200`: the job with `status: "applied"` and
`applyReport: { "appliedIds": [...], "skippedYellowIds": [...], "failed": [{ "id", "reason": "not_found"|"over_budget"|"fact_too_long" }], "patrolledAt": "2026-10-28"|null }`.
A proposal whose record or chronicle entry is already gone (e.g. promoting an
entry another proposal of the job swept) is `failed` with `not_found`, never
listed as applied. Applying a `complete` job stamps `castle.json`
`lastPatrolAt` = today (`patrolledAt`), so the date trigger stops firing; a
key-less job leaves it unchanged (`patrolledAt: null`).
Errors: `not_found` (404, unknown job id), `invalid_body` (400, a decision
outside the three values). Key-optional — never calls the LLM.

---

## Import (one-time markdown → JSON)

### `POST /projects/:id/import`

Preview only — no writes. Response `200`:
```json
{ "counts": { "keep": 6, "chronicle": 16, "routes": 3, "rooms": 0, "archiveMonths": 0 }, "warnings": [{ "file": "chronicle.md", "line": 12, "text": "...", "reason": "..." }] }
```

Record lines may carry the optional 4th skeleton field `ver:`
(`- [2026-07-06 | conf:high | src:user | ver:2026-10-28] fact #tag`), imported
as `verifiedAt`. The trailing run of `#tag` tokens moves into `tags` and is
stripped from the fact; a `#` earlier in the sentence stays. A keep, chronicle,
or room record longer than 200 characters is still imported unchanged (the
importer never drops data) but produces a warning so patrol can split it.

### `POST /projects/:id/import/apply`

Applies the import: writes the JSON castle, moves the original `.md` files
to `archive/markdown-original/`. Response `201`: same shape as preview plus
`movedFiles: string[]`. Errors: `castle_exists` (409, already imported/inited).

---

## CLI reports (read-only)

- `memorycastle doctor <project-root>` — the same report as `GET /doctor`,
  one line per finding; exits 0 only when the status is `ok`.
- `memorycastle measure [project-root]` (default: current directory) —
  **estimated** token cost (CJK characters ×1 + other characters ÷4; a rough,
  labelled estimate for comparison, not a tokenizer count) of: (a) the
  session-start payload = patrol-check output + keep + last handover + one
  room (mean and max over all rooms), with records rendered as §2 one-line
  markdown, plus (a') the same over the JSON exactly as stored on disk; (b)
  the flat-file equivalent = every live record (keep + rooms + chronicle) as
  §2 lines; (c) the patrol payload; and the ratio a/b. Exits 1 when the
  directory has no castle.

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
