import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { PERMISSIONS } from '@osooli/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { useServerList } from '../lib/list';
import { type Column, DataTable, Tabs } from '../components/DataTable';
import { FormAlert } from '../components/Form';

interface Notification {
  id: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
  type: { label: string };
  user?: { username: string; employee: { fullName: string } };
}

/** Where a notification's related entity lives in the UI. */
export function entityPath(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  const routes: Record<string, string> = {
    Custody: `/custodies/${id}`,
    CustodyReturn: `/custody-returns/${id}`,
    Maintenance: `/maintenances/${id}`,
    Sale: `/sales/${id}`,
    Inventory: `/inventories/${id}`,
    Transfer: '/transfers',
    Employee: '/dashboard',
    Asset: `/assets/${id}`,
  };
  return routes[type] ?? null;
}

export const UNREAD_KEY = ['notifications', 'unread-count'] as const;

/** Unread count for the top-bar bell; refreshed every minute. */
export function useUnreadCount() {
  return useQuery({ queryKey: UNREAD_KEY, queryFn: () => api<{ count: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
}

/** Notification inbox (spec §39). Notifications can be marked read but not deleted. */
export function NotificationsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('view') as 'unread' | 'all' | 'system' | null) ?? 'unread';
  const { state, update, query } = useServerList<Notification>('/notifications', ['unread', 'all'], {
    filters: { unread: tab === 'unread' ? 'true' : '', all: tab === 'system' ? 'true' : '' },
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['/notifications'] });
    void queryClient.invalidateQueries({ queryKey: UNREAD_KEY });
  };
  const read = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: refresh });

  const columns: Column<Notification>[] = [
    {
      key: 'title',
      label: 'الإشعار',
      render: (n) => {
        const to = entityPath(n.entityType, n.entityId);
        const title = n.readAt ? n.title : <strong>{n.title}</strong>;
        return (
          <>
            {to ? (
              <Link to={to} onClick={() => !n.readAt && tab !== 'system' && read.mutate(n.id)}>
                {title}
              </Link>
            ) : (
              title
            )}
            {n.body && <div className="muted">{n.body}</div>}
          </>
        );
      },
    },
    { key: 'type', label: 'النوع', render: (n) => n.type.label },
    ...(tab === 'system' ? [{ key: 'user', label: 'المستلم', render: (n: Notification) => n.user?.employee.fullName ?? '—' }] : []),
    { key: 'at', label: 'الوقت', render: (n) => formatDateTime(n.createdAt) },
    {
      key: 'state',
      label: 'الحالة',
      render: (n) =>
        n.readAt ? (
          <span className="muted">مقروء {formatDateTime(n.readAt)}</span>
        ) : tab === 'system' ? (
          <span className="badge badge-warning">غير مقروء</span>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => read.mutate(n.id)}>
            تعليم كمقروء
          </button>
        ),
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>الإشعارات</h1>
          <p className="muted">لا يمكن حذف الإشعارات؛ يمكن تعليمها كمقروءة.</p>
        </div>
        {tab !== 'system' && (
          <button type="button" className="btn" disabled={readAll.isPending} onClick={() => readAll.mutate()}>
            تعليم الكل كمقروء
          </button>
        )}
      </div>
      <FormAlert error={read.error ?? readAll.error} />
      <Tabs
        tabs={[
          ['unread', 'غير المقروءة'],
          ['all', 'كل إشعاراتي'],
          ...(can(PERMISSIONS.NOTIFICATIONS_VIEW_ALL) ? ([['system', 'كل إشعارات النظام']] as Array<['system', string]>) : []),
        ]}
        active={tab}
        onChange={(t) => {
          setParams(t === 'unread' ? {} : { view: t }, { replace: true });
          update({ filters: { unread: t === 'unread' ? 'true' : '', all: t === 'system' ? 'true' : '' } });
        }}
      />
      <DataTable columns={columns} query={query} state={state} onChange={update} rowKey={(n) => n.id} empty="لا توجد إشعارات." />
    </>
  );
}
