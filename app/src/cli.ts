#!/usr/bin/env node
// memorycastle CLI. M1 implements `init`; M2 adds `import`; M3 adds `serve`.

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CastleExistsError, initCastle } from './core/index.js';
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
      console.error('用法：memorycastle init <專案根目錄> [--name "專案名稱"]');
      return 1;
    }
    try {
      const castleDir = await initCastle(dir, name);
      console.log(`城堡腳手架完成：${castleDir}`);
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
      console.error('用法：memorycastle import <專案根目錄> [--apply]');
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
          `匯入完成：keep ${counts.keep} 筆、chronicle ${counts.chronicle} 筆、` +
            `routes ${counts.routes} 條、rooms ${counts.rooms} 間、archive ${counts.archiveMonths} 月`,
        );
        console.log(`已搬移 ${summary.movedFiles.length} 個原始檔案至 archive/markdown-original/`);
      } else {
        const preview = await importPreview(dir);
        counts = preview.counts;
        warnings = preview.warnings;
        console.log(
          `匯入預覽：keep ${counts.keep} 筆、chronicle ${counts.chronicle} 筆、` +
            `routes ${counts.routes} 條、rooms ${counts.rooms} 間、archive ${counts.archiveMonths} 月`,
        );
      }
      if (warnings.length > 0) {
        console.log(`警告 ${warnings.length} 項：`);
        for (const w of warnings) {
          console.log(`  ${w.file}:${w.line} — ${w.reason}：${w.text}`);
        }
      } else {
        console.log('警告 0 項');
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
    console.log(`memorycastle API 已啟動：${server.url}`);
    if (server.servingUi) {
      console.log(`Web UI：http://127.0.0.1:${server.port}/`);
    } else {
      console.log('（未找到已建置的 Web UI，僅提供 API。執行 npm run web:build 後重啟即可一併提供 UI。）');
    }

    return new Promise<number>((resolveCode) => {
      const shutdown = async () => {
        console.log('正在關閉伺服器…');
        await server.close();
        resolveCode(0);
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });
  }

  console.error('用法：memorycastle init <dir> [--name X] | serve | import <dir>');
  return 1;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
