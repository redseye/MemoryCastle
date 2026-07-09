// Thrown by route handlers for expected client-facing failures (bad body,
// missing confirm flag, unknown project id, ...). Caught centrally in
// app.ts's onError and turned into the plan §5 error envelope
// { error: { code, message } }.

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}
