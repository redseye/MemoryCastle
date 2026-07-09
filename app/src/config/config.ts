// Read/write ~/.memorycastle/config.json. MEMORYCASTLE_CONFIG overrides the
// file path; MEMORYCASTLE_PORT overrides the effective port. apiKey is never
// logged: use maskApiKey() before displaying or printing a config anywhere.

import { homedir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { readJsonFileIfExists, writeJsonFile } from '../storage/json-file.js';
import { toForwardSlash } from '../storage/paths.js';
import { slugify, uniqueSlug } from '../util/slugify.js';
import type { ProjectRegistration, UserConfig } from './types.js';

const DEFAULT_PORT = 7420;

export function defaultConfig(): UserConfig {
  return {
    schema: 1,
    port: DEFAULT_PORT,
    llm: { provider: 'anthropic', apiKey: '', model: 'claude-sonnet-5', mode: 'api' },
    projects: [],
  };
}

export function getConfigPath(): string {
  return process.env.MEMORYCASTLE_CONFIG || join(homedir(), '.memorycastle', 'config.json');
}

// A hand-edited or partially-written config.json (even `{}`) must never crash
// a route — deep-merge onto defaultConfig() so every field is always present.
function mergeWithDefaults(partial: Partial<UserConfig> | undefined): UserConfig {
  const defaults = defaultConfig();
  if (!partial) return defaults;
  return {
    schema: 1,
    port: typeof partial.port === 'number' ? partial.port : defaults.port,
    llm: { ...defaults.llm, ...(partial.llm ?? {}) },
    projects: Array.isArray(partial.projects) ? partial.projects : defaults.projects,
  };
}

export async function readConfig(): Promise<UserConfig> {
  const config = await readJsonFileIfExists<Partial<UserConfig>>(getConfigPath());
  return mergeWithDefaults(config);
}

export async function writeConfig(config: UserConfig): Promise<void> {
  await writeJsonFile(getConfigPath(), config);
}

// Effective port: MEMORYCASTLE_PORT env wins over the stored config value.
export function getPort(config: UserConfig): number {
  const envPort = process.env.MEMORYCASTLE_PORT;
  if (envPort) {
    const parsed = Number(envPort);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return config.port;
}

export function registerProject(
  config: UserConfig,
  root: string,
  name?: string
): { config: UserConfig; project: ProjectRegistration } {
  const normalizedRoot = toForwardSlash(resolve(root));
  const projectName = name ?? basename(normalizedRoot);
  const existingIds = new Set(config.projects.map((p) => p.id));
  const id = uniqueSlug(slugify(projectName), existingIds);
  const project: ProjectRegistration = { id, name: projectName, root: normalizedRoot };
  return { config: { ...config, projects: [...config.projects, project] }, project };
}

export function unregisterProject(config: UserConfig, id: string): UserConfig {
  return { ...config, projects: config.projects.filter((p) => p.id !== id) };
}

// Never log a UserConfig directly — pass it through this first.
export function maskApiKey(config: UserConfig): UserConfig {
  const { apiKey } = config.llm;
  const masked = apiKey ? `${'*'.repeat(Math.max(apiKey.length - 4, 0))}${apiKey.slice(-4)}` : '';
  return { ...config, llm: { ...config.llm, apiKey: masked } };
}
