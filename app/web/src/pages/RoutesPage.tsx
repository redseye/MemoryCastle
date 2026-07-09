import { useState } from 'react';
import { getRoutes, walk } from '../api';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner, Loading } from '../components/ErrorBanner';
import { useAsync } from '../hooks';
import { useProjects } from '../ProjectContext';
import type { WalkResponse } from '../types';

function WalkStepper({ result, onClose }: { result: WalkResponse; onClose: () => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const total = result.stops.length;
  const visibleStops = result.stops.slice(0, stepIndex + 1);

  return (
    <div className="panel">
      <div className="banner banner-info">{result.report.text}</div>
      <p className="stepper-progress">
        步進顯示：站 {Math.min(stepIndex + 1, total)}/{total}
      </p>
      {visibleStops.map((stop, i) => (
        <div key={`${stop.target}-${i}`} className="stepper-stop">
          <h3>{stop.target}</h3>
          {stop.lines.length === 0 ? (
            <p className="card-meta">（此站無內容）</p>
          ) : (
            <ul>
              {stop.lines.map((line, li) => (
                <li key={li}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <div className="btn-row">
        <button type="button" className="btn" disabled={stepIndex <= 0} onClick={() => setStepIndex((i) => Math.max(i - 1, 0))}>
          上一站
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={stepIndex >= total - 1}
          onClick={() => setStepIndex((i) => Math.min(i + 1, total - 1))}
        >
          下一站
        </button>
        <button type="button" className="btn" onClick={onClose}>
          關閉
        </button>
      </div>
    </div>
  );
}

function RouteRow({ projectId, name, occasion }: { projectId: string; name: string; occasion: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<WalkResponse | null>(null);
  const [paths, setPaths] = useState('');

  async function handleWalk() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const pathList = paths
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      const r = await walk(projectId, name, pathList);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
        <div>
          <h3>{name}</h3>
          <p className="card-meta">{occasion}</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={handleWalk}>
          走一遍
        </button>
      </div>
      <label>
        本次要處理的檔案路徑（選填，逗號分隔，用於比對房間 locus）
        <input type="text" value={paths} onChange={(e) => setPaths(e.target.value)} placeholder="scripts/build.mjs, src/llm/anthropic.ts" />
      </label>
      <ErrorBanner error={error} />
      {result && <WalkStepper result={result} onClose={() => setResult(null)} />}
    </div>
  );
}

function RouteList({ projectId }: { projectId: string }) {
  const { data, loading, error } = useAsync(() => getRoutes(projectId), [projectId]);

  if (loading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;
  if (!data || data.routes.length === 0) {
    return <EmptyState title="尚無路線" hint="路線由城堡初始化或匯入產生。" />;
  }

  return (
    <>
      {data.routes.map((r) => (
        <RouteRow key={r.name} projectId={projectId} name={r.name} occasion={r.occasion} />
      ))}
    </>
  );
}

export function RoutesPage() {
  const { currentProjectId } = useProjects();

  if (!currentProjectId) {
    return (
      <div>
        <h1>路線與巡行</h1>
        <EmptyState title="尚未選擇專案" hint="請先到「總覽」頁面選擇或註冊一個專案。" />
      </div>
    );
  }

  return (
    <div>
      <h1>路線與巡行</h1>
      <p className="page-intro">
        每個城堡固定有 session-start／before-release／patrol 三條路線（匯入舊城堡時可能還有自訂路線）。點選「走一遍」實際執行並逐站顯示內容。
      </p>
      <RouteList projectId={currentProjectId} />
    </div>
  );
}
