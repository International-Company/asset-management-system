import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { type Page, useServerList } from '../../lib/list';
import { type Column, DataTable, SearchBox, Tabs } from '../../components/DataTable';
import { FormAlert, formError, SelectField, StatusBadge } from '../../components/Form';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { NameDialog } from './NameDialog';
import type { Status } from './types';
import { useRecordActions } from './useRecordActions';

interface Link {
  locationId: string;
  departmentId: string;
  status: Status;
  department: { id: string; name: string; status: Status };
}
interface LocationRow {
  id: string;
  name: string;
  status: Status;
  departments: Link[];
}
interface DepartmentRow {
  id: string;
  name: string;
  status: Status;
  locations: Array<{ status: Status; location: { id: string; name: string; status: Status } }>;
}

type Kind = 'locations' | 'departments';
type Named = { id: string; name: string; status: Status };

/** Locations, departments and the registered combinations between them (spec §12). */
export function LocationsPage() {
  const [params, setParams] = useSearchParams();
  const kind: Kind = params.get('tab') === 'departments' ? 'departments' : 'locations';
  return (
    <>
      <div className="page-header">
        <div>
          <h1>المواقع والأقسام</h1>
          <p className="muted">
            القسم يمكن أن يوجد في عدة مواقع. لا يمكن اختيار تركيبة موقع/قسم غير مسجلة. المواقع والأقسام المرتبطة بالتاريخ تُعطَّل بدل الحذف.
          </p>
        </div>
      </div>
      <Tabs
        tabs={[
          ['locations', 'المواقع'],
          ['departments', 'الأقسام'],
        ]}
        active={kind}
        onChange={(k) => setParams(k === 'departments' ? { tab: k } : {}, { replace: true })}
      />
      {/* key resets list state when switching tabs */}
      <NamedList key={kind} kind={kind} />
    </>
  );
}

