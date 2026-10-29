// rememberFlow: the admission gate (plan §3/§4/§5). ONE LLM call (v0.5)
// answers the four gate questions and distills the record together; the
// gate also sees the castle's top keyword hits for the text, so novelty and
// duplicates are judged against what is already stored. A failing gate
// returns a structured failure the route maps to 422. A passing gate appends
// the record to chronicle (green level) — unless dryRun, which reports the
// decision only.
//
// The distilled fact must obey architecture §2 (one line, ≤ factMaxChars):
// checked in code, never trusted. An offending fact gets one rewrite call;
// if that is still over, nothing is written and the result fails
// `factTooLong` — the fact is never truncated.

import type { Castle } from '../core/castle.js';
import type { CastleRecord, Confidence } from '../core/types.js';
import type { LlmService } from '../server/llm-seam.js';
import { REMEMBER_SCHEMA, REWRITE_FACTS_SCHEMA } from '../llm/schemas.js';
import { rememberPrompt, rewriteFactsPrompt } from '../llm/prompts.js';
import { factProblem, topSearchHits } from './flow-helpers.js';

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

interface RememberAnswer {
  novel: boolean;
  reusable: boolean;
  verifiable: boolean;
  secretRefusal: boolean;
  reason: string;
  fact: string;
  confidence: Confidence;
  tags: string[];
}

interface RewriteFactsResult {
  items: { key: string; facts: string[] }[];
}

export async function rememberFlow(castle: Castle, llmService: LlmService, input: RememberInput): Promise<RememberResult> {
  const source = input.source ?? 'agent';
  const { budgets } = await castle.getMeta();
  const hits = await topSearchHits(castle, input.text);

  const answer = await llmService.judge<RememberAnswer>({
    ...rememberPrompt({ text: input.text, source, factMaxChars: budgets.factMaxChars, hits }),
    schema: REMEMBER_SCHEMA,
  });

  const failedTests: string[] = [];
  if (answer.secretRefusal) failedTests.push('secretRefusal');
  if (!answer.novel) failedTests.push('novel');
  if (!answer.reusable) failedTests.push('reusable');
  if (!answer.verifiable) failedTests.push('verifiable');

  if (failedTests.length > 0) {
    return { passed: false, failedTests, reason: answer.reason };
  }

  if (input.dryRun) {
    return { passed: true, dryRun: true };
  }

  let fact = answer.fact.trim();
  if (factProblem(fact, budgets.factMaxChars)) {
    const rewrite = await llmService.judge<RewriteFactsResult>({
      ...rewriteFactsPrompt({ items: [{ key: 'fact', fact }], factMaxChars: budgets.factMaxChars, allowSplit: false, retry: false }),
      schema: REWRITE_FACTS_SCHEMA,
    });
    const facts = (rewrite.items.find((i) => i.key === 'fact')?.facts ?? []).map((f) => f.trim());
    if (facts.length !== 1 || factProblem(facts[0], budgets.factMaxChars)) {
      return {
        passed: false,
        failedTests: ['factTooLong'],
        reason: `精煉後的事實仍不符「單行、至多 ${budgets.factMaxChars} 字元」的上限（已重試一次），未寫入；請拆成多筆再記。`,
      };
    }
    fact = facts[0];
  }

  const record = await castle.chronicle.append({
    confidence: answer.confidence,
    source,
    fact,
    tags: answer.tags,
  });

  return { passed: true, dryRun: false, record };
}
