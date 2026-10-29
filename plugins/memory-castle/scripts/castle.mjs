#!/usr/bin/env node
// castle.mjs — the deterministic castle operations, so a model never reads or
// hand-rewrites the chronicle or the archive (architecture §2, §4, §7).
// Usage:
//   node castle.mjs append  <project-root> --conf high|med|low --src <src> [--tags a,b] [--warn <route>] "<fact>"
//   node castle.mjs migrate <project-root>
//   node castle.mjs sweep   <project-root> <entry-id>[=<room-slug>|=keep] ...
//   node castle.mjs archive <project-root> --note "<why>" <room-record-id> ...
// Zero dependencies. JSON writes use the compact one-record-per-line form
// (architecture §2) through a temp file + rename, then re-parse as the
// read-back. Prints a short confirmation, never file contents. UTF-8 throughout.

import { readFileSync, writeFileSync, renameSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const usage = [
  'Usage: ／ 用法：',
  '  node castle.mjs append  <project-root> --conf high|med|low --src <src> [--tags a,b] [--warn <route>] "<fact>"',
  '  node castle.mjs migrate <project-root>',
  '  node castle.mjs sweep   <project-root> <entry-id>[=<room-slug>|=keep] ...',
  '  node castle.mjs archive <project-root> --note "<why>" <room-record-id> ...',
].join('\n');
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const [cmd, ...args] = process.argv.slice(2);
const opts = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (['--conf', '--src', '--tags', '--warn', '--note'].includes(args[i])) {
    if (i + 1 >= args.length) fail(usage);
    opts[args[i].slice(2)] = args[++i];
  } else {
    positional.push(args[i]);
  }
}
if (!['append', 'migrate', 'sweep', 'archive'].includes(cmd) || positional.length < 1) fail(usage);

const castleDir = join(resolve(positional[0]), '.claude', 'castle');
const isJson = existsSync(join(castleDir, 'keep.json'));
if (!isJson && !existsSync(join(castleDir, 'keep.md'))) {
  fail(`No castle found: ${castleDir} — run castle-init.mjs first. ／ 找不到城堡，請先執行 castle-init.mjs`);
}
const pathOf = (name) => join(castleDir, name);
const readJson = (name) => JSON.parse(readFileSync(pathOf(name), 'utf8'));
const today = new Date().toLocaleDateString('sv'); // 'sv' locale = YYYY-MM-DD, local timezone (not UTC)
const budgets = isJson && existsSync(pathOf('castle.json')) ? readJson('castle.json').budgets : undefined;
const factMaxChars = budgets?.factMaxChars ?? 200;
const requireJson = () => {
  if (!isJson) fail(`${cmd} works on JSON castles only — in a markdown castle move the lines by hand. ／ ${cmd} 只支援 JSON 城堡；markdown 城堡請手動搬移該行`);
};

if (cmd === 'append') append(positional.slice(1));
else if (cmd === 'migrate') migrate();
else if (cmd === 'sweep') sweep(positional.slice(1));
else archive(positional.slice(1));

