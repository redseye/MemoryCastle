#!/usr/bin/env node
// build-plugin.mjs — generate plugins/memory-castle/ from the repository's own
// docs/scripts/templates/skill, so the plugin ships a self-contained copy
// instead of a symlink (symlinks are unreliable on Windows).
// Usage: node scripts/build-plugin.mjs
// Zero dependencies. Safe to re-run — every output is overwritten in place.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = join(repoRoot, 'plugins', 'memory-castle');

const copy = (srcRel, destRel) => {
  const src = join(repoRoot, srcRel);
  const dest = join(pluginRoot, destRel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`已複製：${srcRel} → plugins/memory-castle/${destRel}`);
};

// 1. docs + scaffolder script, copied verbatim (no repo-relative paths inside them).
copy('docs/architecture.md', join('docs', 'architecture.md'));
copy(join('scripts', 'castle-init.mjs'), join('scripts', 'castle-init.mjs'));

// 2. templates, copied verbatim.
const templatesSrcDir = join(repoRoot, 'templates');
for (const name of readdirSync(templatesSrcDir)) {
  if (name.endsWith('.md')) copy(join('templates', name), join('templates', name));
}

// 3. skill/SKILL.md, rewritten: repo-relative paths become ${CLAUDE_PLUGIN_ROOT}
// references. Exact-string replacements so an upstream wording change fails
// loudly here instead of silently shipping a stale plugin skill.
const skillSrc = readFileSync(join(repoRoot, 'skill', 'SKILL.md'), 'utf8');

const replacements = [
  {
    label: 'architecture.md 路徑與相對路徑說明句',
    from: 'Full rules: docs\\architecture.md — read §2-§6 the first time you touch a castle in a session. (Paths in this file are relative to the MemoryCastle repository root.)',
    to: 'Full rules: ${CLAUDE_PLUGIN_ROOT}/docs/architecture.md — read §2-§6 the first time you touch a castle in a session. (Paths in this file resolve against ${CLAUDE_PLUGIN_ROOT}, this plugin\'s own installation directory.)',
  },
  {
    label: 'castle-init.mjs 呼叫指令',
    from: '1. Run: `node scripts\\castle-init.mjs <project-root>` (relative to the MemoryCastle repository root)',
    to: '1. Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/castle-init.mjs" <project-root>`',
  },
];

let skillOut = skillSrc;
for (const { label, from, to } of replacements) {
  if (!skillOut.includes(from)) {
    console.error(`找不到預期字樣，改寫規則「${label}」失效——正本 skill\\SKILL.md 可能已變動，請更新 build-plugin.mjs。`);
    process.exit(1);
  }
  skillOut = skillOut.replace(from, to);
}

mkdirSync(join(pluginRoot, 'skills', 'castle'), { recursive: true });
writeFileSync(join(pluginRoot, 'skills', 'castle', 'SKILL.md'), skillOut, 'utf8');
console.log('已產生：plugins/memory-castle/skills/castle/SKILL.md（含 ${CLAUDE_PLUGIN_ROOT} 改寫）');
