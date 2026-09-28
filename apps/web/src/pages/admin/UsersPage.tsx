import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { PERMISSIONS } from '@osooli/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { useServerList } from '../../lib/list';
import { type Column, DataTable, SearchBox } from '../../components/DataTable';
import { fieldErrors, FormAlert, SelectField, TextField } from '../../components/Form';
import { Modal } from '../../components/Modal';
import type { DirectoryEntry, Role, UserRow } from './types';

export function UserStateBadges({ user }: { user: Pick<UserRow, 'isActive' | 'lockedUntil' | 'employee'> }) {
  return (
    <span className="chips">
      <span className={`badge ${user.isActive ? 'badge-success' : ''}`}>{user.isActive ? 'فعّال' : 'معطّل'}</span>
      {user.lockedUntil && <span className="badge badge-danger">مقفل</span>}
      {!user.employee.isActive && <span className="badge badge-warning">غير فعّال في EAP</span>}
    </span>
  );
}

export function UsersPage() {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const { state, update, query } = useServerList<UserRow>('/users', ['state', 'roleId'], { sort: 'fullName' });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });

  const columns: Column<UserRow>[] = [
    {
      key: 'name',
      label: 'الاسم',
      sort: 'fullName',
      render: (u) => (
        <Link to={`/admin/users/${u.id}`}>
          {u.employee.fullName}
        </Link>
      ),
    },
    { key: 'username', label: 'اسم المستخدم', sort: 'username', render: (u) => <bdi dir="ltr">{u.username}</bdi> },
    { key: 'roles', label: 'الأدوار', render: (u) => u.roles.map((r) => r.name).join('، ') || '—' },
    { key: 'state', label: 'الحالة', render: (u) => <UserStateBadges user={u} /> },
    { key: 'lastLogin', label: 'آخر دخول', sort: 'lastLoginAt', render: (u) => formatDateTime(u.lastLoginAt) },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>المستخدمون</h1>
          <p className="muted">حسابات نظام الأصول. بيانات الموظفين والمصادقة مصدرها EAP.</p>
        </div>
        {can(PERMISSIONS.USERS_MANAGE) && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            إضافة مستخدم
          </button>
        )}
      </div>

      <div className="toolbar">
        <SearchBox value={state.q} onSearch={(q) => update({ q })} label="بحث بالاسم أو اسم المستخدم" />
        <SelectField label="الحالة" value={state.filters.state} onChange={(e) => update({ filters: { state: e.target.value } })}>
          <option value="">الكل</option>
          <option value="active">فعّال</option>
          <option value="inactive">معطّل</option>
          <option value="locked">مقفل</option>
        </SelectField>
        <SelectField label="الدور" value={state.filters.roleId} onChange={(e) => update({ filters: { roleId: e.target.value } })}>
          <option value="">كل الأدوار</option>
          {roles.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </SelectField>
      </div>

      <DataTable
        columns={columns}
        query={query}
        state={state}
        onChange={update}
        rowKey={(u) => u.id}
        empty="لا يوجد مستخدمون مطابقون."
        caption="المستخدمون"
      />

      {creating && <CreateUserDialog roles={roles.data ?? []} onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateUserDialog({ roles, onClose }: { roles: Role[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [picked, setPicked] = useState<DirectoryEntry | null>(null);
  const [username, setUsername] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);

  const directory = useQuery({
    queryKey: ['employees', 'directory', submitted],
    queryFn: () => api<DirectoryEntry[]>(`/employees/directory?q=${encodeURIComponent(submitted)}`),
    enabled: submitted.length > 0,
  });

  const create = useMutation({
    mutationFn: () => api<UserRow>('/users', { method: 'POST', json: { eapEmployeeId: picked!.eapEmployeeId, username, roleIds } }),
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: ['/users'] });
      navigate(`/admin/users/${user.id}`);
    },
  });
  const errors = fieldErrors(create.error);

  const find = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(search.trim());
  };

  return (
    <Modal
      open
      wide
      title="إضافة مستخدم"
      onClose={onClose}
      footer={
        picked && (
          <>
            <button
              type="button"
              className="btn btn-primary"
              disabled={create.isPending || !username}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'جارٍ الحفظ…' : 'إنشاء الحساب'}
            </button>
            <button type="button" className="btn" onClick={() => setPicked(null)}>
              اختيار موظف آخر
            </button>
          </>
        )
      }
    >
      {!picked ? (
        <>
          <form className="toolbar" onSubmit={find}>
            <TextField label="ابحث عن موظف في EAP" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
            <button type="submit" className="btn" disabled={!search.trim()}>
              بحث
            </button>
          </form>
          {directory.isFetching && <p className="muted">جارٍ البحث…</p>}
          <FormAlert error={directory.error} />
          {directory.data && directory.data.length === 0 && <p className="muted">لا توجد نتائج.</p>}
          {directory.data && directory.data.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th>الرقم الوظيفي</th>
                    <th>المسمى</th>
                    <th>الحالة</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {directory.data.map((d) => (
                    <tr key={d.eapEmployeeId}>
                      <td>{d.fullName}</td>
                      <td>
                        <bdi dir="ltr">{d.eapEmployeeId}</bdi>
                      </td>
                      <td>{d.jobTitle ?? '—'}</td>
                      <td>
                        {d.user ? (
                          <span className="badge">لديه حساب</span>
                        ) : d.isActive ? (
                          <span className="badge badge-success">فعّال</span>
                        ) : (
                          <span className="badge badge-warning">غير فعّال</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={!!d.user || !d.isActive}
                          onClick={() => setPicked(d)}
                        >
                          اختيار
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <FormAlert error={create.error} />
          <p>
            الموظف: <strong>{picked.fullName}</strong> (<bdi dir="ltr">{picked.eapEmployeeId}</bdi>)
          </p>
          <TextField
            label="اسم المستخدم في EAP"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            dir="ltr"
            autoFocus
            hint="يجب أن يطابق اسم الدخول في EAP."
            error={errors.username}
          />
          <fieldset className="group">
            <legend>الأدوار</legend>
            <div className="check-grid">
              {roles
                .filter((r) => r.status === 'ACTIVE')
                .map((r) => (
                  <label key={r.id} className="check">
                    <input
                      type="checkbox"
                      checked={roleIds.includes(r.id)}
                      onChange={(e) => setRoleIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id)))}
                    />
                    {r.name}
                  </label>
                ))}
            </div>
            {errors.roleIds && <span className="field-error">{errors.roleIds.join(' ')}</span>}
          </fieldset>
        </>
      )}
    </Modal>
  );
}
