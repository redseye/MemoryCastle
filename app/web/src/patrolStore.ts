import { useSyncExternalStore } from 'react';
import { ApiError, applyPatrol, cancelPatrol as apiCancelPatrol, runPatrol } from './api';
import type { PatrolJob, StaleDecision } from './types';

// 巡查在 CLI 模式下可能跑數分鐘。狀態若放在 PatrolPage 的 useState，切到別頁
// unmount 就全丟：回來時按鈕又能按、也看不出還在不在跑。所以生命週期狀態放在
// 模組層（以 projectId 為 key），元件 unmount 期間 fetch 照飛、結果照存，
// 重新掛載時經 usePatrolState 接回同一份進度。
export interface PatrolState {
  running: boolean;
  applying: boolean;
  /** 使用者已按下「取消」、正等待伺服器確認終止。 */
  cancelling: boolean;
  /** 本輪巡查的起跑時間（epoch ms），供重新掛載後續算已耗秒數。 */
  startedAt: number | null;
  job: PatrolJob | null;
  error: Error | null;
  /** 非錯誤的短暫提示（例如「已取消」），不走 ErrorBanner 的紅色樣式。 */
  notice: string | null;
}

const IDLE: PatrolState = {
  running: false,
  applying: false,
  cancelling: false,
  startedAt: null,
  job: null,
  error: null,
  notice: null,
};

const states = new Map<string, PatrolState>();
const listeners = new Set<() => void>();

function setState(projectId: string, patch: Partial<PatrolState>): void {
  const prev = states.get(projectId) ?? IDLE;
  states.set(projectId, { ...prev, ...patch });
  listeners.forEach((l) => l());
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

export function usePatrolState(projectId: string | null): PatrolState {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => (projectId ? (states.get(projectId) ?? IDLE) : IDLE),
  );
}

export function startPatrol(projectId: string, full = false): void {
  const cur = states.get(projectId) ?? IDLE;
  if (cur.running || cur.applying) return;
  setState(projectId, { running: true, startedAt: Date.now(), job: null, error: null, notice: null });
  runPatrol(projectId, full)
    .then((job) => setState(projectId, { running: false, job }))
    .catch((e: unknown) => {
      const err = toError(e);
      // A user-triggered cancel (see cancelPatrol() below) resolves this same
      // request with 409 patrol_cancelled — that's an expected outcome, not
      // an error, so it clears to idle with a plain notice instead of the
      // red ErrorBanner.
      if (err instanceof ApiError && err.code === 'patrol_cancelled') {
        setState(projectId, { running: false, cancelling: false, error: null, notice: '巡查已取消' });
      } else {
        setState(projectId, { running: false, error: err });
      }
    });
}

// Cancels the currently-running patrol for projectId. The running request's
// own promise (see startPatrol above) settles independently once the server
// confirms cancellation — this call only reports whether the cancel request
// itself reached the server.
export function cancelPatrol(projectId: string): void {
  const cur = states.get(projectId) ?? IDLE;
  if (!cur.running || cur.cancelling) return;
  setState(projectId, { cancelling: true });
  apiCancelPatrol(projectId).catch((e: unknown) => {
    const err = toError(e);
    // 404 patrol_not_running: the patrol already finished on its own before
    // the cancel reached the server (race) — startPatrol's own handler above
    // already settled the state correctly, so there's nothing to show here.
    if (err instanceof ApiError && err.code === 'patrol_not_running') {
      setState(projectId, { cancelling: false });
    } else {
      setState(projectId, { cancelling: false, error: err });
    }
  });
}

export function startApply(projectId: string, jobId: string, approvals: string[], decisions: Record<string, StaleDecision> = {}): void {
  const cur = states.get(projectId) ?? IDLE;
  if (cur.running || cur.applying) return;
  setState(projectId, { applying: true, error: null });
  applyPatrol(projectId, jobId, approvals, decisions)
    .then((job) => setState(projectId, { applying: false, job }))
    .catch((e: unknown) => setState(projectId, { applying: false, error: toError(e) }));
}
