import { useState } from 'react';
import { addChronicleRecord, getChronicle, remember } from '../api';
import { ConfidenceBadge, DateBadge, SourceBadge, TagChip } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner, Loading } from '../components/ErrorBanner';
import { useAsync } from '../hooks';
import { useProjects } from '../ProjectContext';
import type { CastleRecord, Confidence } from '../types';

const GATE_QUESTIONS = [
  { key: 'novel', label: '是新知（不是已經寫在別處的舊事實）？' },
  { key: 'reusable', label: '未來會被重複用到（不是一次性瑣事）？' },
  { key: 'verifiable', label: '可以一句話驗證是否為真？' },
  { key: 'noSecrets', label: '不含密鑰／個資等機密內容？' },
] as const;

function ManualGateFallback({ projectId, initialText, onWritten }: { projectId: string; initialText: string; onWritten: () => void }) {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [fact, setFact] = useState(initialText);
  const [confidence, setConfidence] = useState<Confidence>('med');
  const [source, setSource] = useState('user');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const allChecked = GATE_QUESTIONS.every((q) => checks[q.key]);

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      await addChronicleRecord(projectId, {
        fact: fact.trim(),
        confidence,
        source: source.trim() || 'user',
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      onWritten();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <p className="banner banner-warning">尚未設定 LLM，改用人工守門判斷：請逐項確認後再寫入。</p>
      <ErrorBanner error={error} />
      <div className="form-grid">
        {GATE_QUESTIONS.map((q) => (
          <label key={q.key} style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={checks[q.key] ?? false}
              onChange={(e) => setChecks((c) => ({ ...c, [q.key]: e.target.checked }))}
            />
            {q.label}
          </label>
        ))}
        <label>
          事實內容
          <textarea value={fact} onChange={(e) => setFact(e.target.value)} />
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
          <button type="button" className="btn btn-primary" disabled={!allChecked || busy || !fact.trim()} onClick={handleSubmit}>
            手動放行並寫入
          </button>
        </div>
      </div>
    </div>
  );
}

function RememberBox({ projectId, onWritten }: { projectId: string; onWritten: () => void }) {
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | { kind: 'success'; record: CastleRecord }
    | { kind: 'failed'; failedTests: string[]; reason: string }
    | { kind: 'notConfigured' }
    | null
  >(null);
  const [error, setError] = useState<Error | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await remember(projectId, { text: text.trim(), source: source.trim() || undefined });
      if (r.kind === 'dryRunPassed') {
        // not used by this form (dryRun always false here); kept exhaustive.
        return;
      }
      setResult(r);
      if (r.kind === 'success') {
        setText('');
        setSource('');
        onWritten();
      }
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>記住</h3>
      <ErrorBanner error={error} />
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          內容
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="輸入想記住的一句話事實…" required />
        </label>
        <label>
          來源（選填）
          <input type="text" value={source} onChange={(e) => setSource(e.target.value)} placeholder="預設 user" />
        </label>
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            送出守門判斷
          </button>
        </div>
      </form>

      {result?.kind === 'success' && (
        <div className="banner banner-success">
          已寫入：{result.record.fact}（{result.record.date} / conf:{result.record.confidence}）
        </div>
      )}
      {result?.kind === 'failed' && (
        <div className="banner banner-error">
          <p>未通過守門：{result.reason}</p>
          <ul>
            {result.failedTests.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {result?.kind === 'notConfigured' && (
        <ManualGateFallback
          projectId={projectId}
          initialText={text}
          onWritten={() => {
            setResult(null);
            setText('');
            setSource('');
            onWritten();
          }}
        />
      )}
    </div>
  );
}

function isHandover(r: CastleRecord): boolean {
  return r.tags.includes('handover');
}

export function ChroniclePage() {
  const { currentProjectId } = useProjects();
  const { data, loading, error, reload } = useAsync(
    () => (currentProjectId ? getChronicle(currentProjectId) : Promise.resolve(null)),
    [currentProjectId],
  );

  if (!currentProjectId) {
    return (
      <div>
        <h1>Chronicle 時間軸</h1>
        <EmptyState title="尚未選擇專案" hint="請先到「總覽」頁面選擇或註冊一個專案。" />
      </div>
    );
  }

  const entries = data ? [...data.entries].reverse() : [];

  return (
    <div>
      <h1>Chronicle 時間軸</h1>
      <p className="page-intro">倒序顯示；未整理 {entries.length}/20（達門檻時建議執行巡查）。</p>
      <ErrorBanner error={error} />
      <RememberBox projectId={currentProjectId} onWritten={reload} />
      {loading ? (
        <Loading />
      ) : entries.length === 0 ? (
        <EmptyState title="Chronicle 尚無記錄" hint="使用上方「記住」輸入框新增第一筆。" />
      ) : (
        <ul className="record-list">
          {entries.map((r) => (
            <li key={r.id} className={isHandover(r) ? 'record-row handover' : 'record-row'}>
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
