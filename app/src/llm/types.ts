// Re-exports so llm/ modules don't reach across two directories for the
// same handful of shared types.
export type { JudgeTask, LlmService } from '../server/llm-seam.js';
export type { LlmConfig, LlmProviderId } from '../config/types.js';
