// rememberFlow: the admission gate (plan §3/§4/§5). Runs gateDecision;
// a failing gate returns a structured failure the route maps to 422. A
// passing gate distills the text into one record and appends it to
// chronicle (green level) — unless dryRun, which reports the decision only.

import type { Castle } from '../core/castle.js';
import type { CastleRecord, Confidence } from '../core/types.js';
import type { LlmService } from '../server/llm-seam.js';
import { DISTILL_SCHEMA, GATE_DECISION_SCHEMA } from '../llm/schemas.js';
import { distillPrompt, gateDecisionPrompt } from '../llm/prompts.js';

export interface RememberInput {
  text: string;
  source?: string;
  dryRun?: boolean;
}

export interface RememberPassed {
  passed: true;
  dryRun: boolean;
  record?: CastleRecord;
}

export interface RememberFailed {
  passed: false;
  failedTests: string[];
  reason: string;
}

export type RememberResult = RememberPassed | RememberFailed;

interface GateDecision {
  novel: boolean;
  reusable: boolean;
  verifiable: boolean;
  secretRefusal: boolean;
  reason: string;
}

interface Distilled {
  fact: string;
  confidence: Confidence;
  tags: string[];
}

export async function rememberFlow(castle: Castle, llmService: LlmService, input: RememberInput): Promise<RememberResult> {
  const source = input.source ?? 'agent';

  const decision = await llmService.judge<GateDecision>({
    ...gateDecisionPrompt({ text: input.text, source }),
    schema: GATE_DECISION_SCHEMA,
  });

  const failedTests: string[] = [];
  if (decision.secretRefusal) failedTests.push('secretRefusal');
  if (!decision.novel) failedTests.push('novel');
  if (!decision.reusable) failedTests.push('reusable');
  if (!decision.verifiable) failedTests.push('verifiable');

  if (failedTests.length > 0) {
    return { passed: false, failedTests, reason: decision.reason };
  }

  if (input.dryRun) {
    return { passed: true, dryRun: true };
  }

  const distilled = await llmService.judge<Distilled>({
    ...distillPrompt({ text: input.text, source }),
    schema: DISTILL_SCHEMA,
  });

  const record = await castle.chronicle.append({
    confidence: distilled.confidence,
    source,
    fact: distilled.fact,
    tags: distilled.tags,
  });

  return { passed: true, dryRun: false, record };
}
