import { useEffect, useState } from 'react';
import { getCastleOverview } from '../api';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner, Loading } from '../components/ErrorBanner';
import { useAsync } from '../hooks';
import { cancelPatrol, startApply, startPatrol, usePatrolState } from '../patrolStore';
import { useProjects } from '../ProjectContext';
import type { PatrolJob, PatrolProposal, StaleDecision } from '../types';

const KIND_LABELS: Record<PatrolProposal['kind'], string> = {
  roomRecord: '房間新增記錄',
  roomCreate: '建立新房間',
  contradiction: '矛盾取代',
  keepPromotion: '晉升至 Keep',
  chronicleSweep: '編年史封存',
  staleReview: '待驗證記錄',
  recordSplit: '拆分超長記錄',
  roomDistill: '房間超出預算',
  keepCut: 'Keep 超出預算',
};

// staleReview 需要使用者選一個處置（不是只有核准與否）；空字串＝本次不處理。
const STALE_CHOICES: { value: StaleDecision | ''; label: string }[] = [
  { value: '', label: '不處理' },
  { value: 'verify', label: '驗證屬實' },
  { value: 'archive', label: '封存' },
  { value: 'delete', label: '刪除' },
];

const FAILURE_LABELS: Record<string, string> = {
  not_found: '找不到（可能已被其他提案處理）',
  over_budget: '會超出房間預算',
  fact_too_long: '事實超過字數上限或非單行',
  newest_handover: '最新一筆交接須留在編年史，不可封存',
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

function StaleChoice({
  proposal,
  decision,
  onDecide,
}: {
  proposal: PatrolProposal;
  decision: StaleDecision | undefined;
  onDecide: (id: string, decision: StaleDecision | '') => void;
}) {
  return (
    <div className="proposal-row">
      <span className="proposal-tier yellow">yellow</span>
      <div>
        <p style={{ margin: 0 }}>
          {KIND_LABELS[proposal.kind]}：{proposal.summary}
        </p>
        <div className="btn-row">
          {STALE_CHOICES.map((c) => (
            <label key={c.value} style={{ cursor: 'pointer' }}>
              <input
                type="radio"
                name={`stale-${proposal.id}`}
                checked={(decision ?? '') === c.value}
                onChange={() => onDecide(proposal.id, c.value)}
              />
              {c.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProposalsList({
  job,
  approvals,
  onToggle,
  decisions,
  onDecide,
}: {
  job: PatrolJob;
  approvals: Set<string>;
  onToggle: (id: string) => void;
  decisions: Record<string, StaleDecision>;
  onDecide: (id: string, decision: StaleDecision | '') => void;
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
          {yellow.map((p) =>
            p.kind === 'staleReview' ? (
              <StaleChoice key={p.id} proposal={p} decision={decisions[p.id]} onDecide={onDecide} />
            ) : (
              <label key={p.id} className="proposal-row" style={{ flexDirection: 'row', cursor: 'pointer' }}>
                <input type="checkbox" checked={approvals.has(p.id)} onChange={() => onToggle(p.id)} />
                <span className="proposal-tier yellow">yellow</span>
                <span>
                  {KIND_LABELS[p.kind]}：{p.summary}
                </span>
              </label>
            ),
          )}
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
  const [decisions, setDecisions] = useState<Record<string, StaleDecision>>({});
  const [full, setFull] = useState(false);
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
    setDecisions({});
    startPatrol(currentProjectId, full);
  }

  function handleCancelPatrol() {
    if (!currentProjectId) return;
    cancelPatrol(currentProjectId);
  }

  function handleApply() {
    if (!currentProjectId || !job) return;
    startApply(currentProjectId, job.id, [...approvals], decisions);
  }

  function decide(id: string, decision: StaleDecision | '') {
    setDecisions((prev) => {
      const next = { ...prev };
      if (decision === '') delete next[id];
      else next[id] = decision;
      return next;
    });
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
      {patrol.notice && <div className="banner banner-info">{patrol.notice}</div>}
      <div className="btn-row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={handleRunPatrol}>
          {patrol.running ? `執行中…（${elapsedSec}s，可能需數分鐘）` : '執行巡查'}
        </button>
        <label style={{ cursor: 'pointer' }} title="預設只檢查上次巡查後新增或重新驗證的記錄；勾選後矛盾檢查與晉升改為掃描整座城堡。">
          <input type="checkbox" checked={full} disabled={busy} onChange={(e) => setFull(e.target.checked)} />
          完整巡查（掃描整座城堡）
        </label>
        {patrol.running && (
          <button type="button" className="btn btn-danger" disabled={patrol.cancelling} onClick={handleCancelPatrol}>
            {patrol.cancelling ? '取消中…' : '取消'}
          </button>
        )}
      </div>

      {job && (
        <div className="panel">
          <h2>巡查結果（job {job.id}，狀態：{job.status}）</h2>
          <p className="card-meta">
            {job.mode === 'full' ? '完整巡查' : '增量巡查（上次巡查後）'}；LLM 呼叫 {job.stats.llmCalls} 次，送出提示約{' '}
            {job.stats.promptChars.toLocaleString()} 字元。
            {!job.complete && '未設定 LLM，本次不是完整巡查：套用後不會更新「上次巡查」日期。'}
          </p>
          <h3>警告</h3>
          <WarningsTable job={job} />
          <h3>提案</h3>
          <ProposalsList job={job} approvals={approvals} onToggle={toggleApproval} decisions={decisions} onDecide={decide} />
          {job.status === 'proposed' && (
            <div className="btn-row">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={handleApply}>
                {patrol.applying ? '套用中…' : '套用'}
              </button>
            </div>
          )}
          {job.applyReport && (
            <div className="banner banner-success" style={{ marginTop: '0.75rem' }}>
              已套用 {job.applyReport.appliedIds.length} 項提案；略過 {job.applyReport.skippedYellowIds.length} 項未核准的黃級提案
              {job.applyReport.failed.length > 0 && `；${job.applyReport.failed.length} 項未能套用`}。
              {job.applyReport.patrolledAt && ` 上次巡查日已更新為 ${job.applyReport.patrolledAt}。`}
              {job.applyReport.failed.length > 0 && (
                <ul>
                  {job.applyReport.failed.map((f) => (
                    <li key={f.id}>
                      {job.proposals.find((p) => p.id === f.id)?.summary ?? f.id}：{FAILURE_LABELS[f.reason] ?? f.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