function append(rest) {
  if (rest.length !== 1 || !opts.conf || !opts.src) fail(usage);
  const [fact] = rest;
  if (!['high', 'med', 'low'].includes(opts.conf)) {
    fail(`Invalid --conf: ${opts.conf} (expected high|med|low) ／ --conf 無效，只能是 high／med／low`);
  }
  if (/[\r\n|\]]/.test(opts.src) || !opts.src.trim()) {
    fail('Invalid --src: must be one non-empty line without "|" or "]". ／ --src 無效：須為單行非空字串，且不含「|」「]」');
  }
  const tags = (opts.tags ?? '').split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
  if (tags.some((t) => /[\s#]/.test(t))) {
    fail(`Invalid --tags: ${opts.tags} (comma-separated, no spaces) ／ --tags 無效：以逗號分隔，不可含空白`);
  }
  if (opts.warn !== undefined) {
    const routeNames = isJson
      ? readJson('routes.json').routes.map((r) => r.name)
      : [...readFileSync(pathOf('routes.md'), 'utf8').matchAll(/^##\s*route:\s*(\S+)/gm)].map((m) => m[1]);
    if (!routeNames.includes(opts.warn)) {
      fail(`--warn names no existing route: ${opts.warn} (routes: ${routeNames.join(', ')}) ／ --warn 指定的路線不存在`);
    }
  }
  if (/[\r\n]/.test(fact)) {
    fail('Rejected: the fact contains a newline — a record is one line (architecture §2). ／ 拒絕：事實含換行，一筆記錄只能一行');
  }
  if (!fact.trim()) fail('Rejected: the fact is empty. ／ 拒絕：事實是空的');
  if (fact.length > factMaxChars) {
    fail(
      `Rejected: the fact is ${fact.length} chars, over factMaxChars ${factMaxChars} — split it into one record per fact, or move the detail to archive/ and cite the path. ／ 拒絕：事實 ${fact.length} 字，超過上限 ${factMaxChars}；請拆成一事一筆，或把細節放 archive/ 並在記錄中附路徑`,
    );
  }

  if (isJson) {
    const chronicle = existsSync(pathOf('chronicle.json')) ? readJson('chronicle.json') : { schema: 1, entries: [] };
    const taken = new Set(chronicle.entries.map((e) => e.id));
    let id;
    do {
      id = [...randomBytes(8)].map((b) => (b % 36).toString(36)).join('');
    } while (taken.has(id));
    const record = { id, date: today, confidence: opts.conf, source: opts.src, fact, tags };
    if (opts.warn !== undefined) record.routeWarning = opts.warn;
    chronicle.entries = [...chronicle.entries, record];
    writeCastleJson('chronicle.json', chronicle);

    const back = readJson('chronicle.json').entries.find((e) => e.id === id);
    if (!back || back.fact !== fact) fail(`Read-back failed: ${pathOf('chronicle.json')} ／ 讀回驗證失敗`);
    console.log(`Appended ／ 已寫入 chronicle.json: ${JSON.stringify(back)}`);
  } else {
    const path = pathOf('chronicle.md');
    if (!existsSync(path)) fail(`chronicle.md not found: ${path} ／ 找不到 chronicle.md`);
    const line = `- [${today} | conf:${opts.conf} | src:${opts.src}] ${fact}${tags.map((t) => ` #${t}`).join('')}${opts.warn !== undefined ? ` ⚠${opts.warn}` : ''}`;
    const before = readFileSync(path, 'utf8');
    const eol = before.includes('\r\n') ? '\r\n' : '\n';
    appendFileSync(path, `${before === '' || before.endsWith('\n') ? '' : eol}${line}${eol}`, 'utf8');

    const lastLine = readFileSync(path, 'utf8').trimEnd().split(/\r?\n/).pop();
    if (lastLine !== line) fail(`Read-back failed: ${path} ／ 讀回驗證失敗`);
    console.log(`Appended ／ 已寫入 chronicle.md: ${line}`);
  }
}

// Upgrade a pre-v0.5 instance in place: JSON files to the compact form, the
// missing factMaxChars default, and the v0.5 session-start stops. Never
// changes a record's content. Idempotent — a second run changes nothing.
function migrate() {
  const changes = [];
  let written = 0;
  if (isJson) {
    const files = ['castle.json', 'keep.json', 'chronicle.json', 'routes.json'].filter((f) => existsSync(pathOf(f)));
    for (const dir of ['rooms', 'archive']) {
      if (!existsSync(pathOf(dir))) continue;
      for (const name of readdirSync(pathOf(dir))) if (name.endsWith('.json')) files.push(join(dir, name));
    }
    for (const file of files) {
      const raw = readFileSync(pathOf(file), 'utf8');
      const data = JSON.parse(raw);
      const notes = [];
      if (file === 'castle.json' && data.budgets && data.budgets.factMaxChars === undefined) {
        data.budgets.factMaxChars = 200;
        notes.push('added budgets.factMaxChars 200');
      }
      const sessionStart = file === 'routes.json' ? data.routes.find((r) => r.name === 'session-start') : undefined;
      if (sessionStart) {
        const has = (t, r) => sessionStart.stops.some((s) => s.target === t && (r === undefined || s.read === r));
        if (!has('patrol-check')) {
          sessionStart.stops.unshift({ target: 'patrol-check', read: 'due' });
          notes.push('session-start + patrol-check/due');
        }
        if (!has('chronicle', 'last-handover')) {
          const keepAt = sessionStart.stops.map((s) => s.target).lastIndexOf('keep');
          sessionStart.stops.splice(keepAt === -1 ? 1 : keepAt + 1, 0, { target: 'chronicle', read: 'last-handover' });
          notes.push('session-start + chronicle/last-handover');
        }
      } else if (file === 'routes.json') {
        notes.push('no session-start route — not created (creating a route is yellow) ／ 沒有 session-start 路線，未代建');
      }
      const out = `${toCastleJson(canonicalDeep(data))}\n`;
      if (out !== raw.replace(/\r\n/g, '\n')) {
        writeCastleJson(file, canonicalDeep(data));
        JSON.parse(readFileSync(pathOf(file), 'utf8')); // read-back
        notes.unshift('reformatted');
        written++;
      }
      if (notes.length) changes.push(`${file.replaceAll('\\', '/')}: ${notes.join('; ')}`);
    }
  } else {
    const note = upgradeRoutesMd();
    if (note) changes.push(`routes.md: ${note}`);
    if (note.startsWith('session-start')) written++;
  }

  const over = overCapCount();
  for (const c of changes) console.log(`  ${c}`);
  console.log(
    `Migrated ／ 已遷移：${written} file(s) written${over ? `; ${over} record(s) over factMaxChars ${factMaxChars} — the patrol splits them (architecture §4 step 5d) ／ ${over} 筆超過字數上限，待巡查拆分` : ''}`,
  );
}

function upgradeRoutesMd() {
  const path = pathOf('routes.md');
  const raw = readFileSync(path, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s*route:\s*session-start\b/.test(l));
  if (start === -1) return 'no session-start route — not created (creating a route is yellow) ／ 沒有 session-start 路線，未代建';
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end === -1) end = lines.length;
  const section = lines.slice(start, end).join('\n');
  const stopIdx = lines.map((l, i) => (i > start && i < end && /^\d+\.\s/.test(l) ? i : -1)).filter((i) => i !== -1);
  const stops = stopIdx.map((i) => lines[i].replace(/^\d+\.\s*/, ''));
  const added = [];
  if (!section.includes('patrol-check')) {
    stops.unshift('`patrol-check/due` — 檢查巡查觸發條件（筆數門檻、上次巡查日期），觸發幾條列幾條，沒觸發就不出聲');
    added.push('patrol-check/due');
  }
  if (!section.includes('last-handover')) {
    const keepAt = stops.map((s) => /keep/.test(s)).lastIndexOf(true);
    stops.splice(keepAt === -1 ? 1 : keepAt + 1, 0, 'chronicle.md `chronicle/last-handover` — 只讀最新一筆 #handover 記錄');
    added.push('chronicle/last-handover');
  }
  if (!added.length) return '';
  const at = stopIdx.length ? stopIdx[0] : start + 1;
  const kept = lines.filter((_, i) => !stopIdx.includes(i));
  kept.splice(at, 0, ...stops.map((s, i) => `${i + 1}. ${s}`));
  writeFileSync(path, kept.join(eol), 'utf8');
  if (!readFileSync(path, 'utf8').includes(stops[0])) fail(`Read-back failed: ${path} ／ 讀回驗證失敗`);
  return `session-start + ${added.join(', ')}`;
}

function overCapCount() {
  const tooLong = (fact) => fact.length > factMaxChars || /[\r\n]/.test(fact);
  if (isJson) {
    const records = [
      ...Object.values(readJson('keep.json').sections).flat(),
      ...(existsSync(pathOf('chronicle.json')) ? readJson('chronicle.json').entries : []),
      ...roomFiles().flatMap((f) => readJson(join('rooms', f)).records),
    ];
    return records.filter((r) => tooLong(r.fact)).length;
  }
  const files = ['keep.md', 'chronicle.md', ...(existsSync(pathOf('rooms')) ? readdirSync(pathOf('rooms')).filter((f) => f.endsWith('.md')).map((f) => join('rooms', f)) : [])];
  return files
    .filter((f) => existsSync(pathOf(f)))
    .flatMap((f) => readFileSync(pathOf(f), 'utf8').split(/\r?\n/))
    .map((l) => /^-\s*\[[^\]]*\]\s*(.*)$/.exec(l)?.[1])
    .filter((rest) => rest !== undefined && tooLong(rest.replace(/⚠[\w-]+|#\S+/g, '').trim())).length;
}

// Move chronicle entries to archive/chronicle-YYYY-MM.json, bucketed by each
// entry's own date month, stamped sweptAt (and promotedTo when given) — the
// same semantics as the app's sweepChronicle. All-or-nothing on bad input.
function sweep(rest) {
  requireJson();
  if (!rest.length) fail(usage);
  const chronicle = readJson('chronicle.json');
  const targets = new Map(rest.map((arg) => arg.split('=')).map(([id, to]) => [id, to]));
  const missing = [...targets.keys()].filter((id) => !chronicle.entries.some((e) => e.id === id));
  if (missing.length) fail(`Not in chronicle.json: ${missing.join(', ')} — nothing swept. ／ 編年史裡沒有這些 id，未掃入任何記錄`);
  const badTo = [...targets.values()].filter((to) => to !== undefined && to !== 'keep' && !existsSync(pathOf(join('rooms', `${to}.json`))));
  if (badTo.length) fail(`promotedTo names no room: ${badTo.join(', ')} (use a room slug or keep) — nothing swept. ／ promotedTo 指定的房間不存在，未掃入任何記錄`);
  const newestHandover = chronicle.entries.filter((e) => e.tags?.includes('handover') || e.fact.includes('#handover')).pop();
  if (newestHandover && targets.has(newestHandover.id)) {
    fail(`Refused: ${newestHandover.id} is the newest handover — it stays for chronicle/last-handover (architecture §4 step 4). ／ 拒絕：這是最新一筆交接，須留在編年史`);
  }

  const byMonth = new Map();
  for (const entry of chronicle.entries.filter((e) => targets.has(e.id))) {
    const month = entry.date.slice(0, 7);
    const archived = { ...canonical(entry), sweptAt: today };
    if (targets.get(entry.id) !== undefined) archived.promotedTo = targets.get(entry.id);
    byMonth.set(month, [...(byMonth.get(month) ?? []), archived]);
  }
  // Archive first, chronicle second: a crash in between duplicates, never loses.
  for (const [month, entries] of byMonth) {
    const file = join('archive', `chronicle-${month}.json`);
    const bucket = existsSync(pathOf(file)) ? readJson(file) : { schema: 1, month, entries: [] };
    bucket.entries = [...bucket.entries, ...entries];
    writeCastleJson(file, bucket);
  }
  chronicle.entries = chronicle.entries.filter((e) => !targets.has(e.id));
  writeCastleJson('chronicle.json', chronicle);

  const left = readJson('chronicle.json').entries;
  const archivedIds = [...byMonth.keys()].flatMap((m) => readJson(join('archive', `chronicle-${m}.json`)).entries.map((e) => e.id));
  if ([...targets.keys()].some((id) => left.some((e) => e.id === id) || !archivedIds.includes(id))) {
    fail('Read-back failed: chronicle.json / archive ／ 讀回驗證失敗');
  }
  const summary = [...byMonth].map(([m, e]) => `chronicle-${m}.json (${e.length})`).join(', ');
  console.log(`Swept ／ 已掃入 archive: ${targets.size} entr${targets.size === 1 ? 'y' : 'ies'} → ${summary}; chronicle.json keeps ${left.length}`);
}

// Move room records to archive/room-records-YYYY-MM.json (YYYY-MM = the month
// they are archived), stamped archivedAt / archivedFrom / archiveNote.
function archive(ids) {
  requireJson();
  if (!ids.length || !opts.note?.trim() || /[\r\n]/.test(opts.note)) fail(usage);
  const rooms = roomFiles().map((f) => ({ file: join('rooms', f), data: readJson(join('rooms', f)) }));
  const found = new Map();
  for (const room of rooms) for (const r of room.data.records) if (ids.includes(r.id)) found.set(r.id, { room, record: r });
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) fail(`Not a room record: ${missing.join(', ')} — nothing archived. ／ 房間裡沒有這些 id，未封存任何記錄`);

  const byMonth = new Map();
  for (const { room, record } of found.values()) {
    const entry = { ...canonical(record), archivedAt: today, archivedFrom: `room:${room.data.slug}`, archiveNote: opts.note };
    byMonth.set(today.slice(0, 7), [...(byMonth.get(today.slice(0, 7)) ?? []), entry]);
  }
  for (const [month, entries] of byMonth) {
    const file = join('archive', `room-records-${month}.json`);
    const bucket = existsSync(pathOf(file)) ? readJson(file) : { schema: 1, month, entries: [] };
    bucket.entries = [...bucket.entries, ...entries];
    writeCastleJson(file, bucket);
  }
  for (const room of rooms.filter((r) => r.data.records.some((rec) => found.has(rec.id)))) {
    room.data.records = room.data.records.filter((rec) => !found.has(rec.id));
    writeCastleJson(room.file, room.data);
    if (readJson(room.file).records.some((rec) => found.has(rec.id))) fail(`Read-back failed: ${room.file} ／ 讀回驗證失敗`);
  }
  const summary = [...byMonth].map(([m, e]) => `room-records-${m}.json (${e.length})`).join(', ');
  console.log(`Archived ／ 已封存: ${found.size} room record(s) → ${summary}`);
}

function roomFiles() {
  return existsSync(pathOf('rooms')) ? readdirSync(pathOf('rooms')).filter((f) => f.endsWith('.json')) : [];
}

// Temp file + rename, so a crash mid-write never truncates a castle file.
function writeCastleJson(file, data) {
  const path = pathOf(file);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${toCastleJson(canonicalDeep(data))}\n`, 'utf8');
  renameSync(tmp, path);
}

// Canonical record key order (architecture §2); keys outside the schema keep their relative order after it.
function canonical(record) {
  const order = ['id', 'date', 'confidence', 'source', 'fact', 'tags', 'routeWarning', 'verifiedAt'];
  const keys = [...order.filter((k) => k in record), ...Object.keys(record).filter((k) => !order.includes(k))];
  return Object.fromEntries(keys.map((k) => [k, record[k]]));
}

function canonicalDeep(value) {
  if (Array.isArray(value)) return value.map(canonicalDeep);
  if (value === null || typeof value !== 'object') return value;
  if ('fact' in value && 'id' in value) return canonical(value);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, canonicalDeep(v)]));
}

// Castle JSON serialization (architecture §2): 2-space indented, except record
// objects, route objects and string arrays, which print compact on one line.
function toCastleJson(value, indent = '') {
  const oneLine = Array.isArray(value)
    ? value.every((x) => typeof x === 'string')
    : value !== null && typeof value === 'object' && ('fact' in value || 'stops' in value);
  if (value === null || typeof value !== 'object' || oneLine) return JSON.stringify(value);
  const inner = `${indent}  `;
  const items = Array.isArray(value)
    ? value.map((x) => inner + toCastleJson(x, inner))
    : Object.entries(value).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${toCastleJson(x, inner)}`);
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return items.length === 0 ? `${open}${close}` : `${open}\n${items.join(',\n')}\n${indent}${close}`;
}
