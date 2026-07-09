#!/usr/bin/env node
// castle-init.mjs — scaffold a MemoryCastle instance into a target project.
// Usage: node castle-init.mjs <project-root> [--name "Project Name"]
// Zero dependencies. Refuses to overwrite an existing castle. UTF-8 throughout.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('用法：node castle-init.mjs <專案根目錄> [--name "專案名稱"]');
  process.exit(1);
}

const targetRoot = resolve(args[0]);
const nameIdx = args.indexOf('--name');
const projectName = nameIdx !== -1 && args[nameIdx + 1] ? args[nameIdx + 1] : basename(targetRoot);
const date = new Date().toLocaleDateString('sv'); // 'sv' locale = YYYY-MM-DD, local timezone (not UTC)

if (!existsSync(targetRoot)) {
  console.error(`目標目錄不存在：${targetRoot}`);
  process.exit(1);
}

const castleDir = join(targetRoot, '.claude', 'castle');
if (existsSync(join(castleDir, 'keep.md'))) {
  console.error(`此處已有城堡：${castleDir} —— 拒絕覆蓋。確定要重建請自行刪除舊城堡。`);
  process.exit(2);
}

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const fill = (tpl) =>
  tpl
    .replaceAll('{{PROJECT_NAME}}', projectName)
    .replaceAll('{{DATE}}', date);

mkdirSync(join(castleDir, 'rooms'), { recursive: true });
mkdirSync(join(castleDir, 'archive'), { recursive: true });

const write = (name, content) => {
  const p = join(castleDir, name);
  writeFileSync(p, content, { encoding: 'utf8' });
  console.log(`已建立：${p}`);
};

write('keep.md', fill(readFileSync(join(templatesDir, 'keep.md'), 'utf8')));
write('chronicle.md', fill(readFileSync(join(templatesDir, 'chronicle.md'), 'utf8')));
write('routes.md', fill(readFileSync(join(templatesDir, 'routes.md'), 'utf8')));
writeFileSync(join(castleDir, 'rooms', '.gitkeep'), '', 'utf8');
writeFileSync(join(castleDir, 'archive', '.gitkeep'), '', 'utf8');

console.log('');
console.log('城堡腳手架完成。剩三個手動步驟：');
console.log('1. 填掉 keep.md 裡身分／約束的 {{...}} 佔位符。');
console.log('2. 檢視 routes.md——房間誕生後再補它的 {{...}} 佔位符（房間由巡查誕生，不預先蓋）。');
console.log('3. 把下面這行加進專案 CLAUDE.md 的路由表：');
console.log('   | Any task in this repo | read .claude\\castle\\keep.md, walk the session-start route in .claude\\castle\\routes.md, and load rooms whose locus owns the files you touch |');
