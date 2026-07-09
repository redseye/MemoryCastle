import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import {
  defaultConfig,
  getConfigPath,
  getPort,
  maskApiKey,
  readConfig,
  registerProject,
  writeConfig,
} from '../src/config/index.js';
import { makeTempDir, cleanupTempDir } from './helpers.js';

describe('config', () => {
  let dir: string;
  const originalConfigEnv = process.env.MEMORYCASTLE_CONFIG;
  const originalPortEnv = process.env.MEMORYCASTLE_PORT;

  beforeEach(async () => {
    dir = await makeTempDir();
  });
  afterEach(async () => {
    await cleanupTempDir(dir);
    if (originalConfigEnv === undefined) delete process.env.MEMORYCASTLE_CONFIG;
    else process.env.MEMORYCASTLE_CONFIG = originalConfigEnv;
    if (originalPortEnv === undefined) delete process.env.MEMORYCASTLE_PORT;
    else process.env.MEMORYCASTLE_PORT = originalPortEnv;
  });

  it('MEMORYCASTLE_CONFIG overrides the config file path', async () => {
    const customPath = join(dir, 'custom-config.json');
    process.env.MEMORYCASTLE_CONFIG = customPath;
    expect(getConfigPath()).toBe(customPath);

    const config = defaultConfig();
    config.llm.apiKey = 'sk-test-123';
    await writeConfig(config);

    const read = await readConfig();
    expect(read.llm.apiKey).toBe('sk-test-123');
  });

  it('readConfig returns a default config when no file exists yet', async () => {
    process.env.MEMORYCASTLE_CONFIG = join(dir, 'does-not-exist.json');
    expect(await readConfig()).toEqual(defaultConfig());
  });

  it('readConfig deep-merges an incomplete hand-edited config.json onto defaults', async () => {
    const customPath = join(dir, 'partial-config.json');
    process.env.MEMORYCASTLE_CONFIG = customPath;
    await writeConfig({} as ReturnType<typeof defaultConfig>);

    const read = await readConfig();
    expect(read).toEqual(defaultConfig());
  });

  it('readConfig fills in missing llm fields while keeping the ones present', async () => {
    const customPath = join(dir, 'partial-llm-config.json');
    process.env.MEMORYCASTLE_CONFIG = customPath;
    await writeConfig({ schema: 1, llm: { apiKey: 'sk-partial' } } as unknown as ReturnType<typeof defaultConfig>);

    const read = await readConfig();
    expect(read.llm.apiKey).toBe('sk-partial');
    expect(read.llm.provider).toBe('anthropic');
    expect(read.llm.model).toBe('claude-sonnet-5');
    expect(read.port).toBe(7420);
    expect(read.projects).toEqual([]);
  });

  it('MEMORYCASTLE_PORT overrides the stored port', () => {
    process.env.MEMORYCASTLE_PORT = '9999';
    expect(getPort({ ...defaultConfig(), port: 7420 })).toBe(9999);
  });

  it('falls back to the stored port when MEMORYCASTLE_PORT is unset', () => {
    delete process.env.MEMORYCASTLE_PORT;
    expect(getPort({ ...defaultConfig(), port: 1234 })).toBe(1234);
  });

  it('registerProject assigns a slugified id and a forward-slash root', () => {
    const { project } = registerProject(defaultConfig(), dir, 'My Project');
    expect(project.id).toBe('my-project');
    expect(project.root).not.toContain('\\');
  });

  it('registerProject appends a numeric suffix on id collision', () => {
    const first = registerProject(defaultConfig(), dir, 'Same Name');
    const second = registerProject(first.config, dir, 'Same Name');
    expect(first.project.id).toBe('same-name');
    expect(second.project.id).toBe('same-name-2');
  });

  it('defaultConfig sets llm.mode to "api"', () => {
    expect(defaultConfig().llm.mode).toBe('api');
  });

  it('readConfig fills in mode:"api" for a pre-M8 config.json that has no mode field', async () => {
    const customPath = join(dir, 'pre-m8-config.json');
    process.env.MEMORYCASTLE_CONFIG = customPath;
    await writeConfig({
      schema: 1,
      llm: { provider: 'anthropic', apiKey: 'sk-old', model: 'claude-sonnet-5' },
    } as unknown as ReturnType<typeof defaultConfig>);

    const read = await readConfig();
    expect(read.llm.mode).toBe('api');
    expect(read.llm.apiKey).toBe('sk-old');
  });

  it('readConfig preserves an explicit mode:"cli"', async () => {
    const customPath = join(dir, 'cli-mode-config.json');
    process.env.MEMORYCASTLE_CONFIG = customPath;
    const config = defaultConfig();
    config.llm.mode = 'cli';
    config.llm.provider = 'gemini';
    await writeConfig(config);

    const read = await readConfig();
    expect(read.llm.mode).toBe('cli');
    expect(read.llm.provider).toBe('gemini');
  });

  it('maskApiKey never exposes the full key', () => {
    const config = defaultConfig();
    config.llm.apiKey = 'sk-ant-abcdef1234567890';
    const masked = maskApiKey(config);
    expect(masked.llm.apiKey).not.toBe(config.llm.apiKey);
    expect(masked.llm.apiKey.endsWith('7890')).toBe(true);
    expect(masked.llm.apiKey).not.toContain('abcdef');
  });
});
