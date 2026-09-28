import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PERMISSIONS, type PermissionKey } from '@osooli/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { Empty, ErrorState, Loading } from '../components/States';
import { SessionStatusBadge, type SessionRow } from './sessions';

interface Check {
  status: 'up' | 'down' | 'not_configured';
  detail?: string;
  latencyMs?: number;
}
interface HealthDetails {
  status: 'up' | 'degraded';
  checkedAt: string;
  checks: Record<'backend' | 'database' | 'eap' | 'storage', Check>;
}

const CHECK_LABELS: Record<keyof HealthDetails['checks'], string> = {
  backend: 'الخادم',
  database: 'قاعدة البيانات',
  eap: 'EAP (المصادقة والموظفون)',
  storage: 'تخزين الملفات',
};
const STATUS_LABELS: Record<Check['status'], string> = {
  up: 'يعمل',
  down: 'متوقف',
  not_configured: 'غير مهيأ',
};

/**
 * System Control Panel (spec §66): administration and control sections,
 * not an analytics dashboard. More sections are added as modules land.
 */
export function DashboardPage() {
  const { can } = useAuth();
  return (
    <>
      <div className="page-header">
        <div>
          <h1>لوحة التحكم</h1>
          <p className="muted">أقسام الإدارة والتحكم وحالة النظام.</p>
        </div>
      </div>
      <AdminSections />
      <InactiveResponsibles />
      {can(PERMISSIONS.HEALTH_VIEW) && <SystemHealth />}
      {can(PERMISSIONS.SECURITY_VIEW) && <ActiveSessions canTerminate={can(PERMISSIONS.SECURITY_MANAGE)} />}
    </>
  );
}

const SECTIONS: Array<{ to: string; title: string; hint: string; permission: PermissionKey }> = [
  { to: '/admin/users', title: 'المستخدمون', hint: 'الحسابات والأدوار والقفل', permission: PERMISSIONS.USERS_VIEW },
  { to: '/admin/roles', title: 'الأدوار والصلاحيات', hint: 'أدوار مخصصة وصلاحياتها', permission: PERMISSIONS.ROLES_MANAGE },
  { to: '/admin/categories', title: 'الفئات', hint: 'الفئات الفرعية', permission: PERMISSIONS.CATEGORIES_MANAGE },
  { to: '/admin/locations', title: 'المواقع والأقسام', hint: 'والتركيبات المسجلة', permission: PERMISSIONS.LOCATIONS_MANAGE },
  { to: '/admin/external-people', title: 'المسؤولون الخارجيون', hint: 'أشخاص من خارج الشركة', permission: PERMISSIONS.EXTERNAL_PEOPLE_VIEW },
  { to: '/admin/settings', title: 'الإعدادات', hint: 'الشركة، الأمان، الترقيم، العملات', permission: PERMISSIONS.SETTINGS_MANAGE },
  { to: '/admin/audit', title: 'سجل التدقيق', hint: 'كل تغيير على البيانات', permission: PERMISSIONS.AUDIT_VIEW },
  { to: '/admin/security-log', title: 'السجل الأمني', hint: 'الدخول والجلسات والصلاحيات', permission: PERMISSIONS.SECURITY_VIEW },
];

function AdminSections() {
  const { can } = useAuth();
  const visible = SECTIONS.filter((s) => can(s.permission));
  if (!visible.length) return null;
  return (
    <section className="card" aria-labelledby="sections-title">
      <h2 id="sections-title">أقسام الإدارة</h2>
      <nav className="section-links">
        {visible.map((s) => (
          <Link key={s.to} to={s.to}>
            {s.title}
            <small>{s.hint}</small>
          </Link>
        ))}
      </nav>
    </section>
  );
}

interface InactiveResponsible {
  id: string;
  eapEmployeeId: string;
  fullName: string;
  jobTitle: string | null;
  assetCount: number;
  lastSyncedAt: string;
}

