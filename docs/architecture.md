# MemoryCastle — Architecture v0.5 (Spatial Edition)

> A file-based memory framework for AI agents, built on the method of loci: the palace is the project's own topology, memories anchor to places, and recall is walking.
> v0.1 (2026-07-05) established the trust mechanics: admission gate, consolidation, decay, provenance. v0.2 (2026-07-06, at the user's direction) makes retrieval spatial — rooms anchor to loci instead of topics, and fixed routes guarantee complete recall. The trust mechanics are unchanged.
> v0.5 (2026-10-28, user-approved) bounds the token cost: JSON is a first-class storage format beside markdown, every record's fact is length-capped, the patrol trigger check rides on the session-start route, and session start reads only the newest handover.
> Reader: both humans and Sonnet-class models. Every rule is written to be executable by a model without further interpretation. Abstract advice is a bug.
> Language policy: authoritative docs in English; user-facing replies follow the host's language rules.

## 0. The problem, measured

Targets three measured failure modes of long-running AI-assisted work (data: 263 days, 759 sessions, one heavy user):

1. Sessions are short and fragmented — context dies with each session; rebuilding it costs more than any single task.
2. Memory that exists goes unused (a global store with 1 entry after 9 months) — no admission rule, no recall trigger, no maintenance loop, so nobody trusts it.
3. Always-loaded memory bloats until models skim it — storage without forgetting becomes noise.

v0.1's answer to "can I trust it": gatehouse, patrol, decay, provenance. v0.2's answer to "will I actually recall it": memories live where the work happens (loci), and occasions have fixed walks (routes) so nothing load-bearing is skipped. The loci method works for humans because the scaffold — a familiar space — is already memorized; for an agent+project, that scaffold already exists too: the directory tree, the subsystems, the pipeline. The palace is not a metaphor bolted on; it is the project's real shape.

## 1. The castle map (concept ↔ mechanism ↔ implementation)

| Castle term | Memory mechanism | Implementation (v0.5: markdown ／ JSON, §2) |
|---|---|---|
| **Keep** (城心, the entrance hall) | Always-loaded core; first stop of every route | `.claude/castle/keep.md` ／ `keep.json`, pointed to by the project CLAUDE.md; budget ≤30 records |
| **Rooms** (房間) | Place-anchored memory; a room owns a locus — paths, subsystems, or activities | `.claude/castle/rooms/<name>.md` with `locus:` / `adjacent:` / optional `emblem:` header lines ／ `rooms/<slug>.json` with `locus` / `adjacent` / `emblem` keys; budget ≤120 records |
| **Routes** (巡行路線) | Fixed-order walks bound to occasions; the completeness guarantee | `.claude/castle/routes.md` ／ `routes.json`; every walk ends with a mandatory count report |
| **Chronicle** (編年史) | Episodic log: raw, dated, append-only | `.claude/castle/chronicle.md` ／ `chronicle.json`; swept by patrol |
| **Archive** (檔案庫) | Cold storage; never auto-loaded | `.claude/castle/archive/` |
| **Gatehouse** (城門) | Admission rules — what may become memory | §3, enforced at write time |
| **Walls** (城牆) | Write-permission tiers | §5 |
| **Patrol** (固化巡查) | Consolidation loop; walks the patrol route | §4 |
| **Inscriptions** (銘文) | Provenance on every record: date, confidence, source, optional re-verification date | §2 |

JSON instances add `castle.json` (budgets + last patrol date). Loading rule (the anti-bloat guarantee): keep always; a room only when you stand in its locus or a route stops there; nothing else, ever.

## 2. Record format (inscriptions)

**Formats.** An instance stores all its files in exactly one format. Detection: `.claude/castle/keep.json` exists → JSON instance; else `keep.md` exists → markdown instance. Never mix: a JSON instance never gets `.md` twins (`castle-init.mjs` refuses to scaffold beside a `keep.json`). Both formats carry the same record.

Markdown — one line per record in keep, rooms, and chronicle; the 4th skeleton field is optional:

```
- [YYYY-MM-DD | conf:high|med|low | src:<origin>] <fact> #tag ⚠<route>
- [YYYY-MM-DD | conf:high|med|low | src:<origin> | ver:YYYY-MM-DD] <fact> #tag
```

JSON — one object per record, keys in this canonical order; `routeWarning` and `verifiedAt` are omitted when absent (never null):

```
{"id":"ab12cd34","date":"2026-07-08","confidence":"high","source":"user","fact":"…","tags":["build"],"routeWarning":"before-release","verifiedAt":"2026-10-28"}
```

- `date` — the day the record was written, local timezone; a patrol-distilled record takes its newest source entry's date (§4 step 2). `id` (JSON only) — 8 random lowercase base36 characters.
- `conf` / `confidence` — `high`: verified this session (ran it / read it yourself). `med`: user-stated or observed once. `low`: inferred.
- `src` / `source` — session id, "user", a file path, or a URL. A memory you can't source is a rumor; don't write it. `user` marks a standing directive (see the staleness rule). A room record distilled by patrol from chronicle entries cites them: `chronicle:<id>,<id>` (JSON).
- `ver:` / `verifiedAt` — optional; the last day the fact was re-verified (YYYY-MM-DD), stamped by the patrol's decay step (§4 step 5c).
- `#tag` / `tags` — topic or place tags. `⚠<route>` / `routeWarning` — the occasion marker below.

**Length cap (hard).** One memory per record. A fact is one line — no newline — and at most `factMaxChars` characters (default 200), counted as JavaScript string length (a CJK character counts 1). Only the fact counts; the skeleton, tags, and marker don't. A needed paragraph goes to `archive/` and the fact carries the path. A writer rejects an over-cap or multi-line fact; it never truncates.

**Budgets** are hard numbers. JSON instances keep them in `castle.json` `budgets` (a missing key means its default); markdown instances use the defaults. Count budgets count records (one record = one markdown line = one JSON record object).

| Budget | Default | Meaning |
|---|---|---|
| `keepMax` | 30 | records in keep |
| `roomMax` | 120 | records per room |
| `chronicleSweep` | 20 | chronicle entries dated after the last patrol that trigger one |
| `patrolDays` | 30 | days since the last patrol that trigger one; also the orphan age (§4 step 2) |
| `stalenessDays` | 90 | age after which a non-user record is a hypothesis |
| `factMaxChars` | 200 | characters per fact |

**JSON files** (schema 1; key order as written):

- `castle.json` = `{schema, projectName, createdAt, lastPatrolAt, budgets}` — `lastPatrolAt` is YYYY-MM-DD or null (never patrolled).
- `keep.json` = `{schema, sections: {identity: [record], constraints: [record], core: [record]}}`
- `chronicle.json` = `{schema, entries: [record]}` — oldest first; append at the end.
- `rooms/<slug>.json` = `{schema, slug, name, locus: [string], adjacent: [string], emblem: string|null, createdAt, records: [record]}`
- `routes.json` = `{schema, routes: [{name, occasion, stops: [{target, read}]}]}` — stop vocabulary in §6.
- `archive/chronicle-YYYY-MM.json` = `{schema, month, entries: [record + sweptAt]}` — swept chronicle entries, bucketed by each entry's own date month; an entry the patrol promoted also carries `promotedTo`: the room slug or `"keep"`. Written by `castle.mjs sweep` (§7).
- `archive/room-records-YYYY-MM.json` = `{schema, month, entries: [record + archivedAt + archivedFrom + archiveNote]}` — archived room records, bucketed by the month they were archived; `archivedFrom` = `room:<slug>`, `archiveNote` = why. Written by `castle.mjs archive` (§7).
- `archive/<slug>.json` = a whole archived room: its room file plus `archivedAt` and `archiveNote`.
- Markdown instances mirror these archive names with `.md`, moving record lines verbatim and appending ` — <note>` where a note is due.

**JSON serialization** (every castle JSON file): top level indented 2 spaces; every record object, every route object, and every string array (`locus`, `adjacent`, `tags`) printed compact on ONE line (`JSON.stringify(x)`, no spaces); trailing newline. Example:

```
{
  "schema": 1,
  "slug": "web-ui-rest-api-llm",
  "name": "應用程式",
  "locus": ["app/**"],
  "adjacent": [],
  "emblem": null,
  "createdAt": "2026-07-08",
  "records": [
    {"id":"ab12cd34","date":"2026-07-08","confidence":"high","source":"chronicle:x1,x2","fact":"…","tags":["app"]}
  ]
}
```

So `Grep '"locus"' rooms/*.json` returns one line per room, a keyword grep returns whole records with date and confidence, and a Grep count of `"fact":` counts records. After any JSON write, re-parse the file as the read-back.

- **Language**: castle instance files (keep, chronicle, routes, rooms) are written entirely in Traditional Chinese — headers, section names, walk reports, and record content alike; the memory palace is read by people (user directive, 2026-07-06). Only structural identifiers stay English: the `locus:` / `adjacent:` / `emblem:` keys, JSON keys, route names (`session-start` / `before-release` / `patrol`), stop `target/read` values, the `[date | conf | src | ver]` skeleton, and tags (which may be Chinese or English).
- **Occasion marker** `⚠<route-name>` (JSON: `routeWarning`, e.g. `⚠before-release`): this record is mandatory reading when that route is walked. Marker discipline: only for records whose omission causes real harm — a room full of ⚠ is a room with none.

**Staleness rule.** A record is a hypothesis if its conf is `low`, OR its source is not `user` AND today − max(date, ver/verifiedAt) > `stalenessDays` days. Source `user` records are standing directives: age alone never makes them hypotheses. Verify a hypothesis (Glob the path, run the command, check the source) before acting on it. This is what makes an old castle safe to inhabit.

## 3. Gatehouse: admission rules

Write a memory only if ALL three pass:

1. **Novelty** — not derivable in under a minute from the repo, git history, or existing docs.
2. **Reuse** — a plausible future session will need it; if rediscovery is cheap, don't store.
3. **Form** — one verifiable line with a why, at most `factMaxChars` characters, no newline (§2); decisions store as "chose X over Y because Z."

On admission, note the place: if the fact is bound to a locus, tag it with the owning room's slug (or, if no room owns it yet, with the path itself as a candidate-locus tag — patrol uses these to decide ownership and room creation).

Hard rejections (no exceptions): secrets, tokens, credentials, third-party personal data — castle files are public-to-the-team and may be committed; anything the user asked to keep out; speculation without `conf:low` + source.

What typically passes: quirks that cost >2 rounds to discover; decisions with reasons; user corrections; cross-file invariants no single file states; deploy/build orders with non-obvious steps.

## 4. Consolidation patrol

Triggers — the patrol is due when ANY holds:

1. the chronicle holds ≥ `chronicleSweep` entries dated strictly after the last patrol date (trigger 4 says where it lives); no patrol date → count every entry. Entries a patrol left in the chronicle (the newest handover, young orphans) are dated on or before it, so they never re-fire this trigger — the next patrol, fired by any trigger, picks them up;
2. any room holds > `roomMax` records;
3. keep holds > `keepMax` records;
4. today − last patrol date > `patrolDays` days. The date lives in `castle.json` `lastPatrolAt` (JSON; null fires the trigger) or in keep.md's header `上次巡查：YYYY-MM-DD` (markdown);
5. the user asks.

Triggers 1-4 are checked by the `patrol-check/due` stop that opens the session-start route (§6) — no hooks, so the check lives on a route. Cheap evaluation: read `castle.json` (JSON) or keep.md's header line (markdown) for the date and budgets. Trigger 1: list only the chronicle's dates with an only-matching Grep — JSON `"date": ?"\d{4}-\d{2}-\d{2}"` (one record per line, so one hit per entry), markdown `^- \[\d{4}-\d{2}-\d{2}` — and count those after the patrol date (YYYY-MM-DD compares as text). Triggers 2-3: a Grep count per file — JSON `"fact":`, markdown `^- \[`. Never Read a whole file to count it. The stop emits one line per fired trigger, or nothing. When a line is emitted, the walk report carries it (§6) and the session offers the patrol to the user before starting its task: run it on yes; on no, continue — it fires again next session.

The patrol IS a route (see §6) — it visits chronicle, then every room in fixed order, then keep, then the routes file itself. Walking the fixed order is what guarantees nothing is skipped. An instance not yet at v0.5 is migrated first (§7). Steps at each stop:

1. **Chronicle**: cluster unswept entries (every entry still in the chronicle file) by place (locus) first, topic second. Entries tagged `handover` never join a cluster and are never promoted (step 4 sweeps them).
2. A cluster of ≥2 related entries → distill into one record **per distinct fact** in the room whose locus owns it: merge near-duplicates into a single record, but never fuse two distinct facts into one record — §2's one-record-per-memory rule applies to consolidation output too (a compound record can't be individually cited, superseded, or contradiction-checked; amended 2026-07-09, user-approved). Distillation re-applies the §3 gate: a fact that fails novelty or reuse is not promoted — its entries are swept to archive (step 4). Every output record obeys §2: ≤ `factMaxChars`, one line; JSON room records cite their entries as `source: "chronicle:<id>,<id>"`; `date` = the newest source entry's date; `conf` by §2's definitions — `high` only when the patrol verified the fact this session, and then it also gets `verifiedAt` = today. Create a new room only when ≥3 entries share a place no existing locus covers; a new room requires a `locus` and an `adjacent` line, and must be added to the patrol route (and any route whose occasion its ⚠ records serve). A locus is a place (§6 locus rule) — an episode or milestone name ("v0.2 開發", "M9 出貨") is never a locus; such a cluster goes to the room owning the files it touched.
   - **Orphans**: a non-handover entry that joins no cluster and is older than `patrolDays` (today − date > patrolDays) → promote it as a single record to the room whose locus owns it (same gate and fields as above; green, read back); if no locus owns it, sweep it to archive. Younger orphans stay in the chronicle. A cluster too small for a new room (<3 entries) that no locus owns is not a cluster: each of its entries is an orphan.
   - **Budget guard**: if a write would take a room past `roomMax`, don't write — produce a distill/cut proposal for that room (yellow) instead.
