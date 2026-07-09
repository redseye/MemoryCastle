import { useSyncExternalStore } from 'react';
import { applyPatrol, runPatrol } from './api';
import type { PatrolJob } from './types';

// 巡查在 CLI 模式下可能跑數分鐘。狀態若放在 PatrolPage 的 useState，切到別頁
// unmount 就全丟：回來時按鈕又能按、也看不出還在不在跑。所以生命週期狀態放在
// 模組層（以 projectId 為 key），元件 unmount 期間 fetch 照飛、結果照存，
// 重新掛載時經 usePatrolState 接回同一份進度。
export interface PatrolState {
  running: boolean;
  applying: boolean;
  /** 本輪巡查的起跑時間（epoch ms），供重新掛載後續算已耗秒數。 */
  startedAt: number | null;
  job: PatrolJob | null;
  error: Error | null;
}

const IDLE: PatrolState = { running: false, applying: false, startedAt: null, job: null, error: null };

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

export function startPatrol(projectId: string): void {
  const cur = states.get(projectId) ?? IDLE;
  if (cur.running || cur.applying) return;
  setState(projectId, { running: true, startedAt: Date.now(), job: null, error: null });
  runPatrol(projectId)
    .then((job) => setState(projectId, { running: false, job }))
    .catch((e: unknown) => setState(projectId, { running: false, error: toError(e) }));
}

export function startApply(projectId: string, jobId: string, approvals: string[]): void {
  const cur = states.get(projectId) ?? IDLE;
  if (cur.running || cur.applying) return;
  setState(projectId, { applying: true, error: null });
  applyPatrol(projectId, jobId, approvals)
    .then((job) => setState(projectId, { applying: false, job }))
    .catch((e: unknown) => setState(projectId, { applying: false, error: toError(e) }));
}
