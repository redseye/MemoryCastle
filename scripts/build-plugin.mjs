#!/usr/bin/env node
// build-plugin.mjs — generate plugins/memory-castle/ from the repository's own
// docs/scripts/templates/skill, so the plugin ships a self-contained copy
// instead of a symlink (symlinks are unreliable on Windows).
// Usage: node scripts/build-plugin.mjs                         → plugins/memory-castle/
//        node scripts/build-plugin.mjs --global [<claude-home>] → global install:
//          <claude-home>/MemoryCastle/{docs,scripts,templates} + <claude-home>/skills/castle/SKILL.md
//          (<claude-home> defaults to ~/.claude; back up the old global copy first if you need it)
// Zero dependencies. Safe to re-run — every output is overwritten in place.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const globalIdx = process.argv.indexOf('--global');
const claudeHome = globalIdx === -1 ? undefined : resolve(process.argv[globalIdx + 1] ?? join(homedir(), '.claude'));

// Per target: where docs/scripts/templates go, where SKILL.md goes, and what
// the skill's `<mc-root>` placeholder becomes.
const target = claudeHome
  ? {
      label: join(claudeHome, 'MemoryCastle').replaceAll('\\', '/'),
      root: join(claudeHome, 'MemoryCastle'),
      skillPath: join(claudeHome, 'skills', 'castle', 'SKILL.md'),
      mcRoot: join(claudeHome, 'MemoryCastle').replaceAll('\\', '/'),
      rootNote: '(Paths here point at the global MemoryCastle install.)',
    }
  : {
      label: 'plugins/memory-castle',
      root: join(repoRoot, 'plugins', 'memory-castle'),
      skillPath: join(repoRoot, 'plugins', 'memory-castle', 'skills', 'castle', 'SKILL.md'),
      mcRoot: '${CLAUDE_PLUGIN_ROOT}',
      rootNote: '`${CLAUDE_PLUGIN_ROOT}` = this plugin\'s own installation directory.',
    };

const copy = (srcRel, destRel) => {
  const dest = join(target.root, destRel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(repoRoot, srcRel), dest);
  console.log(`已複製：${srcRel} → ${target.label}/${destRel.replaceAll('\\', '/')}`);
};

// 1. docs + scripts, copied verbatim (no repo-relative paths inside them).
copy('docs/architecture.md', join('docs', 'architecture.md'));
copy(join('scripts', 'castle-init.mjs'), join('scripts', 'castle-init.mjs'));
copy(join('scripts', 'castle.mjs'), join('scripts', 'castle.mjs'));

// 2. templates, copied verbatim.
const templatesSrcDir = join(repoRoot, 'templates');
for (const name of readdirSync(templatesSrcDir)) {
  if (name.endsWith('.md')) copy(join('templates', name), join('templates', name));
}

// 3. skill/SKILL.md, rewritten: the `<mc-root>` placeholder becomes the
// target's root and its definition sentence is swapped for the target's. Exact
// strings, so an upstream wording change fails loudly here instead of silently
// shipping a stale skill.
const skillSrc = readFileSync(join(repoRoot, 'skill', 'SKILL.md'), 'utf8');
const rootDefinition = '`<mc-root>` = the MemoryCastle repository root (holds docs/, scripts/, templates/).';
if (!skillSrc.includes(rootDefinition) || !skillSrc.replace(rootDefinition, '').includes('<mc-root>')) {
  console.error('找不到預期字樣（<mc-root> 定義句或其用處），改寫規則失效——正本 skill\\SKILL.md 可能已變動，請更新 build-plugin.mjs。');
  process.exit(1);
}
const skillOut = skillSrc.replace(rootDefinition, target.rootNote).replaceAll('<mc-root>', target.mcRoot);

mkdirSync(dirname(target.skillPath), { recursive: true });
writeFileSync(target.skillPath, skillOut, 'utf8');
console.log(`已產生：${target.skillPath}（<mc-root> → ${target.mcRoot}）`);