3. Contradictions: the newer, better-sourced record wins; the loser moves to archive with a `superseded` note — a room record via `castle.mjs archive --note "superseded by <id>: <why>"`, a chronicle entry via the step 4 sweep, a keep record by proposal (yellow). Never keep both.
4. **Sweep** processed chronicle entries (distilled, promoted, failed the gate, or unowned orphans) to `archive/chronicle-YYYY-MM.json` ／ `.md`, where YYYY-MM is each entry's own date month. JSON: `node scripts/castle.mjs sweep <project-root> <id>[=<room-slug>|=keep] ...` — it stamps `sweptAt` (today) and, for `id=<target>`, `promotedTo`; never hand-edit chronicle.json. Handovers: sweep every entry tagged `handover` except the newest — the newest stays for the session-start route's `chronicle/last-handover` stop (the script refuses to sweep it). Before sweeping an older handover, check it for a decision or lesson recorded nowhere else (Grep rooms, keep, and chronicle for its key terms); if one is found, append it first as an ordinary chronicle entry (green) — a handover carries state and next step only, so its decisions must not leave with it.
5. **Each room**, in the patrol route's order:
   - a. Budget: over `roomMax` → distill/cut proposal (yellow); never a silent overrun.
   - b. Locus: check it still matches reality (paths move) and obeys the §6 locus rule; fix drift (green, read back). Once per patrol, list the project root's entries one level deep (skip dot-entries, `node_modules`, and gitignored output) and report every file or directory that no path-like locus owns; when one clearly belongs to an existing room, widen that room's locus to cover it (green, read back).
   - c. Decay: re-verify every hypothesis record (§2 staleness rule). Verified → stamp `ver:` / `verifiedAt` = today (green, read back). Disproven → delete (step 8). Unverifiable → `castle.mjs archive --note "<why>"` to `archive/room-records-YYYY-MM.json` (green, read back).
   - d. Length: a record over `factMaxChars`, or multi-line → split into one record per fact, or shorten; each result ≤ `factMaxChars` (green, read back).
