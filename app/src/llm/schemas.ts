// JSON Schema literals for the LLM judgment tasks (plan §4; v0.5 set), shared verbatim
// with every provider call (JudgeTask.schema). Kept to the subset every
// provider's structured-output mode supports: object/array/string/boolean,
// enum, required, additionalProperties:false — no nullable unions, no
// numeric constraints. Optional concepts (e.g. "no existing room fits") are
// modeled as an empty string rather than null so the schema stays uniform
// across Anthropic/Gemini/OpenAI strict mode.
//
// validateAgainstSchema is the hand-written validator plan §1 calls for
// (no validation library) — it understands exactly the subset of JSON Schema
// used by the literals below.

// rememberFlow's single call (v0.5): the four gatehouse answers plus the
// distilled record in one response, so admitting a memory costs one LLM
// round-trip instead of a gate call followed by a distill call. The fact is
// only used when every gate test passes.
export const REMEMBER_SCHEMA = {
  type: 'object',
  properties: {
    novel: { type: 'boolean' },
    reusable: { type: 'boolean' },
    verifiable: { type: 'boolean' },
    secretRefusal: { type: 'boolean' },
    reason: { type: 'string' },
    fact: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'med', 'low'] },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['novel', 'reusable', 'verifiable', 'secretRefusal', 'reason', 'fact', 'confidence', 'tags'],
  additionalProperties: false,
} as const;

// records: one entry per distinct fact (patrol's cluster distillation). The
// "1 to 8 records" bound is enforced via the prompt text and a runtime guard
// in patrolFlow, not minItems/maxItems — this file avoids numeric
// constraints (see header comment) because they aren't supported across
// every provider's strict structured-output mode. The factMaxChars cap is
// likewise checked in code after the call (patrolFlow), never trusted.
// passesGate re-applies the §3 novelty/reuse tests (architecture §4 step 2):
// a record that fails is not written, its entries are archived.
export const DISTILL_CLUSTER_SCHEMA = {
  type: 'object',
  properties: {
    records: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fact: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'med', 'low'] },
          tags: { type: 'array', items: { type: 'string' } },
          passesGate: { type: 'boolean' },
        },
        required: ['fact', 'confidence', 'tags', 'passesGate'],
        additionalProperties: false,
      },
    },
  },
  required: ['records'],
  additionalProperties: false,
} as const;

// One call clusters the chronicle AND says where each cluster goes (v0.5
// folds the old per-cluster roomProposal call in here): targetRoomSlug ""
// means no existing room owns it, and newRoom* then describe the proposed
// room (empty when targetRoomSlug is set). orphans routes the entries the
// prompt marks [aged] that joined no cluster: targetRoomSlug "" = no owner;
// passesGate = the §3 novelty/reuse re-check a promoted orphan must pass.
export const CLUSTER_ENTRIES_SCHEMA = {
  type: 'object',
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entryIds: { type: 'array', items: { type: 'string' } },
          locus: { type: 'string' },
          topic: { type: 'string' },
          targetRoomSlug: { type: 'string' },
          newRoomName: { type: 'string' },
          newRoomLocus: { type: 'array', items: { type: 'string' } },
          newRoomAdjacent: { type: 'array', items: { type: 'string' } },
        },
        required: ['entryIds', 'locus', 'topic', 'targetRoomSlug', 'newRoomName', 'newRoomLocus', 'newRoomAdjacent'],
        additionalProperties: false,
      },
    },
    orphans: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entryId: { type: 'string' },
          targetRoomSlug: { type: 'string' },
          passesGate: { type: 'boolean' },
        },
        required: ['entryId', 'targetRoomSlug', 'passesGate'],
        additionalProperties: false,
      },
    },
  },
  required: ['clusters', 'orphans'],
  additionalProperties: false,
} as const;

// Rewrites facts that break the §2 cap (over factMaxChars or multi-line):
// one item per input key, each with one or more replacement facts. Used for
// the one retry after an over-cap distill, for splitting existing over-cap
// records (patrol 5d), and for remember's one retry.
export const REWRITE_FACTS_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          facts: { type: 'array', items: { type: 'string' } },
        },
        required: ['key', 'facts'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

// A room over roomMax (patrol 5a): merge near-duplicates (recordIds -> one
// fact) and/or cut records to archive. Every proposal stays yellow.
export const ROOM_DISTILL_SCHEMA = {
  type: 'object',
  properties: {
    merges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          recordIds: { type: 'array', items: { type: 'string' } },
          fact: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['recordIds', 'fact', 'tags'],
        additionalProperties: false,
      },
    },
    cuts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          recordId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['recordId', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['merges', 'cuts'],
  additionalProperties: false,
} as const;

// Keep over keepMax (patrol 6): demote a record to the room owning it, or
// move it to archive (targetRoomSlug "" for archive). Always yellow.
export const KEEP_CUT_SCHEMA = {
  type: 'object',
  properties: {
    cuts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          recordId: { type: 'string' },
          action: { type: 'string', enum: ['demote', 'archive'] },
          targetRoomSlug: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['recordId', 'action', 'targetRoomSlug', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['cuts'],
  additionalProperties: false,
} as const;

export const CONTRADICTION_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    contradictions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          loserId: { type: 'string' },
          winnerId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['loserId', 'winnerId', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['contradictions'],
  additionalProperties: false,
} as const;

export const KEEP_PROMOTION_SCHEMA = {
  type: 'object',
  properties: {
    promotions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          recordId: { type: 'string' },
          section: { type: 'string', enum: ['identity', 'constraints', 'core'] },
          reason: { type: 'string' },
        },
        required: ['recordId', 'section', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['promotions'],
  additionalProperties: false,
} as const;

export const FUZZY_ROOM_SELECT_SCHEMA = {
  type: 'object',
  properties: {
    roomSlugs: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
  required: ['roomSlugs', 'reason'],
  additionalProperties: false,
} as const;

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonSchemaNode = any;

function validateNode(schema: JsonSchemaNode, value: unknown, path: string, errors: string[]): void {
  if (schema === null || typeof schema !== 'object') return;

  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push(`${path}: expected object`);
        return;
      }
      const obj = value as Record<string, unknown>;
      const required: string[] = schema.required ?? [];
      for (const key of required) {
        if (!(key in obj)) errors.push(`${path}.${key}: missing required field`);
      }
      const properties = schema.properties ?? {};
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in obj) validateNode(propSchema, obj[key], `${path}.${key}`, errors);
      }
      break;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array`);
        return;
      }
      if (schema.items) {
        value.forEach((item, index) => validateNode(schema.items, item, `${path}[${index}]`, errors));
      }
      break;
    }
    case 'string': {
      if (typeof value !== 'string') {
        errors.push(`${path}: expected string`);
        return;
      }
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${path}: "${value}" is not one of [${schema.enum.join(', ')}]`);
      }
      break;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`);
      break;
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number') errors.push(`${path}: expected number`);
      break;
    }
    default:
      break;
  }
}

export function validateAgainstSchema(schema: unknown, value: unknown): SchemaValidationResult {
  const errors: string[] = [];
  validateNode(schema, value, '$', errors);
  return { valid: errors.length === 0, errors };
}
