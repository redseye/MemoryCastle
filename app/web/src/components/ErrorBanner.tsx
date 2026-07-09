import { describeError } from '../errorMessages';

export function ErrorBanner({ error }: { error: Error | null }) {
  const message = describeError(error);
  if (!message) return null;
  return (
    <div className="banner banner-error" role="alert">
      {message}
    </div>
  );
}

export function Loading() {
  return <p className="loading-text">載入中…</p>;
}
