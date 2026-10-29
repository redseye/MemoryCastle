---
name: castle
description: Operate a MemoryCastle instance in the current project — initialize it, write memories through the admission gate, recall by standing (locus) or walking (routes), run the consolidation patrol. Use when the user says 記住/remember/recall/consolidate memory, mentions release/deploy/上線 (walk before-release), or asks to set up project memory.
---

# Castle — operating procedure (v0.5, spatial)

MemoryCastle = file-based project memory in `<project-root>/.claude/castle/`. This file covers session start, recall, capture, and handover on its own; read `<mc-root>/docs/architecture.md` §4-§5 only for a patrol, all of it only to change the rules. `<mc-root>` = the MemoryCastle repository root (holds docs/, scripts/, templates/). Instance files are Traditional Chinese; structural identifiers (keys, route names, `target/read`, record skeleton, tags) stay English.

## Format — detect first

`keep.json` exists → **JSON**: touch only `*.json`, never create `.md` twins. Else `keep.md` → **markdown**. Neither → Init.
**Pre-v0.5** (Grep: routes file has no `patrol-check`, or castle.json no `factMaxChars`) → first run `node "<mc-root>/scripts/castle.mjs" migrate <project-root>` (green: JSON → one record per line, missing default + session-start stops added, no record changed); report its output.
- md record: `- [YYYY-MM-DD | conf:high|med|low | src:<origin>] <fact> #tag ⚠<route>`; optional 4th field `| ver:YYYY-MM-DD` = last re-verified.
- JSON record, one per line: `{"id","date","confidence","source","fact","tags":[],"routeWarning"?,"verifiedAt"?}` in `keep.json` sections identity/constraints/core, `chronicle.json` entries, `rooms/<slug>.json` records (plus locus, adjacent). `routes.json` routes → stops `{target, read}`. `castle.json` holds lastPatrolAt + budgets.
- Budgets (JSON: castle.json, missing = default; md: defaults): keepMax 30, roomMax 120, chronicleSweep 20, patrolDays 30, stalenessDays 90 — all record counts — and factMaxChars 200.
- conf: high = verified this session; med = user-stated or observed once; low = inferred. src: session id, user, file path, or URL.
- **Hypothesis** = conf low, OR (src ≠ user AND today − max(date, ver) > stalenessDays). Verify before acting; if you can't, show date+conf.

## Walking a route

Session start → walk `session-start`, right after format detection; release/deploy/上線 → `before-release`; patrol → `patrol`. Visit every stop in order; read exactly what it says:
- `patrol-check/due` (or `/all`): read castle.json (md: keep.md's `上次巡查：` header) for the last patrol date P. Chronicle: only-matching Grep `"date": ?"\d{4}-\d{2}-\d{2}"` (md `^- \[\d{4}-\d{2}-\d{2}`), count dates > P (no P → all). Rooms, keep: Grep count `"fact":` (md `^- \[`) per file. Never Read to count. One line per fired trigger: that chronicle count ≥ chronicleSweep; a room > roomMax; keep > keepMax; days since P > patrolDays (no P = fired). None → nothing.
- `keep/all`: keep file. `keep/section:<identity|constraints|core>`: that section.
- `chronicle/last-handover`: Grep `"handover"|#handover` (md `^- \[.*#handover`) in the chronicle; use only the last hit. Never Read the whole chronicle.
- `rooms-by-locus/all`: no paths known yet → **defer** (neither passed nor skipped) — rooms load at first file touch (Standing). Paths known → load owning rooms; note paths no locus owns.
- `<target>/route-warnings`: only records with `"routeWarning":"<this route>"` (md `⚠<this route>`). `room:<slug>`, `all-rooms`, `chronicle/all`, `routes/all`: read in full.
- Any other target/read → stop skipped → walk invalid.
- A Grep hit shown as omitted (long line) → Read only that line (offset = its line number, limit 1).

End with 「巡行 N/N 房，發現 X 項注意」: N = room stops visited/total (rooms-by-locus, all-rooms expand to one stop per room); X = route-warning records + fired triggers; append 「；延後 N 站」 (deferred stops), 「；無對應房間：a、b」 (unmatched root-relative paths) if any; then the noteworthy lines. Trigger fired → ask the user whether to patrol now; no → go on (it fires again next session).

## Standing recall (before touching files)

`Grep '"locus"' rooms/*.json` (md `Grep '^locus:' rooms/*.md`) → one line per room. Normalize the path: `\`→`/`, relative to project root (outside → no match), strip `./`, case-insensitive. Path-like locus = has `/` or `*`, or is a file name with a letter-led extension (`README.md`, not `v0.1`): without `*` it owns that path and all below; `*` = one segment, `**` = zero or more (`**/x` matches `x`, `a/b/x`, never `barx`). Other loci are activities — match what you are doing. Load only owning rooms; an `adjacent` one only if clearly relevant.
No location: occasion → its route; else Grep chronicle + rooms for the keyword (each hit is a whole record). Nothing → "castle has no memory of this"; never invent.

## Capture (記住 X) — at the moment, never batch

1. Gatehouse: novel (not derivable in <1 min from repo/git/docs) + reusable + one verifiable line with a why, ≤ factMaxChars chars, no newline. Fails → say which test; don't write. Secrets, credentials, third-party personal data → refuse (red; castle files are public-to-the-team).
2. `node "<mc-root>/scripts/castle.mjs" append <project-root> --conf high|med|low --src <src> [--tags a,b] [--warn <route>] "<fact>"` — mandatory for JSON (never Read/rewrite chronicle.json yourself); md may append the line directly. Place-bound → add the owning room's `slug` as a tag (no room owns it yet → the path itself, e.g. `app/src/x.ts`, as a candidate-locus tag). `--warn` only if missing it at that occasion causes harm. Too long → one fact per record, or detail to `archive/` with its path in the fact. Decisions and lessons get their own records, never only a handover.
3. Reply with the printed confirmation line (the read-back).

## Handover

Session end or before a risky step: capture `狀態：…／下一步：…` (state and next step only; capture decisions first) with `--tags handover --conf high --src session`, ≤ factMaxChars. Next session reads only the newest.

## Init

`node "<mc-root>/scripts/castle-init.mjs" <project-root>` (markdown; refuses over any castle). Fill keep.md's identity (ask the user if unsure); rooms start empty. Add to the project CLAUDE.md: `| Any task in this repo | read .claude\castle\keep.md, walk the session-start route in .claude\castle\routes.md, and load rooms whose locus owns the files you touch |` (JSON: keep.json / routes.json). Report paths + row.

## Patrol (user agreed or asked to consolidate)

Read architecture §4-§5, walk `patrol`, run §4 steps 1-8 and the close. Never cluster/promote handovers; one record per distinct fact, each ≤ factMaxChars; move chronicle entries only with `castle.mjs sweep`, room records only with `castle.mjs archive` (§7); keep changes and budget overruns are proposals (yellow); a completed patrol stamps lastPatrolAt (md: keep header). Report with the §4 close lines.

## Always

Read back every write (JSON: re-parse) and say so.