6. **Keep**: over `keepMax` → propose cuts (yellow). Run 5c and 5d on keep's records: a verified record gets its `verifiedAt` stamp (green, read back); every other change — deleting a disproven record, handling an unverifiable one, splitting or shortening — is proposed to the user (yellow). The patrol date is stamped at the close, below.
7. **Routes**: does the patrol route list every room (or stop at `all-rooms`)? Do ⚠ markers reference routes that exist? Is every stop's `target/read` in the §6 vocabulary? Does every room without a path-like locus (§6) have a `room:<slug>` stop on a non-patrol route? If not, give it a path-like locus or add that stop — otherwise only activity matching reaches it, and the app's doctor reports it as `locus-unreachable`. Does `session-start` contain `patrol-check/due` and `chronicle/last-handover`? If not, add them — `castle.mjs migrate` does exactly this (§7). Fix gaps (green, read back).
8. Wrong memories (disproven): delete on the spot; one chronicle record (appended, §7) notes the deletion and why. Deletion is a feature.

Close: a completed patrol (every stop walked) sets the last patrol date to today — JSON: `castle.json` `lastPatrolAt`; markdown: keep.md's header `上次巡查：` (green, read back). A patrol abandoned midway leaves the date unchanged, so trigger 4 keeps firing. The patrol route has no `route-warnings` or `due` stop, so its walk report reads X = 0 by construction; the patrol's findings go in their own report lines: entries swept / records promoted (to where) / rooms created / contradictions resolved / deletions / archived records / unowned paths (5b) / budgets after / route gaps fixed.