/** Employees inactive in EAP who are still responsible for assets (spec §46). */
function InactiveResponsibles() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['employees', 'inactive-responsibles'],
    queryFn: () => api<InactiveResponsible[]>('/employees/inactive-responsibles'),
  });
  const sync = useMutation({
    mutationFn: () => api<{ checked: number; updated: number; deactivated: number }>('/employees/sync', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] }),
  });
  return (
    <section className="card" aria-labelledby="inactive-title">
      <div className="page-header" style={{ marginBlockEnd: '0.5rem' }}>
        <h2 id="inactive-title">مسؤولون غير فعّالين في EAP</h2>
        {can(PERMISSIONS.USERS_MANAGE) && (
          <button type="button" className="btn btn-sm" disabled={sync.isPending} onClick={() => sync.mutate()}>
            {sync.isPending ? 'جارٍ المزامنة…' : 'مزامنة الموظفين الآن'}
          </button>
        )}
      </div>
      {sync.isSuccess && (
        <div className="alert alert-info" role="status">
          تمت المزامنة: فُحص {sync.data.checked} موظفًا، وتحدّث {sync.data.updated}، وأصبح {sync.data.deactivated} غير فعّال.
        </div>
      )}
      {sync.isError && (
        <div className="alert alert-error" role="alert">
          {sync.error instanceof ApiError ? sync.error.message : 'تعذرت المزامنة.'}
        </div>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <Empty>لا يوجد موظفون غير فعّالين مسؤولون عن أصول.</Empty>
      ) : (
        <>
          <div className="alert alert-warning">هؤلاء الموظفون لا يمكن تعيينهم مسؤولين جددًا، ويجب نقل عهدتهم الحالية.</div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الموظف</th>
                  <th>الرقم الوظيفي</th>
                  <th>عدد الأصول</th>
                  <th>آخر مزامنة</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.fullName} <span className="muted">{e.jobTitle ?? ''}</span>
                    </td>
                    <td>
                      <bdi dir="ltr">{e.eapEmployeeId}</bdi>
                    </td>
                    <td>{e.assetCount}</td>
                    <td>{formatDateTime(e.lastSyncedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function SystemHealth() {
  const query = useQuery({
    queryKey: ['health', 'details'],
    queryFn: () => api<HealthDetails>('/health/details'),
    refetchInterval: 60_000,
  });
  return (
    <section className="card" aria-labelledby="health-title">
      <h2 id="health-title">حالة النظام</h2>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>المكوّن</th>
                  <th>الحالة</th>
                  <th>زمن الاستجابة</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(CHECK_LABELS) as Array<keyof HealthDetails['checks']>).map((key) => {
                  const c = query.data.checks[key];
                  return (
                    <tr key={key}>
                      <td>{CHECK_LABELS[key]}</td>
                      <td>
                        <span className={`badge ${c.status === 'up' ? 'badge-success' : 'badge-danger'}`}>
                          {STATUS_LABELS[c.status]}
                        </span>
                      </td>
                      <td>{c.latencyMs !== undefined ? `${c.latencyMs} ms` : '—'}</td>
                      <td className="muted">{c.detail ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">آخر فحص: {formatDateTime(query.data.checkedAt)}</p>
        </>
      )}
    </section>
  );
}

type AdminSessionRow = SessionRow & { user: { username: string; employee: { fullName: string } } };

function ActiveSessions({ canTerminate }: { canTerminate: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['sessions', 'active'],
    queryFn: () => api<{ items: AdminSessionRow[] }>('/security/sessions?status=ACTIVE'),
  });
  const terminate = useMutation({
    mutationFn: (id: string) => api(`/security/sessions/${id}/terminate`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  return (
    <section className="card" aria-labelledby="sessions-title">
      <h2 id="sessions-title">الجلسات النشطة</h2>
      {terminate.isError && (
        <div className="alert alert-error" role="alert">
          {terminate.error instanceof ApiError ? terminate.error.message : 'تعذر إنهاء الجلسة.'}
        </div>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <Empty>لا توجد جلسات نشطة.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>المستخدم</th>
                <th>وقت الدخول</th>
                <th>آخر نشاط</th>
                <th>الجهاز / المتصفح</th>
                <th>عنوان IP</th>
                <th>الحالة</th>
                {canTerminate && <th>إجراء</th>}
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.user.employee.fullName} <span className="muted">(<bdi dir="ltr">{s.user.username}</bdi>)</span>
                  </td>
                  <td>{formatDateTime(s.createdAt)}</td>
                  <td>{formatDateTime(s.lastSeenAt)}</td>
                  <td>
                    {s.device ?? '—'} / {s.browser ?? '—'}
                  </td>
                  <td>
                    <bdi dir="ltr">{s.ip ?? '—'}</bdi>
                  </td>
                  <td>
                    <SessionStatusBadge status={s.status} />
                  </td>
                  {canTerminate && (
                    <td>
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={terminate.isPending}
                        onClick={() => {
                          if (window.confirm(`إنهاء جلسة ${s.user.employee.fullName}؟`)) terminate.mutate(s.id);
                        }}
                      >
                        إنهاء الجلسة
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
