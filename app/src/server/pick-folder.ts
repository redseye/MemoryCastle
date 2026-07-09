// Server-side native folder picker (plan M9). The tool is local-only (server
// binds 127.0.0.1), so the picker spawns a PowerShell dialog on the SERVER
// process itself — this works identically for the Electron window and a
// plain browser tab, with no Electron IPC/preload work. Windows only; other
// platforms get `not_supported`.
//
// Path transfer goes through a UTF-8 temp file, never stdout: this machine
// has a proven cp950 console-encoding trap with Chinese text (docs/api.md
// "Encoding caveat"), and Chinese folder names are a certainty here. The PS
// script writes the result via [System.IO.File]::WriteAllText(..., UTF8);
// Node reads it back with 'utf8' and strips the BOM that WriteAllText's
// Encoding.UTF8 always emits.
//
// System.Windows.Forms.FolderBrowserDialog requires an STA apartment, and
// pwsh (PowerShell 7, unlike Windows PowerShell) defaults to MTA — `-sta` is
// passed unconditionally to cover both hosts. The dialog is made TopMost via
// an owner Form (the standard trick) so it doesn't open behind other windows.

import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
// PowerShell only recognizes a script as UTF-8 (regardless of console code
// page) when the file starts with this byte-order mark.
const BOM = '\uFEFF';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SpawnFn = (command: string, args: string[], options: any) => any;

export interface PickFolderOverrides {
  spawnFn?: SpawnFn;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  resolveShellFn?: () => Promise<string>;
}

export type PickFolderResult =
  | { kind: 'ok'; path: string }
  | { kind: 'cancelled' }
  | { kind: 'not_supported' }
  | { kind: 'busy' }
  | { kind: 'timeout' };

// Module-level lock: only one dialog at a time (a second FolderBrowserDialog
// spawned concurrently would just confuse whichever window the user clicks).
let busy = false;

async function resolveShellReal(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('where', ['pwsh'], { windowsHide: true });
    const first = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);
    if (first) return first;
  } catch {
    // pwsh not on PATH — fall through to the Windows-bundled powershell.exe
  }
  return 'powershell.exe';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function killChild(child: any): void {
  if (process.platform === 'win32' && typeof child.pid === 'number') {
    try {
      execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => {});
      return;
    } catch {
      // fall through to a plain kill below
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // already exited
  }
}

function buildScript(resultFile: string): string {
  const escaped = resultFile.replace(/'/g, "''");
  return [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$form = New-Object System.Windows.Forms.Form',
    '$form.TopMost = $true',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$result = $dialog.ShowDialog($form)',
    'if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
    `  [System.IO.File]::WriteAllText('${escaped}', $dialog.SelectedPath, [System.Text.Encoding]::UTF8)`,
    '} else {',
    `  [System.IO.File]::WriteAllText('${escaped}', '', [System.Text.Encoding]::UTF8)`,
    '}',
    '$form.Dispose()',
    '',
  ].join('\r\n');
}

async function runPicker(overrides: PickFolderOverrides): Promise<PickFolderResult> {
  const spawnFn: SpawnFn = overrides.spawnFn ?? (spawn as unknown as SpawnFn);
  const resolveShellFn = overrides.resolveShellFn ?? resolveShellReal;
  const timeoutMs = overrides.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const id = randomUUID();
  const resultFile = join(tmpdir(), `memorycastle-pickfolder-${id}.txt`);
  const scriptFile = join(tmpdir(), `memorycastle-pickfolder-${id}.ps1`);

  try {
    // Leading BOM so PowerShell reads the script as UTF-8 regardless of the
    // console's active code page, even though resultFile (built from tmpdir())
    // is the only non-ASCII-prone content embedded in it.
    await writeFile(scriptFile, BOM + buildScript(resultFile), 'utf8');
    const shell = await resolveShellFn();

    const outcome = await new Promise<'closed' | 'timeout'>((resolvePromise) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let child: any;
      try {
        child = spawnFn(
          shell,
          ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-sta', '-File', scriptFile],
          { windowsHide: true },
        );
      } catch {
        resolvePromise('closed');
        return;
      }

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        killChild(child);
        resolvePromise('timeout');
      }, timeoutMs);

      child.on('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise('closed');
      });
      child.on('close', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise('closed');
      });
    });

    if (outcome === 'timeout') return { kind: 'timeout' };

    let raw: string;
    try {
      raw = await readFile(resultFile, 'utf8');
    } catch {
      // Killed/crashed before writing anything — treat like a cancel rather
      // than surfacing an internal error.
      return { kind: 'cancelled' };
    }
    const path = raw.replace(new RegExp(`^${BOM}`), '').trim();
    if (!path) return { kind: 'cancelled' };
    return { kind: 'ok', path: path.replace(/\\/g, '/') };
  } finally {
    await rm(resultFile, { force: true }).catch(() => {});
    await rm(scriptFile, { force: true }).catch(() => {});
  }
}

export async function pickFolder(overrides: PickFolderOverrides = {}): Promise<PickFolderResult> {
  const platform = overrides.platform ?? process.platform;
  if (platform !== 'win32') return { kind: 'not_supported' };

  if (busy) return { kind: 'busy' };
  busy = true;
  try {
    return await runPicker(overrides);
  } finally {
    busy = false;
  }
}
