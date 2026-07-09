// User-level config schema (plan §7): ~/.memorycastle/config.json.

export type LlmProviderId = 'anthropic' | 'gemini' | 'openai';

// M8: 'cli' shells out to a locally-installed, already-logged-in official
// CLI (see src/llm/cli.ts) instead of calling the provider's HTTP API with
// apiKey. Optional and additive — absent/undefined means 'api', so configs
// written before M8 keep working unchanged (config.ts's deep-merge default
// fills this in as 'api' either way).
export type LlmMode = 'api' | 'cli';

export interface LlmConfig {
  provider: LlmProviderId;
  apiKey: string;
  model: string;
  mode?: LlmMode;
}

export interface ProjectRegistration {
  id: string;
  name: string;
  root: string; // forward-slash absolute path
}

export interface UserConfig {
  schema: 1;
  port: number;
  llm: LlmConfig;
  projects: ProjectRegistration[];
}
