#!/usr/bin/env node
// memorycastle CLI. M1 implements `init`; M2 adds `import`; M3 adds `serve`;
// `doctor` and `measure` are read-only reports over an existing castle.

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CastleExistsError, initCastle, measureCastle, runDoctor } from './core/index.js';
import { getPort, readConfig } from './config/index.js';
import { importApply, importPreview } from './importer/index.js';
import { startServer } from './server/index.js';
import { createDynamicLlmService } from './llm/factory.js';

export async function runCli(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  if (cmd === 'init') {
    const nameIdx = rest.indexOf('--name');
    const name = nameIdx !== -1 ? rest[nameIdx + 1] : undefined;
    const dir = rest.filter((_, i) => nameIdx === -1 || (i !== nameIdx && i !== nameIdx + 1))[0];
    if (!dir) {
      console.error('Usage: memorycastle init <project-root> [--name "Project Name"] ／ 用法：memorycastle init <專案根目錄> [--name "專案名稱"]');
      return 1;
    }
    try {
      const castleDir = await initCastle(dir, name);
      console.log(`Castle scaffold complete: ${castleDir} ／ 城堡腳手架完成`);
      return 0;
    } catch (err) {
      if (err instanceof CastleExistsError) {
        console.error(err.message);
        return 2;
      }
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }

  if (cmd === 'import') {
    const apply = rest.includes('--apply');
    const dir = rest.filter((a) => a !== '--apply')[0];
    if (!dir) {
      console.error('Usage: memorycastle import <project-root> [--apply] ／ 用法：memorycastle import <專案根目錄> [--apply]');
      return 1;
    }
    try {
      let counts;
      let warnings;
      if (apply) {
        const summary = await importApply(dir);
        counts = summary.counts;
        warnings = summary.warnings;
        console.log(
          `Import complete: keep ${counts.keep}, chronicle ${counts.chronicle}, ` +
            `routes ${counts.routes}, rooms ${counts.rooms}, archive ${counts.archiveMonths} months ／ 匯入完成`,
        );
        console.log(`Moved ${summary.movedFiles.length} original files to archive/markdown-original/ ／ 已搬移`);
      } else {
        const preview = await importPreview(dir);
        counts = preview.counts;
        warnings = preview.warnings;
        console.log(
          `Import preview: keep ${counts.keep}, chronicle ${counts.chronicle}, ` +
            `routes ${counts.routes}, rooms ${counts.rooms}, archive ${counts.archiveMonths} months ／ 匯入預覽`,
        );
      }
      if (warnings.length > 0) {
        console.log(`Warnings: ${warnings.length} ／ 警告 ${warnings.length} 項：`);
        for (const w of warnings) {
          console.log(`  ${w.file}:${w.line} — ${w.reason}：${w.text}`);
        }
      } else {
        console.log('Warnings: 0 ／ 警告 0 項');
      }
      return 0;
    } catch (err) {
      if (err instanceof CastleExistsError) {
        console.error(err.message);
        return 2;
      }
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }

  if (cmd === 'doctor') {
    const dir = rest[0];
    if (!dir) {
      console.error('Usage: memorycastle doctor <project-root> ／ 用法：memorycastle doctor <專案根目錄>');
      return 1;
    }
    try {
      const report = await runDoctor(dir);
      console.log(`Castle doctor report: ${report.root} (checked ${report.checkedAt}) ／ 城堡健康檢查報告`);
      for (const f of report.findings) {
        console.log(`  [${f.severity}] ${f.kind} — ${f.target}：${f.detail}`);
      }
      console.log(`Overall status: ${report.status} ／ 整體狀態：${report.status}`);
      return report.status === 'ok' ? 0 : 1;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }

  if (cmd === 'measure') {
    const dir = rest[0] ?? process.cwd();
    try {
      const m = await measureCastle(dir);
      const s = m.sessionStart;
      const st = m.sessionStartStored;
      const ratio = (r: number | null) => (r === null ? 'n/a' : r.toFixed(2));
      console.log(
        `Token estimate for ${m.root} — estimate only: CJK chars ×1 + other chars ÷4 ／ ` +
          '城堡 token 估算（估算法：CJK 字 ×1＋其他字元 ÷4，僅供比較）',
      );
      console.log(
        `  (a) session-start: patrol-check ${s.patrolCheck} + keep ${s.keep} + last handover ${s.lastHandover} + ` +
          `room mean ${s.roomMean} / max ${s.roomMax}${m.maxRoomSlug ? ` (${m.maxRoomSlug})` : ''} = ` +
          `${s.totalMean} / ${s.totalMax} ／ 開工載入（§2 單行計）`,
      );
      console.log(
        `  (a') session-start, JSON as stored on disk: keep ${st.keep} + last handover ${st.lastHandover} + ` +
          `room mean ${st.roomMean} / max ${st.roomMax} = ${st.totalMean} / ${st.totalMax} ／ 同上，以磁碟上的 JSON 原文計`,
      );
      console.log(`  (b) flat-file equivalent: ${m.flat.records} live records = ${m.flat.tokens} ／ 全量平鋪等價（所有活記錄的 §2 單行）`);
      console.log(`  (c) patrol payload: ${m.patrol} ／ 巡查載入量`);
      console.log(
        `  Ratio a/b: ${ratio(m.ratioMean)} (mean room) / ${ratio(m.ratioMax)} (max room) ／ ` +
          `比值 a/b：${ratio(m.ratioMean)}（平均房）／${ratio(m.ratioMax)}（最大房）`,
      );
      return 0;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }

  if (cmd === 'serve') {
    const portIdx = rest.indexOf('--port');
    const portArg = portIdx !== -1 ? Number(rest[portIdx + 1]) : undefined;
    const hasValidPortArg = portArg !== undefined && Number.isFinite(portArg) && portArg >= 0;

    const config = await readConfig();
    const port = hasValidPortArg ? portArg : getPort(config);
    // dist/cli.js sits directly under dist/; dist/public is where
    // `npm run web:build` (vite.config.ts outDir) puts the built web UI.
    const publicDir = join(dirname(fileURLToPath(import.meta.url)), 'public');

    let server;
    try {
      server = await startServer({ port, llmService: createDynamicLlmService(), publicDir });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
    console.log(`memorycastle API started: ${server.url} ／ 已啟動`);
    if (server.servingUi) {
      console.log(`Web UI: http://127.0.0.1:${server.port}/`);
    } else {
      console.log('No built Web UI found — serving API only. Run npm run web:build then restart to serve the UI as well. ／ 未找到已建置的 Web UI，僅提供 API；執行 npm run web:build 後重啟即可一併提供 UI');
    }

    return new Promise<number>((resolveCode) => {
      const shutdown = async () => {
        console.log('Shutting down the server… ／ 正在關閉伺服器');
        await server.close();
        resolveCode(0);
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });
  }

  console.error(
    'Usage: memorycastle init <dir> [--name X] | serve | import <dir> | doctor <dir> | measure [dir] ／ 用法：memorycastle init <dir> [--name X] | serve | import <dir> | doctor <dir> | measure [dir]',
  );
  return 1;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
