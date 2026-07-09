# MemoryCastle — Architecture v0.2 (Spatial Edition)

> A file-based memory framework for AI agents, built on the method of loci: the palace is the project's own topology, memories anchor to places, and recall is walking.
> v0.1 (2026-07-05) established the trust mechanics: admission gate, consolidation, decay, provenance. v0.2 (2026-07-06, at the user's direction) makes retrieval spatial — rooms anchor to loci instead of topics, and fixed routes guarantee complete recall. The trust mechanics are unchanged.
> Reader: both humans and Sonnet-class models. Every rule is written to be executable by a model without further interpretation. Abstract advice is a bug.
> Language policy: authoritative docs in English; user-facing replies follow the host's language rules.

## 0. The problem, measured

Targets three measured failure modes of long-running AI-assisted work (data: 263 days, 759 sessions, one heavy user):

1. Sessions are short and fragmented — context dies with each session; rebuilding it costs more than any single task.
2. Memory that exists goes unused (a global store with 1 entry after 9 months) — no admission rule, no recall trigger, no maintenance loop, so nobody trusts it.
3. Always-loaded memory bloats until models skim it — storage without forgetting becomes noise.

v0.1's answer to "can I trust it": gatehouse, patrol, decay, provenance. v0.2's answer to "will I actually recall it": memories live where the work happens (loci), and occasions have fixed walks (routes) so nothing load-bearing is skipped. The loci method works for humans because the scaffold — a familiar space — is already memorized; for an agent+project, that scaffold already exists too: the directory tree, the subsystems, the pipeline. The palace is not a metaphor bolted on; it is the project's real shape.

## 1. The castle map (concept ↔ mechanism ↔ implementation)

| Castle term | Memory mechanism | Implementation (v0.2) |
|---|---|---|
| **Keep** (城心, the entrance hall) | Always-loaded core; first stop of every route | `.claude/castle/keep.md`, pointed to by the project CLAUDE.md; budget ≤30 records |
| **Rooms** (房間) | Place-anchored memory; a room owns a locus — paths, subsystems, or activities | `.claude/castle/rooms/<name>.md` with `locus:` / `adjacent:` / optional `emblem:` header lines; budget ≤120 records |
| **Routes** (巡行路線) | Fixed-order walks bound to occasions; the completeness guarantee | `.claude/castle/routes.md`; every walk ends with a mandatory count report |
| **Chronicle** (編年史) | Episodic log: raw, dated, append-only | `.claude/castle/chronicle.md`; swept by patrol |
| **Archive** (檔案庫) | Cold storage; never auto-loaded | `.claude/castle/archive/` |
| **Gatehouse** (城門) | Admission rules — what may become memory | §3, enforced at write time |
| **Walls** (城牆) | Write-permission tiers | §5 |
| **Patrol** (固化巡查) | Consolidation loop; walks the patrol route | §4 |
| **Inscriptions** (銘文) | Provenance on every line: date, confidence, source | §2 |

Loading rule (the anti-bloat guarantee): keep always; a room only when you stand in its locus or a route stops there; nothing else, ever.

## 2. Record format (inscriptions)

Every memory line in keep, rooms, and chronicle:

```
- [YYYY-MM-DD | conf:high|med|low | src:<origin>] <fact, one line> #tag
```

- `conf` — `high`: verified this session (ran it / read it yourself). `med`: user-stated or observed once. `low`: inferred.
- `src` — session id, "user", a file path, or a URL. A memory you can't source is a rumor; don't write it.
- One line per memory; a needed paragraph goes to `archive/` and the line carries the path.
- **Language**: castle instance files (keep, chronicle, routes, rooms) are written entirely in Traditional Chinese — headers, section names, walk reports, and record content alike; the memory palace is read by people (user directive, 2026-07-06). Only structural identifiers stay English: the `locus:` / `adjacent:` / `emblem:` keys, route names (`session-start` / `before-release` / `patrol`), the `[date | conf | src]` skeleton, and tags (which may be Chinese or English).
- **Occasion marker** `⚠<route-name>` (e.g. `⚠before-release`): this line is mandatory reading when that route is walked. Marker discipline: only for lines whose omission causes real harm — a room full of ⚠ is a room with none.

Staleness rule: any line older than 90 days or marked `conf:low` is a hypothesis — verify (Glob the path, run the command, check the source) before acting on it. This is what makes an old castle safe to inhabit.

## 3. Gatehouse: admission rules

Write a memory only if ALL three pass:

1. **Novelty** — not derivable in under a minute from the repo, git history, or existing docs.
2. **Reuse** — a plausible future session will need it; if rediscovery is cheap, don't store.
3. **Form** — one verifiable line with a why; decisions store as "chose X over Y because Z."

On admission, note the place: if the fact is bound to a locus, end the line with the owning room's tag (or a candidate locus if no room owns it yet — patrol uses these to decide room creation).

Hard rejections (no exceptions): secrets, tokens, credentials, third-party personal data — castle files are public-to-the-team and may be committed; anything the user asked to keep out; speculation without `conf:low` + source.

What typically passes: quirks that cost >2 rounds to discover; decisions with reasons; user corrections; cross-file invariants no single file states; deploy/build orders with non-obvious steps.

## 4. Consolidation patrol

Triggers — run when ANY holds: chronicle ≥20 unswept entries; any room >120 records or keep >30 records; last patrol >30 days ago (date in keep's header); the user asks.

The patrol IS a route (see §6) — it visits chronicle, then every room in fixed order, then keep, then routes.md itself. Walking the fixed order is what guarantees nothing is skipped. Steps at each stop:

1. **Chronicle**: cluster unswept entries by place (locus) first, topic second.
2. A cluster of ≥2 related entries → distill into one line **per distinct fact** in the room whose locus owns it: merge near-duplicates into a single line, but never fuse two distinct facts into one record — §2's one-line-per-memory rule applies to consolidation output too (a compound record can't be individually cited, superseded, or contradiction-checked; amended 2026-07-09, user-approved). Create a new room only when ≥3 entries share a place no existing locus covers; a new room requires `locus:` and `adjacent:` lines, and must be added to the patrol route (and any route whose occasion its ⚠ lines serve).
3. Contradictions: the newer, better-sourced line wins; the loser moves to archive with a `superseded` note. Never keep both.
4. Sweep processed chronicle entries to `archive/chronicle-YYYY-MM.md`.
5. **Each room**: over 120 records → distill, push detail to archive. Check its `locus:` still matches reality (paths move); fix if drifted (green, read back).
6. **Keep**: over 30 records → propose cuts to the user (yellow). Update patrol date in its header.
7. **Routes**: does the patrol route list every room? Do ⚠ markers reference routes that exist? Fix gaps (green, read back).
8. Wrong memories (disproven): delete on the spot; one chronicle line records the deletion and why. Deletion is a feature.

Promotion path: chronicle → room (clustered by locus) → keep (only what most sessions need; yellow). Demotion: keep → room → archive → deleted.

## 5. Walls: write permissions

- **Green** (any session): append to chronicle; patrol steps 1-5, 7, 8.
- **Green with read-back** (state it in your reply): create/update room lines during patrol; fix locus drift; add/remove stops on an existing route.
- **Yellow** (user consent first): anything touching keep.md; deleting a room; creating or deleting a route (occasions belong to the user's workflow); changing budgets or this architecture.
- **Red** (never, unless the user explicitly asks): admitting a §3 hard-rejected category; rewriting chronicle history.

## 6. Recall protocol: standing, walking, searching

Three recall modes, in order of preference:

1. **Standing (location-based, the default)**: before editing, determine which room's locus owns the paths or activity you're touching — load that room. Glance at its `adjacent:` line (one line each) and load a neighbor only if its name is relevant. Membership is mechanical: "which locus owns these paths" needs no semantic guessing.
2. **Walking (occasion-based)**: occasions bind to routes in routes.md. Session start → walk `session-start`. The user says release/deploy/上線 → walk `before-release`. Patrol triggers → walk `patrol`. A walk visits every stop in its fixed order, reads what the stop prescribes (often only ⚠ lines), and MUST end with the report: **"巡行 N/N 房，發現 X 項注意"**. Skipping a stop is a detectable miss, not a silent omission — that is the point of routes.
3. **Searching (keyword fallback)**: topic questions with no location — grep chronicle and rooms for the tag/keyword.

Plus always: mid-task capture passes the gatehouse and lands in chronicle immediately (sessions die; don't batch). Session end or before a risky step: append the 3-line handover: `狀態：…／決定：…／下一步：… #handover`. The §2 staleness rule applies to everything recalled.

## 7. Instance layout and installation

An instance lives inside the host project — committed with it; memory becomes team memory and survives machines (the deliberate opposite of per-machine stores):

```
<project>/.claude/castle/
  keep.md            # ≤30 records; the entrance hall
  chronicle.md       # append-only episodic log
  routes.md          # fixed walks: session-start / before-release / patrol
  rooms/<name>.md    # place-anchored memory, locus: header
  archive/           # cold storage
```

Install: `node scripts/castle-init.mjs <project-root>` scaffolds the above, then add one row to the project's CLAUDE.md routing table:

```
| Any task in this repo | read .claude\castle\keep.md, walk the session-start route in .claude\castle\routes.md, and load rooms whose locus owns the files you touch |
```

Room granularity guidance: follow the system's natural landmarks — modules/subsystems, plus a few activity loci (the deploy corridor, the environment room). 5-12 rooms is typical. One room per directory is taxonomy disease; a room should be a place someone would say they are "in."

## 8. Design decisions and rejected alternatives

- **Loci over topics** (v0.2): rooms anchor to places in the project's real topology because place-membership is decidable ("which locus owns the paths I'm touching"), while topic-membership needs semantic guessing. Rejected: v0.1's topic rooms — topics survive only as #tags on lines.
- **Routes over ad-hoc recall** (v0.2): fixed-order walks with a mandatory count report turn "forgot to check a memory file" from a silent omission into a detectable miss. Rejected: reminder hooks — automation stays opt-in and later (see below).
- **Emblem optional**: vivid imagery is the loci method's encoding trick for humans; models don't need it, teammates reading committed castle files do. One optional line, never required.
- **Admission gate over store-everything**: retrieval-ranking (vector stores) optimizes finding; the measured problem is trusting. A small, curated, provenance-carrying store beats a large fuzzy one for agent reliability. Vector recall may later index the archive — the gate still guards rooms and keep.
- **Files over database**: memory must be reviewable in a diff, hand-editable, zero-infrastructure. A DB hides rot; files expose it.
- **One-line records over prose**: distillation at write time; prose hides duplication and drift.
- **Model-executed patrol over cron/hook automation**: the host environment paid a measured 34-52% context tax to an over-eager hook pack; MemoryCastle will not repeat that. Automation is opt-in in a later version and must be silent-on-success.
- **Budgets with hard numbers over "keep it concise"**: models need thresholds, not adjectives. 30 (keep) / 120 (room) / 20 (chronicle sweep) / 30 days (patrol) / 90 days (staleness) are starting values; tuning is yellow.
- **English for the framework spec and skill only**: instruction-following precision for the models operating the framework. Generated castle instances are entirely Traditional Chinese, because the palace is for the team to read (user directive, 2026-07-06).

## 9. Roadmap (not in scope for v0.2)

- v0.3 — opt-in automation: SessionStart route reminder, Stop-hook handover prompt (both silent-on-success); the `castle` skill packaged as a plugin.
- v0.4 — SDK (TypeScript): programmatic read/write/walk/patrol API; archive indexing (search, optional embeddings); multi-castle federation (global user castle + per-project castles with promotion between them).
  - **Landed 2026-07-07** as `app/`: local Web UI + REST API (localhost) + Anthropic/Gemini/OpenAI adapters + JSON document storage + one-time markdown importer; budgets re-specified as record counts the same day (user-approved).
- Parked deliberately: the cross-project global castle — the host's CLAUDE.md/playbook already serves that role by hand; generalize only after per-project castles prove the loop.
