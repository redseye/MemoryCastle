// Unit tests for the M9 native folder-picker module. Every test injects a
// fake spawn function — no real PowerShell process is ever started here.
// See tests/api.e2e.ts for the route-level HTTP mapping (via the
// MEMORYCASTLE_FAKE_PICKER env seam and via a DI'd fake pickFolderFn for the
// branches the real picker never takes on this dev machine, e.g. not_supported).

import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { pickFolder, type SpawnFn } from '../src/server/pick-folder.js';

// Deliberately never sets `pid` — killChild() only attempts the real
// Windows taskkill path when a numeric pid is present (see cli.test.ts's
// identical convention and pick-folder.ts's killChild()).
function makeFakeChild() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proc = new EventEmitter() as any;
  proc.kill = vi.fn();
  return proc;
}

// Simulates the PS script's side effect: the real script writes its result
// to `<scriptFile-without-.ps1>.txt` (pick-folder.ts's own naming
// convention), which the -File arg reveals; `action` gets that path so the
// test can write (or not write) the result file before the child "closes".
function scriptedPickerSpawn(
  action: (resultFile: string) => Promise<void> | void,
  code = 0,
): { spawnFn: SpawnFn; calls: { command: string; args: string[] }[] } {
  const calls: { command: string; args: string[] }[] = [];
  const spawnFn: SpawnFn = vi.fn((command: string, args: string[]) => {
    calls.push({ command, args });
    const child = makeFakeChild();
    const fileIndex = args.indexOf('-File');
    const scriptFile = args[fileIndex + 1];
    const resultFile = scriptFile.replace(/\.ps1$/, '.txt');
    setImmediate(async () => {
      await action(resultFile);
      child.emit('close', code);
    });
    return child;
  });
  return { spawnFn, calls };
}

const resolveFakeShell = async () => 'C:/fake/pwsh.exe';

describe('pickFolder', () => {
  it('returns the selected path, stripping the WriteAllText BOM and normalizing backslashes', async () => {
    const { spawnFn, calls } = scriptedPickerSpawn(async (resultFile) => {
      await writeFile(resultFile, '\uFEFF' + 'C:\\Users\\demo\\示範專案', 'utf8');
    });

    const result = await pickFolder({ spawnFn, resolveShellFn: resolveFakeShell });

    expect(result).toEqual({ kind: 'ok', path: 'C:/Users/demo/示範專案' });
    expect(calls[0].args).toContain('-sta');
    expect(calls[0].args).toContain('-File');
  });

  it('returns cancelled when the script writes an empty (BOM-only) result', async () => {
    const { spawnFn } = scriptedPickerSpawn(async (resultFile) => {
      await writeFile(resultFile, '\uFEFF', 'utf8');
    });

    const result = await pickFolder({ spawnFn, resolveShellFn: resolveFakeShell });

    expect(result).toEqual({ kind: 'cancelled' });
  });

  it('returns cancelled when the result file was never written (process crashed)', async () => {
    const { spawnFn } = scriptedPickerSpawn(() => {});

    const result = await pickFolder({ spawnFn, resolveShellFn: resolveFakeShell });

    expect(result).toEqual({ kind: 'cancelled' });
  });

  it('returns not_supported on a non-win32 platform without ever invoking spawnFn', async () => {
    const spawnFn = vi.fn();

    const result = await pickFolder({ platform: 'linux', spawnFn, resolveShellFn: resolveFakeShell });

    expect(result).toEqual({ kind: 'not_supported' });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('rejects a second call with busy while one dialog is still open, then accepts a third after it closes', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const { spawnFn: firstSpawn } = scriptedPickerSpawn(async (resultFile) => {
      await firstGate;
      await writeFile(resultFile, '\uFEFF', 'utf8');
    });

    const firstCall = pickFolder({ spawnFn: firstSpawn, resolveShellFn: resolveFakeShell });
    // Give the first call's spawn a tick to set the module lock before the
    // second call races it.
    await new Promise((r) => setImmediate(r));

    const busySpawn = vi.fn();
    const secondResult = await pickFolder({ spawnFn: busySpawn, resolveShellFn: resolveFakeShell });
    expect(secondResult).toEqual({ kind: 'busy' });
    expect(busySpawn).not.toHaveBeenCalled();

    releaseFirst?.();
    await firstCall;

    const { spawnFn: thirdSpawn } = scriptedPickerSpawn(async (resultFile) => {
      await writeFile(resultFile, '\uFEFF' + 'D:/ok', 'utf8');
    });
    const thirdResult = await pickFolder({ spawnFn: thirdSpawn, resolveShellFn: resolveFakeShell });
    expect(thirdResult).toEqual({ kind: 'ok', path: 'D:/ok' });
  });

  it('kills the process and returns timeout when it never closes in time', async () => {
    const hangingChild = makeFakeChild();
    const spawnFn: SpawnFn = vi.fn(() => hangingChild);

    const result = await pickFolder({ spawnFn, resolveShellFn: resolveFakeShell, timeoutMs: 10 });

    expect(result).toEqual({ kind: 'timeout' });
    expect(hangingChild.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
