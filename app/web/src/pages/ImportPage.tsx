import { useState } from 'react';
import { importApply, importPreview } from '../api';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { useProjects } from '../ProjectContext';
import type { ImportApplySummary, ImportCounts, ImportPreviewResult, ImportWarning } from '../types';

function CountsTable({ counts }: { counts: ImportCounts }) {
  return (
    <table>
      <tbody>
        <tr>
          <th>keep</th>
          <td>{counts.keep} 筆</td>
        </tr>
        <tr>
          <th>chronicle</th>
          <td>{counts.chronicle} 筆</td>
        </tr>
        <tr>
          <th>routes</th>
          <td>{counts.routes} 條</td>
        </tr>
        <tr>
          <th>rooms</th>
          <td>{counts.rooms} 間</td>
        </tr>
        <tr>
          <th>archive</th>
          <td>{counts.archiveMonths} 月</td>
        </tr>
      </tbody>
    </table>
  );
}

function WarningsTable({ warnings }: { warnings: ImportWarning[] }) {
  if (warnings.length === 0) return <p className="card-meta">警告 0 項。</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>檔案</th>
          <th>行號</th>
          <th>原因</th>
          <th>內容</th>
        </tr>
      </thead>
      <tbody>
        {warnings.map((w, i) => (
          <tr key={i}>
            <td>{w.file}</td>
            <td>{w.line}</td>
            <td>{w.reason}</td>
            <td>{w.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ImportPage() {
  const { projects, currentProjectId } = useProjects();
  const [selectedId, setSelectedId] = useState(currentProjectId ?? '');
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [applyResult, setApplyResult] = useState<ImportApplySummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function handlePreview() {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    setApplyResult(null);
    try {
      const p = await importPreview(selectedId);
      setPreview(p);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importApply(selectedId);
      setApplyResult(result);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>匯入精靈</h1>
      <p className="page-intro">將專案內既有的 markdown 城堡（.claude/castle/*.md）一次性匯入為 JSON 格式。</p>
      {projects.length === 0 ? (
        <EmptyState title="尚未註冊任何專案" hint="請先到「總覽」頁面註冊專案。" />
      ) : (
        <div className="panel">
          <h3>1. 選擇專案</h3>
          <label>
            專案
            <select value={selectedId} onChange={(e) => { setSelectedId(e.target.value); setPreview(null); setApplyResult(null); }}>
              <option value="">請選擇專案…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.id}）
                </option>
              ))}
            </select>
          </label>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={!selectedId || busy} onClick={handlePreview}>
              2. 預覽
            </button>
          </div>
        </div>
      )}

      <ErrorBanner error={error} />

      {preview && (
        <div className="panel">
          <h3>預覽結果</h3>
          <CountsTable counts={preview.counts} />
          <h3 style={{ marginTop: '0.9rem' }}>警告</h3>
          <WarningsTable warnings={preview.warnings} />
          {!applyResult && (
            <div className="btn-row">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={handleApply}>
                3. 套用匯入
              </button>
            </div>
          )}
        </div>
      )}

      {applyResult && (
        <div className="panel">
          <h3>匯入完成</h3>
          <CountsTable counts={applyResult.counts} />
          <h3 style={{ marginTop: '0.9rem' }}>已搬移原始檔案（{applyResult.movedFiles.length}）</h3>
          <ul>
            {applyResult.movedFiles.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
