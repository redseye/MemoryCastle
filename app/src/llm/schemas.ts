// JSON Schema literals for the 7 judgment tasks (plan §4), shared verbatim
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

export const GATE_DECISION_SCHEMA = {
  type: 'object',
  properties: {
    novel: { type: 'boolean' },
    reusable: { type: 'boolean' },
    verifiable: { type: 'boolean' },
    secretRefusal: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['novel', 'reusable', 'verifiable', 'secretRefusal', 'reason'],
  additionalProperties: false,
} as const;

export const DISTILL_SCHEMA = {
  type: 'object',
  properties: {
    fact: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'med', 'low'] },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['fact', 'confidence', 'tags'],
  additionalProperties: false,
} as const;

// records: one entry per distinct fact (patrol's cluster distillation, unlike
// DISTILL_SCHEMA's single-fact shape used by rememberFlow). The "1 to 8
// records" bound is enforced via the prompt text and a runtime guard in
// patrolFlow, not minItems/maxItems — this file avoids numeric constraints
// (see header comment) because they aren't supported across every
// provider's strict structured-output mode.
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
        },
        required: ['fact', 'confidence', 'tags'],
        additionalProperties: false,
      },
    },
  },
  required: ['records'],
  additionalProperties: false,
} as const;

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
        },
        required: ['entryIds', 'locus', 'topic'],
        additionalProperties: false,
      },
    },
  },
  required: ['clusters'],
  additionalProperties: false,
} as const;

// targetRoomSlug: "" means no existing room fits — propose a new room using
// name/locus/adjacent instead.
export const ROOM_PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    targetRoomSlug: { type: 'string' },
    name: { type: 'string' },
    locus: { type: 'array', items: { type: 'string' } },
    adjacent: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
  required: ['targetRoomSlug', 'name', 'locus', 'adjacent', 'reason'],
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