Promotion path: chronicle → room (clustered by locus, or a single aged orphan) → keep (only what most sessions need; yellow). Handovers never promote. Demotion: keep → room → archive → deleted.

## 5. Walls: write permissions

- **Green** (any session): append to the chronicle (JSON instances through `castle.mjs append`, §7), including a decision or lesson rescued from a handover before its sweep (step 4); patrol steps 1, 3, 4 (including the handover sweep), 7, 8 in rooms and chronicle; sweeping an unowned orphan or a gate-failed entry to archive (step 2).
- **Green with read-back** (state it in your reply; the scripts print theirs): create/update room records during patrol — cluster distillation and single-orphan promotion (step 2), decay stamps and archiving an unverifiable or superseded room record (3, 5c), splitting or shortening an over-length room record (5d); fix locus drift or widen a locus to an unowned path (5b); add/remove stops on an existing route, including `castle.mjs migrate` (§7; it changes no record); stamp a verified keep record's `verifiedAt` (step 6); stamp the last patrol date at the close.
- **Yellow** (user consent first): any other change to keep (keep.md / keep.json) — promotion, cuts, deletion, splitting, archiving; distill/cut proposals for a room or keep over budget (step 2 guard, 5a, 6); deleting or archiving a whole room (`archive/<slug>.json`); creating or deleting a route (occasions belong to the user's workflow); changing budgets (`castle.json` `budgets`) or this architecture.
- **Red** (never, unless the user explicitly asks): admitting a §3 hard-rejected category; rewriting chronicle history.

## 6. Recall protocol: standing, walking, searching

Three recall modes, in order of preference:

1. **Standing (location-based, the default)**: before editing, determine which room's locus owns the paths or activity you're touching — load that room. Cheap read: `Grep '"locus"' rooms/*.json` (JSON) or `Grep '^locus:' rooms/*.md` (markdown) returns one line per room; then read only the owning room(s). Glance at their `adjacent` (one line each) and load a neighbor only if its name is relevant. Membership is mechanical — the locus rule:
   - A locus is a path, a glob, or an activity. It is **path-like** if it contains `/` or `*`, or the whole entry is a file name whose extension starts with a letter (`docs/architecture.md`, `app/**`, `*.sql`, `README.md` — but not `v0.1`); anything else is an activity locus (`部署流程`), owned by doing that activity, never by a path. Episode or milestone names ("v0.2 開發", "M9 出貨") are not loci.
   - Path matching normalizes both the touched path and the locus: backslash → slash; an absolute path is made relative to the project root (a path outside the root never matches); a leading `./` is stripped; comparison is case-insensitive. A path-like locus without `*` owns that path and everything below it. `*` matches within one path segment; `**` matches zero or more whole segments — `**/x` matches `x` and `a/b/x` but never `barx`.
   - A room with no path-like locus is reachable only by activity matching or an explicit `room:<slug>` stop.
2. **Walking (occasion-based)**: occasions bind to routes in the routes file. Session start → migrate first if the instance is not yet at v0.5 (§7), then walk `session-start`. The user says release/deploy/上線 → walk `before-release`. A patrol is due and the user agrees → walk `patrol`. A walk visits every stop in its fixed order and reads exactly what the stop prescribes.
   - A stop is a `target` plus a `read` (JSON `{"target","read"}`; markdown writes them as `target/read` in the stop line). Targets: `keep`, `chronicle`, `routes`, `rooms-by-locus` (the rooms whose locus owns the session's paths), `all-rooms` (every room, slug order), `room:<slug>`, `patrol-check`. Reads: `all`; `section:identity|constraints|core` (keep only); `route-warnings` (only records marked ⚠ for the route being walked); `last-handover` (chronicle only: the newest entry tagged `handover`, or, in legacy entries, with `#handover` in the fact; same-day ties go to the later entry — JSON: the last line matching `"handover"|#handover`; markdown: the last line matching `^- \[.*#handover`); `due` (patrol-check only: one line per fired §4 trigger 1-4, or nothing; `patrol-check/all` behaves the same). Any other target, read, or pairing is invalid: the stop counts as skipped and the walk is invalid.
   - Default session-start route, in order: `patrol-check/due` → `keep/all` → `chronicle/last-handover` → `rooms-by-locus/all`.
   - Deferred stop: when no paths are known yet (typical at session start), `rooms-by-locus` is deferred — neither passed nor skipped; its rooms load at the first file touch by standing (mode 1). When paths are known but some match no room's locus, report those paths as unmatched.
   - The walk MUST end with the report **"巡行 N/N 房，發現 X 項注意"**: N = room stops visited / room stops in the walk, after expanding `rooms-by-locus` and `all-rooms` into one stop per room; X counts what the stops read: route-warning records + fired patrol-trigger lines (a route without such stops, like `patrol`, reports its findings in its own lines — §4 close). Append "；延後 N 站" (N = deferred stops, normally 1) when `rooms-by-locus` was deferred, and "；無對應房間：<paths>" (root-relative, joined with 、) when any path was unmatched. Then list the noteworthy lines. A skipped stop of any kind is a detectable miss, not a silent omission — the walk is invalid; redo it.
3. **Searching (keyword fallback)**: topic questions with no location — grep the chronicle and rooms for the tag/keyword; with one record per line, each hit is a whole record.

Plus always: mid-task capture passes the gatehouse and lands in the chronicle immediately (sessions die; don't batch) — JSON through `castle.mjs append` (§7) so the chronicle is never read into context; markdown by appending the §2 line. Decisions and lessons are captured as their own entries, never only inside a handover. Session end or before a risky step: append the handover as one record holding state and next step only, `狀態：…／下一步：…` tagged `handover`, within `factMaxChars` like any record. The §2 staleness rule applies to everything recalled.

## 7. Instance layout and installation

An instance lives inside the host project — committed with it; memory becomes team memory and survives machines (the deliberate opposite of per-machine stores). One format per instance (§2):

```
<project>/.claude/castle/
  markdown           JSON
  keep.md            keep.json         # ≤30 records; the entrance hall
  —                  castle.json       # budgets + lastPatrolAt
  chronicle.md       chronicle.json    # append-only episodic log
  routes.md          routes.json       # fixed walks: session-start / before-release / patrol
  rooms/<name>.md    rooms/<slug>.json # place-anchored memory with a locus
  archive/           archive/          # cold storage
```

Install a markdown instance: `node scripts/castle-init.mjs <project-root>` scaffolds the left column; it refuses when `keep.md` or `keep.json` already exists. JSON instances are created or migrated by the MemoryCastle app (`app/`: `memorycastle init <dir>`, or `memorycastle import <dir> --apply` from markdown, which keeps the originals under `archive/markdown-original/`). Then add one row to the project's CLAUDE.md routing table, naming the instance's actual files:

```
| Any task in this repo | read .claude\castle\keep.md, walk the session-start route in .claude\castle\routes.md, and load rooms whose locus owns the files you touch |
| Any task in this repo | read .claude\castle\keep.json, walk the session-start route in .claude\castle\routes.json, and load rooms whose locus owns the files you touch |
```

(first row: markdown; second row: JSON — use exactly one.)

Deterministic operations — `node scripts/castle.mjs <command> <project-root> …` — do the mechanical writes so a model never reads or hand-rewrites the chronicle or the archive. Each writes JSON in the §2 serialization through a temp file + rename, re-parses what it wrote as the read-back, exits non-zero on bad input without writing anything, and prints a short confirmation — never file contents:

- `append --conf high|med|low --src <src> [--tags a,b] [--warn <route>] "<fact>"` (either format) — one record: JSON to `chronicle.json` with a fresh id and today's local date; markdown as one §2 line to `chronicle.md`. Rejects a fact over `factMaxChars`, a fact containing a newline, and a `--warn` naming no existing route.
- `migrate` (either format) — upgrades a pre-v0.5 instance: reformats every JSON file (castle, keep, chronicle, routes, rooms/, archive/) to the §2 serialization, writes the default `factMaxChars` when it is missing, and adds `patrol-check/due` (first) and `chronicle/last-handover` (after the keep stop) to a `session-start` route that lacks them (markdown: the routes.md stop lines). It never changes a record and never creates a route; it reports how many records exceed `factMaxChars` (step 5d splits them). Idempotent.
- `sweep <id>[=<room-slug>|=keep] ...` (JSON) — §4 step 4: moves the entries to `archive/chronicle-YYYY-MM.json` by their date month with `sweptAt` (and `promotedTo`); refuses unknown ids, unknown rooms, and the newest handover.
- `archive --note "<why>" <room-record-id> ...` (JSON) — §4 steps 3/5c: moves room records to `archive/room-records-YYYY-MM.json` for the current month with `archivedAt`, `archivedFrom`, `archiveNote`.

Upgrading a pre-v0.5 instance: the routes file has no `patrol-check` stop, or (JSON) `castle.json` has no `factMaxChars` → run `castle.mjs migrate` before anything else. It must come first: until the JSON is reformatted, a Grep for a record returns only a fragment of it.

Room granularity guidance: follow the system's natural landmarks — modules/subsystems, plus a few activity loci (the deploy corridor, the environment room). 5-12 rooms is typical. One room per directory is taxonomy disease; a room should be a place someone would say they are "in."

## 8. Design decisions and rejected alternatives

- **Loci over topics** (v0.2): rooms anchor to places in the project's real topology because place-membership is decidable ("which locus owns the paths I'm touching"), while topic-membership needs semantic guessing. Rejected: v0.1's topic rooms — topics survive only as #tags on lines.
- **Routes over ad-hoc recall** (v0.2): fixed-order walks with a mandatory count report turn "forgot to check a memory file" from a silent omission into a detectable miss. Rejected: reminder hooks — automation stays opt-in and later (see below).
- **Emblem optional**: vivid imagery is the loci method's encoding trick for humans; models don't need it, teammates reading committed castle files do. One optional line, never required.
- **Admission gate over store-everything**: retrieval-ranking (vector stores) optimizes finding; the measured problem is trusting. A small, curated, provenance-carrying store beats a large fuzzy one for agent reliability. Vector recall may later index the archive — the gate still guards rooms and keep.
- **Files over database**: memory must be reviewable in a diff, hand-editable, zero-infrastructure. A DB hides rot; files expose it.
- **One-line records over prose**: distillation at write time; prose hides duplication and drift.
- **Model-executed patrol over cron/hook automation**: the host environment paid a measured 34-52% context tax to an over-eager hook pack; MemoryCastle will not repeat that. Automation is opt-in in a later version and must be silent-on-success.
- **Budgets with hard numbers over "keep it concise"**: models need thresholds, not adjectives. 30 (keep) / 120 (room) / 20 (chronicle sweep) / 30 days (patrol) / 90 days (staleness) / 200 characters (fact) are starting values; tuning is yellow.
- **Per-record length cap** (v0.5): budgets count records, so only a cap on each record turns the count into a token bound (keep ≤ 30 × 200 characters). Markdown's one-line rule was the implicit cap; JSON strings have no line to end, and this repo's own castle grew records past 800 characters. Rejected: truncating on write (silently drops the why) and per-file character budgets (a writer can't check them before appending).
- **Compact one-line JSON** (v0.5): one record per line keeps grep exact — a keyword hit is a whole record with its date and confidence, `"locus"` yields one line per room, a count of `"fact":` counts records — and cuts each record's structural overhead roughly in half (measured on this repo's castle: ~50 → ~28 estimated tokens per record). Rejected: fully pretty-printed JSON (a grep hit returns one field without its provenance) and JSON Lines (breaks the single-document schema).
- **Patrol check on the session-start route** (v0.5): with no hooks, a trigger nobody evaluates never fires — this repo's castle sat at `lastPatrolAt` 2026-07-06 for 16 weeks against a 30-day trigger. The check therefore lives where every session already walks, and costs one tiny file read plus Grep counts. Rejected: a SessionStart hook (the automation rule above) and trusting the model to recall §4 unprompted (the measured failure).
- **Handovers never promoted** (v0.5): a handover is session state ("next step: X"), true only until the next session acts on it; promoted into a room it becomes a stale instruction that looks like knowledge — this repo's first patrol fused handovers into compound room records. Session start reads only the newest; the patrol archives the rest. Rejected: clustering handovers like other entries.
- **Deterministic file operations in a script** (v0.5): append, migrate, sweep, and archive are mechanical — a script does them without the model reading the chronicle or the archive (both grow without bound) and can't leave a half-edited JSON file. Judgment (what to promote, what is disproven) stays with the model. Rejected: model hand-edits of those files (token cost grows with the file; one bad edit corrupts the castle).
- **English for the framework spec and skill only**: instruction-following precision for the models operating the framework. Generated castle instances are entirely Traditional Chinese, because the palace is for the team to read (user directive, 2026-07-06).

## 9. Roadmap

- v0.3 — opt-in automation: SessionStart route reminder, Stop-hook handover prompt (both silent-on-success); the `castle` skill packaged as a plugin.
- v0.4 — SDK (TypeScript): programmatic read/write/walk/patrol API; archive indexing (search, optional embeddings); multi-castle federation (global user castle + per-project castles with promotion between them).
  - **Landed 2026-07-07** as `app/`: local Web UI + REST API (localhost) + Anthropic/Gemini/OpenAI adapters + JSON document storage + one-time markdown importer; budgets re-specified as record counts the same day (user-approved).
- v0.5 — token tightening (2026-10-28, user-approved). **Landed in the spec, skill, templates, and scripts**: JSON as a first-class format and its compact serialization (§2, §7); `factMaxChars`, `ver:` / `verifiedAt`, and the user-directive staleness exemption (§2); `patrol-check/due`, `chronicle/last-handover`, the deferred `rooms-by-locus` stop, and the locus rule (§6); handover sweep, orphan promotion, decay stamps, over-budget proposals, unowned-path report, and the last-patrol stamp (§4, §5); archive formats (§2); `castle.mjs` append / migrate / sweep / archive and the upgrade step (§7); a self-contained skill — routine session start, recall, capture, and handover no longer read this document. App conformance and the migration of this repo's own instance land separately.
- Parked deliberately: the cross-project global castle — the host's CLAUDE.md/playbook already serves that role by hand; generalize only after per-project castles prove the loop.
