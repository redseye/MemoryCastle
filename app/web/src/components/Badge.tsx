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

const STALENESS_DAYS_DEFAULT = 90;

export function isStale(record: { date: string; confidence: Confidence }, stalenessDays = STALENESS_DAYS_DEFAULT): boolean {
  if (record.confidence === 'low') return true;
  const ageMs = Date.now() - new Date(record.date).getTime();
  return ageMs > stalenessDays * 24 * 60 * 60 * 1000;
}
