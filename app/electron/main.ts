// Electron main process (M7). Loads the existing built server in-process
// (no child node) and points a BrowserWindow at it. Compiled by
// electron/tsconfig.json to dist-electron/main.js, a sibling of dist/ at the
// app root — so the relative imports below reach dist/server, dist/config,
// dist/llm the same way whether running unpackaged or inside app.asar.

import { app, BrowserWindow, dialog, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The imports below reach into dist/ — the same built JS the CLI (dist/cli.js)
// runs — rather than src/, so the packaged app and `memorycastle serve` stay
// on identical code. Root tsconfig has declaration:false, so dist/ has no
// .d.ts; the shape is pinned locally below (RunningServer) and re-asserted
// at the startServer() call site instead of trusting an `any` return.
// @ts-expect-error -- dist/config/index.js has no .d.ts (see note above)
import { getPort, readConfig } from '../dist/config/index.js';
// @ts-expect-error -- dist/llm/factory.js has no .d.ts (see note above)
import { createDynamicLlmService } from '../dist/llm/factory.js';
// @ts-expect-error -- dist/server/index.js has no .d.ts (see note above)
import { startServer } from '../dist/server/index.js';
import { decideFromProbe, probeHealth } from './attach-or-own.js';

interface RunningServer {
  port: number;
  url: string;
  servingUi: boolean;
  close(): Promise<void>;
}

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');

let mainWindow: BrowserWindow | null = null;
// Set only when this instance started the server itself; on quit we stop it
// only in that case, never when we attached to a server we don't own.
let ownedServer: RunningServer | null = null;

function createWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'MemoryCastle',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function showConflictDialog(port: number): Promise<void> {
  await dialog.showMessageBox({
    type: 'error',
    title: 'MemoryCastle',
    message: `連接埠 ${port} 已被其他程式占用`,
    detail: `偵測到 127.0.0.1:${port} 上有回應，但不是 MemoryCastle 伺服器。請關閉占用該連接埠的程式，或修改 ~/.memorycastle/config.json 的 port 設定後重新啟動。`,
  });
}

async function showStartupErrorDialog(message: string): Promise<void> {
  await dialog.showMessageBox({
    type: 'error',
    title: 'MemoryCastle',
    message: '伺服器啟動失敗',
    detail: message,
  });
}

async function main(): Promise<void> {
  const config = await readConfig();
  const port = getPort(config);

  const decision = decideFromProbe(await probeHealth(port));

  if (decision === 'conflict') {
    await showConflictDialog(port);
    app.quit();
    return;
  }

  if (decision === 'own') {
    const publicDir = join(appRoot, 'dist', 'public');
    try {
      ownedServer = (await startServer({
        port,
        publicDir,
        llmService: createDynamicLlmService(),
      })) as RunningServer;
    } catch (err) {
      await showStartupErrorDialog(err instanceof Error ? err.message : String(err));
      app.quit();
      return;
    }
  }

  createWindow(port);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  // Async cleanup on quit: veto the first quit to await the server close,
  // then quit again — the second pass finds ownedServer already cleared and
  // falls through.
  app.on('before-quit', (event) => {
    if (!ownedServer) return;
    event.preventDefault();
    const server = ownedServer;
    ownedServer = null;
    server.close().finally(() => app.quit());
  });

  app.whenReady().then(main);
}
