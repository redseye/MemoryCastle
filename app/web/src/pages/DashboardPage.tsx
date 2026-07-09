import { useState } from 'react';
import { getCastleOverview, initProject, pickFolder, registerProject } from '../api';
import { ErrorBanner, Loading } from '../components/ErrorBanner';
import { EmptyState } from '../components/EmptyState';
import { useAsync } from '../hooks';
import { useProjects } from '../ProjectContext';
import { navigate } from '../router';

function RegisterProjectForm() {
  const { refreshProjects, setCurrentProjectId } = useProjects();
  const [root, setRoot] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [needsInit, setNeedsInit] = useState<{ id: string; name: string } | null>(null);

  async function handleBrowse() {
    setPicking(true);
    setError(null);
    try {
      const result = await pickFolder();
      if ('path' in result) setRoot(result.path);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setPicking(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!root.trim()) return;
    setBusy(true);
    setError(null);
    setNeedsInit(null);
    try {
      const result = await registerProject(root.trim(), name.trim() || undefined);
      refreshProjects();
      if (result.needsInit) {
        setNeedsInit({ id: result.project.id, name: result.project.name });
      } else {
        setCurrentProjectId(result.project.id);
        setRoot('');
        setName('');
      }
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function handleInit() {
    if (!needsInit) return;
    setBusy(true);
    setError(null);
    try {
      await initProject(needsInit.id);
      setCurrentProjectId(needsInit.id);
      setNeedsInit(null);
      setRoot('');
      setName('');
      refreshProjects();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>註冊新專案</h3>
      <ErrorBanner error={error} />
      {needsInit ? (
        <div>
          <p className="banner banner-warning">
            已註冊為「{needsInit.name}」，但此目錄尚無城堡。
          </p>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={handleInit}>
            建立城堡
          </button>
        </div>
      ) : (
        <form className="form-grid" onSubmit={handleRegister}>
          <label>
            專案根目錄路徑
            <div className="btn-row">
              <input
                type="text"
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                placeholder="C:/path/to/project"
                required
                style={{ flex: 1 }}
              />
              <button type="button" className="btn" disabled={picking} onClick={handleBrowse}>
                {picking ? '選擇中…' : '瀏覽…'}
              </button>
            </div>
          </label>
          <label>
            專案名稱（選填）
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="預設使用資料夾名稱" />
          </label>
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              註冊
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function GaugeBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.min((count / max) * 100, 100) : 0;
  const over = count > max;
  return (
    <div className="gauge">
      <div className="gauge-label">
        <span>{label}</span>
        <span>
          {count}/{max}
        </span>
      </div>
      <div className="gauge-track">
        <div className={over ? 'gauge-fill over' : 'gauge-fill'} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ProjectOverview({ projectId }: { projectId: string }) {
  const { data, loading, error, reload } = useAsync(() => getCastleOverview(projectId), [projectId]);

  if (loading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;

  return (
    <div className="panel">
      <h3>城堡總覽</h3>
      {data.patrolDue.due && (
        <div className="banner banner-warning">
          巡查已到期：{data.patrolDue.reasons.join('、')}
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={() => navigate('/patrol')}>
              前往巡查
            </button>
          </div>
        </div>
      )}
      <GaugeBar label="Keep" count={data.counts.keepCount} max={data.budgets.keepMax} />
      <GaugeBar label="Chronicle（未整理）" count={data.counts.chronicleCount} max={data.budgets.chronicleSweep} />
      {data.counts.rooms.map((room) => (
        <GaugeBar key={room.slug} label={`房間：${room.slug}`} count={room.count} max={data.budgets.roomMax} />
      ))}
      <p className="card-meta">上次巡查：{data.lastPatrolAt ?? '從未'}</p>
      <div className="btn-row">
        <button type="button" className="btn" onClick={reload}>
          重新整理
        </button>
      </div>
      <h3 style={{ marginTop: '1rem' }}>快速前往</h3>
      <div className="btn-row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={() => navigate('/keep')}>
          Keep
        </button>
        <button type="button" className="btn" onClick={() => navigate('/chronicle')}>
          Chronicle
        </button>
        <button type="button" className="btn" onClick={() => navigate('/rooms')}>
          房間
        </button>
        <button type="button" className="btn" onClick={() => navigate('/routes')}>
          路線與巡行
        </button>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { projects, loading, error, currentProjectId, setCurrentProjectId } = useProjects();

  return (
    <div>
      <h1>總覽</h1>
      <ErrorBanner error={error} />
      {loading ? (
        <Loading />
      ) : projects.length === 0 ? (
        <EmptyState title="尚未註冊任何專案" hint="請在下方註冊一個專案根目錄以開始使用 MemoryCastle。" />
      ) : (
        <div className="panel">
          <h3>切換專案</h3>
          <label>
            目前專案
            <select value={currentProjectId ?? ''} onChange={(e) => setCurrentProjectId(e.target.value || null)}>
              <option value="">請選擇專案…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.id}）
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {currentProjectId && <ProjectOverview projectId={currentProjectId} />}
      <RegisterProjectForm />
    </div>
  );
}
