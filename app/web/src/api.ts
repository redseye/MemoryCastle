// Thin typed wrapper over the REST API (src/server/routes/*.ts). Errors come
// back as { error: { code, message } } (src/server/app.ts onError) and are
// surfaced as ApiError so callers/components can branch on `code`.

import type {
  CastleOverview,
  CastleRecord,
  DoctorReport,
  ImportApplySummary,
  ImportPreviewResult,
  KeepSection,
  KeepSections,
  PatrolJob,
  ProjectRegistration,
  StaleDecision,
  RecordInput,
  RoomFile,
  RoomInput,
  RoomPatch,
  RouteDef,
  UserConfig,
  WalkResponse,
} from './types';

const BASE = '/api/v1';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...JSON_HEADERS, ...init.headers } });
  const body = await parseBody(res);
  if (!res.ok) {
    const errBody = asRecord(body);
    const err = asRecord(errBody.error);
    throw new ApiError(
      res.status,
      typeof err.code === 'string' ? err.code : 'unknown_error',
      typeof err.message === 'string' ? err.message : `HTTP ${res.status}`,
    );
  }
  return body as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined });
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

// ---- projects ----

export function listProjects(): Promise<{ projects: ProjectRegistration[] }> {
  return get('/projects');
}

export interface RegisterProjectResult {
  project: ProjectRegistration;
  needsInit: boolean;
}

// POST /projects has a dual-purpose 409: the project IS registered even when
// there's no castle yet, and the body carries `project` alongside the error
// so the caller can offer an init button. The generic request() helper would
// just throw on 409, discarding that project — handle it by hand here.
export async function registerProject(root: string, name?: string): Promise<RegisterProjectResult> {
  const res = await fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ root, name }),
  });
  const body = asRecord(await parseBody(res));
  if (res.status === 201) return { project: body.project as ProjectRegistration, needsInit: false };
  if (res.status === 409 && body.project) {
    return { project: body.project as ProjectRegistration, needsInit: true };
  }
  const err = asRecord(body.error);
  throw new ApiError(res.status, (err.code as string) ?? 'unknown_error', (err.message as string) ?? `HTTP ${res.status}`);
}

export function unregisterProject(id: string): Promise<{ ok: true }> {
  return del(`/projects/${id}`);
}

export function initProject(id: string) {
  return post(`/projects/${id}/init`);
}

export function getCastleOverview(id: string): Promise<CastleOverview> {
  return get(`/projects/${id}/castle`);
}

// ---- keep (yellow: confirm required) ----

export function getKeep(id: string): Promise<{ sections: KeepSections }> {
  return get(`/projects/${id}/keep`);
}

export function addKeepRecord(id: string, section: KeepSection, input: RecordInput): Promise<CastleRecord> {
  return post(`/projects/${id}/keep/records`, { ...input, section, confirm: true });
}

export function deleteKeepRecord(id: string, rid: string): Promise<CastleRecord> {
  return del(`/projects/${id}/keep/records/${rid}?confirm=true`);
}

// ---- chronicle (green: direct append) ----

export function getChronicle(id: string): Promise<{ entries: CastleRecord[] }> {
  return get(`/projects/${id}/chronicle`);
}

export function addChronicleRecord(id: string, input: RecordInput): Promise<CastleRecord> {
  return post(`/projects/${id}/chronicle/records`, input);
}

// ---- remember (LLM admission gate) ----

export type RememberResult =
  | { kind: 'success'; record: CastleRecord }
  | { kind: 'dryRunPassed' }
  | { kind: 'failed'; failedTests: string[]; reason: string }
  | { kind: 'notConfigured' };

