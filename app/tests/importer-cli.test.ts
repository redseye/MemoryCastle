// CLI end-to-end coverage for `memorycastle import` against a copy of the
// real castle fixture (see importer-golden.test.ts for the underlying
// assertions on the importer itself).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../src/cli.js';
import { makeTempDir, cleanupTempDir } from './helpers.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_ROOT = join(here, 'fixtures', 'memorycastle-castle');

async function copyFixture(container: string): Promise<string> {
  const projectRoot = join(container, 'project');
  await cp(FIXTURE_ROOT, projectRoot, { recursive: true });
  return projectRoot;
}

describe('runCli import', () => {
  let container: string;
  afterEach(async () => {
    if (container) await cleanupTempDir(container);
  });

  it('preview mode prints counts and 0 warnings, and writes nothing', async () => {
    container = await makeTempDir();
    const projectRoot = await copyFixture(container);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['import', projectRoot]);

    expect(code).toBe(0);
    expect(existsSync(join(projectRoot, '.claude', 'castle', 'castle.json'))).toBe(false);
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('keep 6');
    expect(output).toContain('chronicle 16');
    expect(output).toContain('routes 3');
    expect(output).toContain('rooms 0');
    expect(output).toContain('警告 0 項');
    logSpy.mockRestore();
  });

  it('--apply performs the conversion and reports moved files', async () => {
    container = await makeTempDir();
    const projectRoot = await copyFixture(container);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await runCli(['import', projectRoot, '--apply']);

    expect(code).toBe(0);
    expect(existsSync(join(projectRoot, '.claude', 'castle', 'castle.json'))).toBe(true);
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('匯入完成');
    expect(output).toContain('已搬移');
    logSpy.mockRestore();
  });
});
