import type { Confidence } from '../types';

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return <span className={`badge badge-conf-${confidence}`}>conf:{confidence}</span>;
}

export function DateBadge({ date }: { date: string }) {
  return <span className="badge badge-date">{date}</span>;
}

export function SourceBadge({ source }: { source: string }) {
  return <span className="badge badge-source">src:{source}</span>;
}

export function TagChip({ tag }: { tag: string }) {
  return <span className="chip">#{tag}</span>;
}

// The C3 rule (user-source exemption, verifiedAt) lives in staleness.ts so a
// node test can hold it to src/core's isStale without rendering JSX.
export { isStale } from '../staleness';
