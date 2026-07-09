import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runCli } from '../src/cli.js';
import { makeTempDir, cleanupTempDir } from './helpers.js';

describe('runCli', () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await cleanupTempDir(dir);
  });

  it('init creates the castle scaffold and exits 0', async () => {
    dir = await makeTempDir();
    const code = await runCli(['init', dir, '--name', 'CLI 測試']);
    expect(code).toBe(0);
    expect(existsSync(join(dir, '.claude', 'castle', 'castle.json'))).toBe(true);
  });

  it('a second init on the same dir exits 2', async () => {
    dir = await makeTempDir();
    await runCli(['init', dir]);
    const code = await runCli(['init', dir]);
    expect(code).toBe(2);
  });

  it('init on a missing directory exits 1', async () => {
    const code = await runCli(['init', 'C:/definitely/not/a/real/path/xyz-does-not-exist']);
    expect(code).toBe(1);
  });

  it('init with no directory argument exits 1', async () => {
    const code = await runCli(['init']);
    expect(code).toBe(1);
  });

  it('serve starts the API on an ephemeral port and shuts down cleanly on SIGINT', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const runPromise = runCli(['serve', '--port', '0']);
    await vi.waitFor(() => {
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes('已啟動'))).toBe(true);
    });
    process.emit('SIGINT');
    const code = await runPromise;
    expect(code).toBe(0);
    logSpy.mockRestore();
  });

  it('import with no directory argument exits 1', async () => {
    const code = await runCli(['import']);
    expect(code).toBe(1);
  });

  it('import preview on a castle-less directory reports all-zero counts and exits 0', async () => {
    dir = await makeTempDir();
    const code = await runCli(['import', dir]);
    expect(code).toBe(0);
  });

  it('import --apply refuses when a JSON castle already exists', async () => {
    dir = await makeTempDir();
    await runCli(['init', dir]);
    const code = await runCli(['import', dir, '--apply']);
    expect(code).toBe(2);
  });

  it('an unknown command exits 1 with usage', async () => {
    const code = await runCli(['bogus']);
    expect(code).toBe(1);
  });
});
