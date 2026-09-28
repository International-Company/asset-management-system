import type { ReactNode } from 'react';
import { ApiError } from '../lib/api';

/** Standard loading / empty / error blocks used by every screen (spec §70). */
export function Loading({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state">{children}</div>;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. يرجى المحاولة لاحقًا.';
  return (
    <div className="state" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          إعادة المحاولة
        </button>
      )}
    </div>
  );
}