export async function remember(
  id: string,
  body: { text: string; source?: string; dryRun?: boolean },
): Promise<RememberResult> {
  const res = await fetch(`${BASE}/projects/${id}/remember`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  const data = asRecord(await parseBody(res));
  if (res.status === 201) return { kind: 'success', record: data as unknown as CastleRecord };
  if (res.status === 200 && data.dryRun) return { kind: 'dryRunPassed' };
  if (res.status === 422) {
    return {
      kind: 'failed',
      failedTests: Array.isArray(data.failedTests) ? (data.failedTests as string[]) : [],
      reason: typeof data.reason === 'string' ? data.reason : '',
    };
  }
  const err = asRecord(data.error);
  if (res.status === 409 && err.code === 'llm_not_configured') return { kind: 'notConfigured' };
  throw new ApiError(res.status, (err.code as string) ?? 'unknown_error', (err.message as string) ?? `HTTP ${res.status}`);
}

// ---- rooms ----

export function getRooms(id: string): Promise<{ rooms: RoomFile[] }> {
  return get(`/projects/${id}/rooms`);
}

export function getRoom(id: string, slug: string): Promise<RoomFile> {
  return get(`/projects/${id}/rooms/${slug}`);
}

export function createRoom(id: string, input: RoomInput): Promise<RoomFile> {
  return post(`/projects/${id}/rooms`, input);
}

export function patchRoom(id: string, slug: string, patchBody: RoomPatch): Promise<RoomFile> {
  return patch(`/projects/${id}/rooms/${slug}`, patchBody);
}

export function addRoomRecord(id: string, slug: string, input: RecordInput): Promise<CastleRecord> {
  return post(`/projects/${id}/rooms/${slug}/records`, input);
}

export function deleteRoom(id: string, slug: string): Promise<RoomFile> {
  return del(`/projects/${id}/rooms/${slug}?confirm=true`);
}

// ---- routes ----

export function getRoutes(id: string): Promise<{ routes: RouteDef[] }> {
  return get(`/projects/${id}/routes`);
}

// ---- doctor ----

export function getDoctorReport(id: string): Promise<DoctorReport> {
  return get(`/projects/${id}/doctor`);
}

// ---- walks ----

export function walk(id: string, route: string, paths?: string[]): Promise<WalkResponse> {
  return post(`/projects/${id}/walks`, paths && paths.length > 0 ? { route, paths } : { route });
}

// ---- patrol ----

export function runPatrol(id: string, full = false): Promise<PatrolJob> {
  return post(`/projects/${id}/patrol`, full ? { full: true } : undefined);
}

export function getPatrolJob(id: string, jobId: string): Promise<PatrolJob> {
  return get(`/projects/${id}/patrol/jobs/${jobId}`);
}

export function applyPatrol(
  id: string,
  jobId: string,
  approvals: string[],
  decisions: Record<string, StaleDecision> = {},
): Promise<PatrolJob> {
  return post(`/projects/${id}/patrol/jobs/${jobId}/apply`, { approvals, decisions });
}

export function cancelPatrol(id: string): Promise<{ cancelled: true }> {
  return post(`/projects/${id}/patrol/cancel`);
}

// ---- import ----

export function importPreview(id: string): Promise<ImportPreviewResult> {
  return post(`/projects/${id}/import`);
}

export function importApply(id: string): Promise<ImportApplySummary> {
  return post(`/projects/${id}/import/apply`);
}

// ---- settings ----

export function getSettings(): Promise<UserConfig> {
  return get('/settings');
}

export function putSettings(body: {
  port?: number;
  llm?: { provider?: string; apiKey?: string; model?: string; mode?: string };
}): Promise<UserConfig> {
  return request('/settings', { method: 'PUT', body: JSON.stringify(body) });
}

export function testSettings(): Promise<{ ok: true }> {
  return post('/settings/test');
}

export function getCliStatus(): Promise<Record<'claude' | 'codex' | 'agy', { found: boolean; version?: string }>> {
  return get('/settings/cli-status');
}

// ---- system ----

export type PickFolderResult = { path: string } | { cancelled: true };

// Native folder-selection dialog (Windows only — see docs/api.md). 501/409/408
// come back as ApiError like any other endpoint; the caller branches on
// `cancelled` vs. `path` for the 200 case.
export function pickFolder(): Promise<PickFolderResult> {
  return post('/system/pick-folder');
}
