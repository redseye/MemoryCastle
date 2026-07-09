// Shared request-parsing helper: turns a malformed JSON body into the same
// HttpError shape every other validation failure uses, instead of letting
// Hono's raw SyntaxError leak into the generic 500 handler.

import type { Context } from 'hono';
import { HttpError } from './http-errors.js';

export async function jsonBody<T>(c: Context): Promise<T> {
  try {
    return await c.req.json<T>();
  } catch {
    throw new HttpError(400, 'invalid_json', 'request body 不是合法的 JSON');
  }
}
