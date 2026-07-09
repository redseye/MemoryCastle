---
name: castle
description: Operate a MemoryCastle instance in the current project — initialize it, write memories through the admission gate, recall by standing (locus) or walking (routes), run the consolidation patrol. Use when the user says 記住/remember/recall/consolidate memory, mentions release/deploy/上線 (walk before-release), or asks to set up project memory.
---

# Castle — operating procedure (v0.2, spatial)

You are operating a MemoryCastle instance: file-based project memory at `.claude/castle/` (keep.md + chronicle.md + routes.md + rooms/ + archive/). Full rules: docs\architecture.md — read §2-§6 the first time you touch a castle in a session. (Paths in this file are relative to the MemoryCastle repository root.) Language: castle instance files (keep/chronicle/routes/rooms) are written entirely in Traditional Chinese — headers, section names, and records alike (architecture §2); only structural identifiers stay English (locus:/adjacent:/emblem: keys, route names, the [date|conf|src] skeleton, tags). These instructions and the architecture spec stay English.

## If the argument is "init" (or no castle exists yet)

1. Run: `node scripts\castle-init.mjs <project-root>` (relative to the MemoryCastle repository root)
2. Read back the scaffolded files; fill keep.md's Identity placeholders (ask the user for the one-line identity if you cannot state it). rooms/ starts empty — rooms are born from patrol clustering, not invented up front.
3. Add the routing row to the project's CLAUDE.md (create the file if missing):
   `| Any task in this repo | read .claude\castle\keep.md, walk the session-start route in .claude\castle\routes.md, and load rooms whose locus owns the files you touch |`
4. Report: paths created + the CLAUDE.md row added.

## If asked to remember something (記住 X)

1. Gatehouse check (§3): novel + reusable + one verifiable line. If it fails, say which test failed and don't write. Secrets or third-party personal data: refuse — red-tier, castle files are public-to-the-team.
2. Append ONE line to chronicle.md in §2 format `- [date | conf | src] fact #tag`. Confidence: `high` = you verified it this session; `med` = user-stated or observed once; `low` = inferred. If the fact is place-bound, use the owning room's tag (or a candidate locus tag if no room owns it yet). If missing it at an occasion would cause harm, add `⚠<route-name>`. Write the fact content in Traditional Chinese, e.g. `- [2026-07-06 | conf:med | src:user] build 前必須先跑 codegen，否則會拿到舊型別 #build`.
3. Reply with the exact line written. Write at the moment of capture — never batch.

## If recall is needed (X 是什麼 / what do we know about X)

Three modes, prefer them in order:
1. **Standing**: the question or task points at files/activity → Glob `rooms/*.md`, read each file's `locus:` line only, load the room(s) whose locus owns those paths; glance at their `adjacent:` lines and load a neighbor only if clearly relevant.
2. **Walking**: the question matches an occasion → walk that route in routes.md (see below).
3. **Searching**: no location — Grep chronicle.md and rooms/ for the tag/keyword.
Staleness rule: anything >90 days or conf:low is a hypothesis — verify before presenting as fact; show date+conf for what you can't verify. Nothing found → say "castle has no memory of this" — never invent.

## Walking a route (session start / release / patrol / user asks to 巡行)

1. Open routes.md, find the route bound to the occasion: session start → `session-start`; user says release/deploy/上線 → `before-release`; patrol triggers → `patrol`.
2. Visit every stop in the listed order; at each stop read exactly what it prescribes (often only ⚠<route> lines).
3. End with the mandatory report: 「巡行 N/N 房，發現 X 項注意」＋ the noteworthy lines. If you skipped a stop, the walk is invalid — redo it.

## If asked to consolidate (or a patrol trigger fires)

Triggers: chronicle ≥20 unswept entries; any room >120 records; keep >30 records; last patrol >30 days ago (date in keep's header); user asks.
Walk the `patrol` route and execute architecture §4 steps 1-8. Three hard points:
- Cluster chronicle entries by locus first; create a new room only for ≥3 entries sharing an unowned place — new room needs `locus:` + `adjacent:` lines AND a stop on the patrol route.
- Contradictions: newest best-sourced line wins; loser goes to archive with a `superseded` note. Never keep both.
- keep.md changes are yellow: propose the diff, get consent, then write.
Report: entries swept / lines promoted (to which room) / rooms created / contradictions resolved / deletions / budgets after / route-map gaps fixed.

## Always

- Session end, or before a risky step: append the 3-line handover to chronicle: `狀態：…／決定：…／下一步：… #handover`.
- Every write is followed by a read-back of the written line.
- Castle files may be committed and read by teammates: write every line as if public-to-the-team.
