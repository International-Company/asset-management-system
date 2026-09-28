import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { PERMISSIONS } from '@osooli/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { FormAlert } from '../../components/Form';
import { ConfirmDialog } from '../../components/Modal';
import { ErrorState, Loading } from '../../components/States';
import type { Role, UserRow } from './types';
import { UserStateBadges } from './UsersPage';

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, me } = useAuth();
  const queryClient = useQueryClient();
  const user = useQuery({ queryKey: ['users', id], queryFn: () => api<UserRow>(`/users/${id}`) });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });
  const [selected, setSelected] = useState<string[] | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const refresh = (data: UserRow) => {
    queryClient.setQueryData(['users', id], data);
    void queryClient.invalidateQueries({ queryKey: ['/users'] });
  };
  const saveRoles = useMutation({
    mutationFn: (roleIds: string[]) => api<UserRow>(`/users/${id}/roles`, { method: 'PUT', json: { roleIds } }),
    onSuccess: (data) => {
      refresh(data);
      setSelected(null);
    },
  });
  const setActive = useMutation({
    mutationFn: (isActive: boolean) => api<UserRow>(`/users/${id}`, { method: 'PATCH', json: { isActive } }),
    onSuccess: (data) => {
      refresh(data);
      setConfirmDeactivate(false);
    },
  });
  const unlock = useMutation({
    mutationFn: () => api<UserRow>(`/users/${id}/unlock`, { method: 'POST' }),
    onSuccess: refresh,
  });

  if (user.isPending) return <Loading />;
  if (user.isError) return <ErrorState error={user.error} onRetry={() => void user.refetch()} />;
  const u = user.data;
  const canManage = can(PERMISSIONS.USERS_MANAGE);
  const current = u.roles.map((r) => r.id);
  const roleIds = selected ?? current;
  const dirty = selected !== null && (selected.length !== current.length || selected.some((r) => !current.includes(r)));
  const isSelf = me?.id === u.id;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="muted">
            <Link to="/admin/users">المستخدمون</Link> / {u.employee.fullName}
          </p>
          <h1>{u.employee.fullName}</h1>
          <UserStateBadges user={u} />
        </div>
        {canManage && (
          <div className="row-actions">
            {u.lockedUntil && (
              <button type="button" className="btn" disabled={unlock.isPending} onClick={() => unlock.mutate()}>
                فك القفل
              </button>
            )}
            {u.isActive ? (
              <button type="button" className="btn btn-danger" disabled={isSelf} onClick={() => setConfirmDeactivate(true)} title={isSelf ? 'لا يمكنك تعطيل حسابك' : undefined}>
                تعطيل الحساب
              </button>
            ) : (
              <button type="button" className="btn" disabled={setActive.isPending || !u.employee.isActive} onClick={() => setActive.mutate(true)}>
                تفعيل الحساب
              </button>
            )}
          </div>
        )}
      </div>

      <FormAlert error={setActive.error ?? unlock.error} />

      <section className="card">
        <h2>بيانات الحساب</h2>
        <dl className="details">
          <dt>اسم المستخدم</dt>
          <dd>
            <bdi dir="ltr">{u.username}</bdi>
          </dd>
          <dt>الرقم الوظيفي (EAP)</dt>
          <dd>
            <bdi dir="ltr">{u.employee.eapEmployeeId}</bdi>
          </dd>
          <dt>المسمى الوظيفي</dt>
          <dd>{u.employee.jobTitle ?? '—'}</dd>
          <dt>البريد</dt>
          <dd>
            <bdi dir="ltr">{u.employee.email ?? '—'}</bdi>
          </dd>
          <dt>آخر دخول</dt>
          <dd>{formatDateTime(u.lastLoginAt)}</dd>
          <dt>مقفل حتى</dt>
          <dd>{formatDateTime(u.lockedUntil)}</dd>
          <dt>تاريخ الإنشاء</dt>
          <dd>{formatDateTime(u.createdAt)}</dd>
        </dl>
      </section>

      <section className="card">
        <h2>الأدوار</h2>
        <p className="muted">الصلاحيات الفعلية هي مجموع صلاحيات الأدوار الفعّالة. التغيير يسري فورًا.</p>
        <FormAlert error={saveRoles.error} />
        <div className="check-grid">
          {roles.data?.map((r) => (
            <label key={r.id} className="check">
              <input
                type="checkbox"
                disabled={!canManage || (r.status !== 'ACTIVE' && !current.includes(r.id))}
                checked={roleIds.includes(r.id)}
                onChange={(e) => setSelected(e.target.checked ? [...roleIds, r.id] : roleIds.filter((x) => x !== r.id))}
              />
              {r.name}
              {r.status !== 'ACTIVE' && <span className="badge">معطّل</span>}
            </label>
          ))}
        </div>
        {canManage && (
          <p style={{ marginBlockStart: '1rem' }}>
            <button type="button" className="btn btn-primary" disabled={!dirty || saveRoles.isPending} onClick={() => saveRoles.mutate(roleIds)}>
              حفظ الأدوار
            </button>{' '}
            {dirty && (
              <button type="button" className="btn" onClick={() => setSelected(null)}>
                تراجع
              </button>
            )}
          </p>
        )}
      </section>

      <ConfirmDialog
        open={confirmDeactivate}
        title="تعطيل الحساب"
        message={`سيتم تعطيل حساب ${u.employee.fullName} وإنهاء جميع جلساته فورًا. يبقى تاريخه محفوظًا.`}
        confirmLabel="تعطيل"
        danger
        busy={setActive.isPending}
        error={setActive.error ? (setActive.error as Error).message : null}
        onConfirm={() => setActive.mutate(false)}
        onClose={() => setConfirmDeactivate(false)}
      />
    </>
  );
}
