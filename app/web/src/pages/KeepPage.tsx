import { useState } from 'react';
import { addKeepRecord, deleteKeepRecord, getKeep } from '../api';
import { ConfidenceBadge, DateBadge, SourceBadge, TagChip, isStale } from '../components/Badge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner, Loading } from '../components/ErrorBanner';
import { useAsync } from '../hooks';
import { useProjects } from '../ProjectContext';
import type { CastleRecord, Confidence, KeepSection } from '../types';

const SECTION_LABELS: Record<KeepSection, string> = {
  identity: '身分',
  constraints: '約束',
  core: '核心事實',
};

function AddRecordForm({ section, projectId, onAdded }: { section: KeepSection; projectId: string; onAdded: () => void }) {
  const [fact, setFact] = useState('');
  const [confidence, setConfidence] = useState<Confidence>('high');
  const [source, setSource] = useState('user');
  const [tags, setTags] = useState('');
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await addKeepRecord(projectId, section, {
        fact: fact.trim(),
        confidence,
        source: source.trim() || 'user',
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setFact('');
      setTags('');
      setPendingSubmit(false);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <ErrorBanner error={error} />
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          if (fact.trim()) setPendingSubmit(true);
        }}
      >
        <label>
          事實（一句話）
          <textarea value={fact} onChange={(e) => setFact(e.target.value)} required />
        </label>
        <label>
          信心
          <select value={confidence} onChange={(e) => setConfidence(e.target.value as Confidence)}>
            <option value="high">high</option>
            <option value="med">med</option>
            <option value="low">low</option>
          </select>
        </label>
        <label>
          來源
          <input type="text" value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        <label>
          標籤（逗號分隔）
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            新增至「{SECTION_LABELS[section]}」
          </button>
        </div>
      </form>
      <ConfirmDialog
        open={pendingSubmit}
        title="確認新增 Keep 記錄"
        message={`即將寫入「${SECTION_LABELS[section]}」區：${fact}`}
        onConfirm={handleConfirm}
        onCancel={() => setPendingSubmit(false)}
      />
    </div>
  );
}

function SectionPanel({ section, records, projectId, onChanged }: { section: KeepSection; records: CastleRecord[]; projectId: string; onChanged: () => void }) {
  const [pendingDelete, setPendingDelete] = useState<CastleRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function handleDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    setError(null);
    try {
      await deleteKeepRecord(projectId, pendingDelete.id);
      setPendingDelete(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>{SECTION_LABELS[section]}</h3>
      <ErrorBanner error={error} />
      {records.length === 0 ? (
        <EmptyState title="此區尚無記錄" />
      ) : (
        <ul className="record-list">
          {records.map((r) => (
            <li key={r.id} className={isStale(r) ? 'record-row stale' : 'record-row'}>
              <div className="record-main">
                <p className="record-fact">{r.fact}</p>
                <div className="record-badges">
                  <DateBadge date={r.date} />
                  <ConfidenceBadge confidence={r.confidence} />
                  <SourceBadge source={r.source} />
                  {r.tags.map((t) => (
                    <TagChip key={t} tag={t} />
                  ))}
                </div>
              </div>
              <button type="button" className="btn" disabled={busy} onClick={() => setPendingDelete(r)}>
                刪除
              </button>
            </li>
          ))}
        </ul>
      )}
      <h3 style={{ marginTop: '0.9rem' }}>新增記錄</h3>
      <AddRecordForm section={section} projectId={projectId} onAdded={onChanged} />
      <ConfirmDialog
        open={pendingDelete !== null}
        title="確認刪除 Keep 記錄"
        message={pendingDelete ? `即將刪除：${pendingDelete.fact}` : ''}
        danger
        confirmLabel="刪除"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

export function KeepPage() {
  const { currentProjectId } = useProjects();
  const { data, loading, error, reload } = useAsync(
    () => (currentProjectId ? getKeep(currentProjectId) : Promise.resolve(null)),
    [currentProjectId],
  );

  if (!currentProjectId) {
    return (
      <div>
        <h1>Keep 儀表板</h1>
        <EmptyState title="尚未選擇專案" hint="請先到「總覽」頁面選擇或註冊一個專案。" />
      </div>
    );
  }

  return (
    <div>
      <h1>Keep 儀表板</h1>
      <p className="page-intro">身分、約束、核心事實三區；過期（&gt;90 天或 conf:low）以黃色標示。</p>
      <ErrorBanner error={error} />
      {loading || !data ? (
        <Loading />
      ) : (
        (['identity', 'constraints', 'core'] as KeepSection[]).map((section) => (
          <SectionPanel
            key={section}
            section={section}
            records={data.sections[section]}
            projectId={currentProjectId}
            onChanged={reload}
          />
        ))
      )}
    </div>
  );
}
