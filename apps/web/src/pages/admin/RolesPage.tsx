import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { PERMISSION_GROUP_LABELS } from '../../lib/labels';
import { fieldErrors, FormAlert, StatusBadge, TextField } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { Empty, ErrorState, Loading } from '../../components/States';
import type { Role } from './types';

interface PermissionDef {
  key: string;
  label: string;
  group: string;
}

export function RolesPage() {
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });
  const catalogue = useQuery({ queryKey: ['roles', 'permissions'], queryFn: () => api<PermissionDef[]>('/roles/permissions') });
  const [editing, setEditing] = useState<Role | 'new' | null>(null);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>الأدوار والصلاحيات</h1>
          <p className="muted">يمكن للمستخدم امتلاك أكثر من دور، وصلاحياته هي مجموع صلاحيات أدواره الفعّالة.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          إنشاء دور
        </button>
      </div>

      {roles.isPending ? (
        <Loading />
      ) : roles.isError ? (
        <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
      ) : roles.data.length === 0 ? (
        <Empty>لا توجد أدوار.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>الدور</th>
                <th>الوصف</th>
                <th>عدد الصلاحيات</th>
                <th>مستخدمون فعّالون</th>
                <th>الحالة</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {roles.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name} {r.isSystem && <span className="badge">دور أساسي</span>}
                  </td>
                  <td className="muted">{r.description ?? '—'}</td>
                  <td>{r.permissionKeys.length}</td>
                  <td>{r.activeUserCount}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(r)}>
                      {r.key === 'SYSTEM_ADMINISTRATOR' ? 'عرض' : 'تعديل'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && catalogue.data && (
        <RoleEditor role={editing === 'new' ? null : editing} catalogue={catalogue.data} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function RoleEditor({ role, catalogue, onClose }: { role: Role | null; catalogue: PermissionDef[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const locked = role?.key === 'SYSTEM_ADMINISTRATOR';
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [keys, setKeys] = useState<string[]>(role?.permissionKeys ?? []);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      role ? api(`/roles/${role.id}`, { method: 'PATCH', json: body }) : api('/roles', { method: 'POST', json: body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      onClose();
    },
  });
  const errors = fieldErrors(save.error);
  const groups = [...new Set(catalogue.map((p) => p.group))];

  const toggleGroup = (group: string, on: boolean) => {
    const inGroup = catalogue.filter((p) => p.group === group).map((p) => p.key);
    setKeys((k) => (on ? [...new Set([...k, ...inGroup])] : k.filter((x) => !inGroup.includes(x))));
  };

  return (
    <Modal
      open
      wide
      title={role ? `الدور: ${role.name}` : 'إنشاء دور'}
      onClose={onClose}
      footer={
        !locked && (
          <>
            <button
              type="button"
              className="btn btn-primary"
              disabled={save.isPending || !name.trim()}
              onClick={() => save.mutate({ name, description, permissionKeys: keys })}
            >
              {save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
            {role && (
              <button
                type="button"
                className={`btn ${role.status === 'ACTIVE' ? 'btn-danger' : ''}`}
                disabled={save.isPending}
                onClick={() => save.mutate({ status: role.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}
              >
                {role.status === 'ACTIVE' ? 'تعطيل الدور' : 'تفعيل الدور'}
              </button>
            )}
          </>
        )
      }
    >
      <FormAlert error={save.error} />
      {locked && <div className="alert alert-info">دور مدير النظام يملك جميع الصلاحيات دائمًا ولا يمكن تعديله أو تعطيله.</div>}
      {role?.status === 'INACTIVE' && <div className="alert alert-warning">هذا الدور معطّل ولا يمنح أي صلاحية حاليًا.</div>}
      <div className="form-grid">
        <TextField label="اسم الدور" value={name} disabled={locked} onChange={(e) => setName(e.target.value)} error={errors.name} />
        <TextField
          label="الوصف"
          value={description}
          disabled={locked}
          onChange={(e) => setDescription(e.target.value)}
          error={errors.description}
        />
      </div>
      {groups.map((group) => {
        const perms = catalogue.filter((p) => p.group === group);
        const all = perms.every((p) => keys.includes(p.key));
        return (
          <fieldset key={group} className="group">
            <legend>
              <label className="check">
                <input type="checkbox" disabled={locked} checked={all} onChange={(e) => toggleGroup(group, e.target.checked)} />
                {PERMISSION_GROUP_LABELS[group] ?? group}
              </label>
            </legend>
            <div className="check-grid">
              {perms.map((p) => (
                <label key={p.key} className="check">
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={keys.includes(p.key)}
                    onChange={(e) => setKeys((k) => (e.target.checked ? [...k, p.key] : k.filter((x) => x !== p.key)))}
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </Modal>
  );
}
