import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Empty, ErrorState, Loading } from '../components/States';
import { SessionStatusBadge, type SessionRow } from './sessions';

/** The signed-in user's recent sessions (spec §49). */
export function MySessionsPage() {
  const query = useQuery({
    queryKey: ['sessions', 'mine'],
    queryFn: () => api<{ items: Array<SessionRow & { current: boolean }> }>('/security/sessions/mine'),
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>جلساتي</h1>
          <p className="muted">آخر عمليات الدخول إلى حسابك.</p>
        </div>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <Empty>لا توجد جلسات.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>وقت الدخول</th>
                <th>آخر نشاط</th>
                <th>الجهاز</th>
                <th>المتصفح</th>
                <th>عنوان IP</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((s) => (
                <tr key={s.id}>
                  <td>{formatDateTime(s.createdAt)}</td>
                  <td>{formatDateTime(s.lastSeenAt)}</td>
                  <td>{s.device ?? '—'}</td>
                  <td>{s.browser ?? '—'}</td>
                  <td>
                    <bdi dir="ltr">{s.ip ?? '—'}</bdi>
                  </td>
                  <td>
                    <SessionStatusBadge status={s.status} />
                    {s.current && <span className="badge"> الجلسة الحالية</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
