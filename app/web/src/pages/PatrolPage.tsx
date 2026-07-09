import { useEffect, useState } from 'react';
import { getCastleOverview } from '../api';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner, Loading } from '../components/ErrorBanner';
import { useAsync } from '../hooks';
import { startApply, startPatrol, usePatrolState } from '../patrolStore';
import { useProjects } from '../ProjectContext';
import type { PatrolJob, PatrolProposal } from '../types';

const KIND_LABELS: Record<PatrolProposal['kind'], string> = {
  roomRecord: '房間新增記錄',
  roomCreate: '建立新房間',
  contradiction: '矛盾取代',
  keepPromotion: '晉升至 Keep',
};

function WarningsTable({ job }: { job: PatrolJob }) {
  if (job.warnings.length === 0) {
    return <p className="card-meta">目前無警告。</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>種類</th>
          <th>對象</th>
          <th>說明</th>
        </tr>
      </thead>
      <tbody>
        {job.warnings.map((w, i) => (
          <tr key={i}>
            <td>{w.kind}</td>
            <td>{w.target}</td>
            <td>{w.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProposalsList({
  job,
  approvals,
  onToggle,
}: {
  job: PatrolJob;
  approvals: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (job.proposals.length === 0) {
    return <p className="card-meta">目前無提案（可能尚未設定 LLM，或無需整併的內容）。</p>;
  }
  const green = job.proposals.filter((p) => p.tier === 'green');
  const yellow = job.proposals.filter((p) => p.tier === 'yellow');
  return (
    <div>
      {green.length > 0 && (
        <div>
          <h3>綠級（自動套用）</h3>
          {green.map((p) => (
            <div key={p.id} className="proposal-row">
              <span className="proposal-tier green">green</span>
              <div>
                <p style={{ margin: 0 }}>{KIND_LABELS[p.kind]}：{p.summary}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {yellow.length > 0 && (
        <div>
          <h3>黃級（需個別核准）</h3>
          {yellow.map((p) => (
            <label key={p.id} className="proposal-row" style={{ flexDirection: 'row', cursor: 'pointer' }}>
              <input type="checkbox" checked={approvals.has(p.id)} onChange={() => onToggle(p.id)} />
              <span className="proposal-tier yellow">yellow</span>
              <span>
                {KIND_LABELS[p.kind]}：{p.summary}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function PatrolPage() {
  const { currentProjectId } = useProjects();
  const overview = useAsync(
    () => (currentProjectId ? getCastleOverview(currentProjectId) : Promise.resolve(null)),
    [currentProjectId],
  );

  const patrol = usePatrolState(currentProjectId);
  const { job } = patrol;
  const busy = patrol.running || patrol.applying;
  const [approvals, setApprovals] = useState<Set<string>>(new Set());
  // CLI 模式下每個 LLM 判斷都會重新 spawn 一次子行程、序列執行，整體可能長達數分鐘；
  // 沒有這個計時就跟真的卡住分不出來。秒數由 store 的 startedAt 推算，
  // 切頁回來會從正確的累計值繼續，這個 tick 只負責催重繪。
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!patrol.running) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [patrol.running]);
  const elapsedSec = patrol.running && patrol.startedAt ? Math.floor((Date.now() - patrol.startedAt) / 1000) : 0;

  function handleRunPatrol() {
    if (!currentProjectId) return;
    setApprovals(new Set());
    startPatrol(currentProjectId);
  }

  function handleApply() {
    if (!currentProjectId || !job) return;
    startApply(currentProjectId, job.id, [...approvals]);
  }

  function toggleApproval(id: string) {
    setApprovals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!currentProjectId) {
    return (
      <div>
        <h1>巡查</h1>
        <EmptyState title="尚未選擇專案" hint="請先到「總覽」頁面選擇或註冊一個專案。" />
      </div>
    );
  }

  return (
    <div>
      <h1>巡查</h1>
      <p className="page-intro">整併巡查：預算／過期／路線缺口不需金鑰即可偵測；聚類、矛盾解決、晉升需設定 LLM。</p>
      {overview.loading ? (
        <Loading />
      ) : overview.data?.patrolDue.due ? (
        <div className="banner banner-warning">巡查已到期：{overview.data.patrolDue.reasons.join('、')}</div>
      ) : (
        overview.data && <div className="banner banner-info">巡查尚未到期。</div>
      )}
      <ErrorBanner error={patrol.error} />
      <div className="btn-row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={handleRunPatrol}>
          {patrol.running ? `執行中…（${elapsedSec}s，可能需數分鐘）` : '執行巡查'}
        </button>
      </div>

      {job && (
        <div className="panel">
          <h2>巡查結果（job {job.id}，狀態：{job.status}）</h2>
          <h3>警告</h3>
          <WarningsTable job={job} />
          <h3>提案</h3>
          <ProposalsList job={job} approvals={approvals} onToggle={toggleApproval} />
          {job.status === 'proposed' && (
            <div className="btn-row">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={handleApply}>
                {patrol.applying ? '套用中…' : '套用'}
              </button>
            </div>
          )}
          {job.applyReport && (
            <div className="banner banner-success" style={{ marginTop: '0.75rem' }}>
              已套用 {job.applyReport.appliedIds.length} 項提案；略過 {job.applyReport.skippedYellowIds.length} 項未核准的黃級提案。
            </div>
          )}
        </div>
      )}
    </div>
  );
}
