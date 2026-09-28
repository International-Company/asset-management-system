export interface SessionRow {
  id: string;
  status: 'ACTIVE' | 'LOGGED_OUT' | 'EXPIRED' | 'TERMINATED';
  ip: string | null;
  device: string | null;
  browser: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  endedAt: string | null;
}

const LABELS: Record<SessionRow['status'], string> = {
  ACTIVE: 'نشطة',
  LOGGED_OUT: 'تسجيل خروج',
  EXPIRED: 'منتهية',
  TERMINATED: 'أُنهيت',
};

export function SessionStatusBadge({ status }: { status: SessionRow['status'] }) {
  const tone = status === 'ACTIVE' ? 'badge-success' : status === 'TERMINATED' ? 'badge-danger' : '';
  return <span className={`badge ${tone}`}>{LABELS[status]}</span>;
}
