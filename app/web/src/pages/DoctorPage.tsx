import { getDoctorReport } from '../api';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner, Loading } from '../components/ErrorBanner';
import { useAsync } from '../hooks';
import { useProjects } from '../ProjectContext';
import type { DoctorFinding, DoctorReport, DoctorSeverity } from '../types';

const STATUS_BANNER_CLASS: Record<DoctorReport['status'], string> = {
  ok: 'banner-success',
  warn: 'banner-warning',
  error: 'banner-error',
};

const STATUS_LABEL: Record<DoctorReport['status'], string> = {
  ok: '正常',
  warn: '有警告',
  error: '有錯誤',
};

const SEVERITY_ORDER: DoctorSeverity[] = ['error', 'warn', 'info', 'ok'];

const SEVERITY_LABEL: Record<DoctorSeverity, string> = {
  error: '錯誤',
  warn: '警告',
  info: '提示',
  ok: '正常',
};

function FindingRow({ finding }: { finding: DoctorFinding }) {
  return (
    <div className="panel">
      <p style={{ margin: 0 }}>
        <strong>{finding.target}</strong>
        <span className="card-meta" style={{ marginLeft: '0.5rem' }}>
          {finding.kind}
        </span>
      </p>
      <p style={{ margin: '0.25rem 0 0' }}>{finding.detail}</p>
    </div>
  );
}

function FindingsBySeverity({ report }: { report: DoctorReport }) {
  if (report.findings.length === 0) {
    return <p className="card-meta">目前無任何檢查項目。</p>;
  }
  return (
    <>
      {SEVERITY_ORDER.map((severity) => {
        const items = report.findings.filter((f) => f.severity === severity);
        if (items.length === 0) return null;
        return (
          <div key={severity} style={{ marginTop: '1rem' }}>
            <h3>
              {SEVERITY_LABEL[severity]}（{items.length}）
            </h3>
            {items.map((f, i) => (
              <FindingRow key={`${f.kind}-${f.target}-${i}`} finding={f} />
            ))}
          </div>
        );
      })}
    </>
  );
}

function DoctorReportView({ projectId }: { projectId: string }) {
  const { data, loading, error, reload } = useAsync(() => getDoctorReport(projectId), [projectId]);

  return (
    <div>
      <div className="btn-row">
        <button type="button" className="btn btn-primary" disabled={loading} onClick={reload}>
          {loading ? '檢查中…' : '重新檢查'}
        </button>
      </div>
      {loading && <Loading />}
      <ErrorBanner error={error} />
      {data && (
        <>
          <div className={`banner ${STATUS_BANNER_CLASS[data.status]}`} style={{ marginTop: '0.75rem' }}>
            整體狀態：{STATUS_LABEL[data.status]}（檢查時間：{data.checkedAt}）
          </div>
          <FindingsBySeverity report={data} />
        </>
      )}
    </div>
  );
}

export function DoctorPage() {
  const { currentProjectId } = useProjects();

  if (!currentProjectId) {
    return (
      <div>
        <h1>健康檢查</h1>
        <EmptyState title="尚未選擇專案" hint="請先到「總覽」頁面選擇或註冊一個專案。" />
      </div>
    );
  }

  return (
    <div>
      <h1>健康檢查</h1>
      <p className="page-intro">
        不需 LLM 的確定性檢查：城堡記錄是否落後於程式碼（commit／未提交變更）、是否已到巡查門檻、房間 locus 是否已找不到對應檔案、路線是否有缺口。
      </p>
      <DoctorReportView projectId={currentProjectId} />
    </div>
  );
}