function NamedList({ kind }: { kind: Kind }) {
  const path = `/${kind}`;
  const { state, update, query } = useServerList<LocationRow & DepartmentRow>(path, ['status'], { sort: 'name' });
  const actions = useRecordActions(path);
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'rename'; row: Named } | null>(null);
  const [deleting, setDeleting] = useState<Named | null>(null);
  const [managing, setManaging] = useState<string | null>(null);
  const noun = kind === 'locations' ? 'الموقع' : 'القسم';

  const columns: Column<LocationRow & DepartmentRow>[] = [
    { key: 'name', label: kind === 'locations' ? 'الموقع' : 'القسم', sort: 'name', render: (r) => r.name },
    {
      key: 'links',
      label: kind === 'locations' ? 'الأقسام المسجلة' : 'موجود في المواقع',
      render: (r) => {
        const names =
          kind === 'locations'
            ? r.departments.map((d) => ({ name: d.department.name, active: d.status === 'ACTIVE' }))
            : r.locations.map((l) => ({ name: l.location.name, active: l.status === 'ACTIVE' }));
        return names.length ? (
          <span className="chips">
            {names.map((n) => (
              <span key={n.name} className="badge" title={n.active ? undefined : 'معطّل'} style={n.active ? undefined : { textDecoration: 'line-through' }}>
                {n.name}
              </span>
            ))}
          </span>
        ) : (
          <span className="muted">—</span>
        );
      },
    },
    { key: 'status', label: 'الحالة', sort: 'status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (r) => (
        <div className="row-actions">
          {kind === 'locations' && (
            <button type="button" className="btn btn-sm" onClick={() => setManaging(r.id)}>
              الأقسام
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={() => setDialog({ mode: 'rename', row: r })}>
            تعديل الاسم
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => actions.update.mutate({ id: r.id, status: r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}
          >
            {r.status === 'ACTIVE' ? 'تعطيل' : 'تفعيل'}
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => setDeleting(r)}>
            حذف
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="toolbar">
        <SearchBox value={state.q} onSearch={(q) => update({ q })} />
        <SelectField label="الحالة" value={state.filters.status} onChange={(e) => update({ filters: { status: e.target.value } })}>
          <option value="">الكل</option>
          <option value="ACTIVE">فعّال</option>
          <option value="INACTIVE">معطّل</option>
        </SelectField>
        <button type="button" className="btn btn-primary" onClick={() => setDialog({ mode: 'create' })}>
          {kind === 'locations' ? 'إضافة موقع' : 'إضافة قسم'}
        </button>
      </div>
      <FormAlert error={actions.update.isError && !dialog ? actions.update.error : null} />
      <DataTable columns={columns} query={query} state={state} onChange={update} rowKey={(r) => r.id} empty="لا توجد سجلات." />

      {dialog && (
        <NameDialog
          title={dialog.mode === 'create' ? (kind === 'locations' ? 'موقع جديد' : 'قسم جديد') : `تعديل اسم ${noun}`}
          label="الاسم"
          initial={dialog.mode === 'rename' ? dialog.row.name : ''}
          pending={dialog.mode === 'create' ? actions.create.isPending : actions.update.isPending}
          error={dialog.mode === 'create' ? actions.create.error : actions.update.error}
          submit={(name) =>
            dialog.mode === 'create' ? actions.create.mutateAsync({ name }) : actions.update.mutateAsync({ id: dialog.row.id, name })
          }
          onClose={() => {
            actions.create.reset();
            actions.update.reset();
            setDialog(null);
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={`حذف ${noun}`}
        message={`حذف «${deleting?.name}» نهائيًا؟ لا يمكن حذف ما هو مرتبط بأصول أو بالتاريخ.`}
        confirmLabel="حذف"
        danger
        busy={actions.remove.isPending}
        error={formError(actions.remove.error)}
        onConfirm={() => deleting && actions.remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
        onClose={() => {
          actions.remove.reset();
          setDeleting(null);
        }}
      />
      {managing && (
        <LinksDialog location={query.data?.items.find((l) => l.id === managing) ?? null} onClose={() => setManaging(null)} />
      )}
    </>
  );
}

function LinksDialog({ location, onClose }: { location: LocationRow | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [departmentId, setDepartmentId] = useState('');
  const departments = useQuery({
    queryKey: ['/departments', 'all-active'],
    queryFn: () => api<Page<DepartmentRow>>('/departments?status=ACTIVE&pageSize=250&sort=name'),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['/locations'] });
    void queryClient.invalidateQueries({ queryKey: ['/departments'] });
  };
  const base = `/locations/${location?.id}/departments`;
  const link = useMutation({ mutationFn: () => api(base, { method: 'POST', json: { departmentId } }), onSuccess: () => { setDepartmentId(''); refresh(); } });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Status }) => api(`${base}/${id}`, { method: 'PATCH', json: { status } }),
    onSuccess: refresh,
  });
  const unlink = useMutation({ mutationFn: (id: string) => api(`${base}/${id}`, { method: 'DELETE' }), onSuccess: refresh });

  if (!location) return null;
  const linked = new Set(location.departments.map((d) => d.departmentId));
  const available = departments.data?.items.filter((d) => !linked.has(d.id)) ?? [];

  return (
    <Modal open wide title={`أقسام الموقع: ${location.name}`} onClose={onClose}>
      <FormAlert error={link.error ?? setStatus.error ?? unlink.error} />
      <div className="toolbar">
        <SelectField label="إضافة قسم" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          <option value="">اختر قسمًا…</option>
          {available.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
        <button type="button" className="btn btn-primary" disabled={!departmentId || link.isPending} onClick={() => link.mutate()}>
          ربط
        </button>
      </div>
      {location.departments.length === 0 ? (
        <p className="muted">لا توجد أقسام مسجلة في هذا الموقع.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>القسم</th>
                <th>حالة الربط</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {location.departments.map((d) => (
                <tr key={d.departmentId}>
                  <td>
                    {d.department.name} {d.department.status === 'INACTIVE' && <span className="badge">القسم معطّل</span>}
                  </td>
                  <td>
                    <StatusBadge status={d.status} />
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setStatus.mutate({ id: d.departmentId, status: d.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}
                      >
                        {d.status === 'ACTIVE' ? 'تعطيل' : 'تفعيل'}
                      </button>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => unlink.mutate(d.departmentId)}>
                        إلغاء الربط
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
