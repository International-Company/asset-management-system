import { FormEvent, useState } from 'react';
import { PERMISSIONS } from '@osooli/shared';
import { useAuth } from '../../lib/auth';
import { useServerList } from '../../lib/list';
import { type Column, DataTable, SearchBox } from '../../components/DataTable';
import { fieldErrors, FormAlert, formError, SelectField, StatusBadge, TextField } from '../../components/Form';
import { ConfirmDialog, Modal } from '../../components/Modal';
import type { Status } from './types';
import { useRecordActions } from './useRecordActions';

interface Person {
  id: string;
  name: string;
  phone: string | null;
  organization: string | null;
  notes: string | null;
  status: Status;
  assetCount: number;
}

/** External responsible people (spec §13): reusable across assets; free-text responsibles are not allowed. */
export function ExternalPeoplePage() {
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.EXTERNAL_PEOPLE_MANAGE);
  const { state, update, query } = useServerList<Person>('/external-people', ['status'], { sort: 'name' });
  const actions = useRecordActions('/external-people');
  const [editing, setEditing] = useState<Person | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Person | null>(null);

  const columns: Column<Person>[] = [
    { key: 'name', label: 'الاسم', sort: 'name', render: (p) => p.name },
    { key: 'org', label: 'الجهة', sort: 'organization', render: (p) => p.organization ?? '—' },
    { key: 'phone', label: 'الهاتف', render: (p) => <bdi dir="ltr">{p.phone ?? '—'}</bdi> },
    { key: 'assets', label: 'أصول بعهدته', render: (p) => p.assetCount },
    { key: 'status', label: 'الحالة', render: (p) => <StatusBadge status={p.status} /> },
    ...(canManage
      ? [
          {
            key: 'actions',
            label: 'إجراءات',
            render: (p: Person) => (
              <div className="row-actions">
                <button type="button" className="btn btn-sm" onClick={() => setEditing(p)}>
                  تعديل
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => setDeleting(p)}>
                  حذف
                </button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>المسؤولون الخارجيون</h1>
          <p className="muted">أشخاص من خارج الشركة يمكن تعيينهم مسؤولين عن الأصول.</p>
        </div>
        {canManage && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            إضافة شخص
          </button>
        )}
      </div>
      <div className="toolbar">
        <SearchBox value={state.q} onSearch={(q) => update({ q })} label="بحث بالاسم أو الجهة أو الهاتف" />
        <SelectField label="الحالة" value={state.filters.status} onChange={(e) => update({ filters: { status: e.target.value } })}>
          <option value="">الكل</option>
          <option value="ACTIVE">فعّال</option>
          <option value="INACTIVE">معطّل</option>
        </SelectField>
      </div>
      <DataTable columns={columns} query={query} state={state} onChange={update} rowKey={(p) => p.id} empty="لا يوجد أشخاص." />

      {editing && (
        <PersonDialog
          person={editing === 'new' ? null : editing}
          actions={actions}
          onClose={() => {
            actions.create.reset();
            actions.update.reset();
            setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="حذف شخص"
        message={`حذف «${deleting?.name}»؟ لا يمكن حذف من له ارتباط بأصول أو عمليات؛ يمكن تعطيله بدلًا من ذلك.`}
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
    </>
  );
}

function PersonDialog({
  person,
  actions,
  onClose,
}: {
  person: Person | null;
  actions: ReturnType<typeof useRecordActions>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: person?.name ?? '',
    phone: person?.phone ?? '',
    organization: person?.organization ?? '',
    notes: person?.notes ?? '',
    status: person?.status ?? 'ACTIVE',
  });
  const mutation = person ? actions.update : actions.create;
  const errors = fieldErrors(mutation.error);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { status, ...fields } = form;
    try {
      if (person) await actions.update.mutateAsync({ id: person.id, ...fields, status });
      else await actions.create.mutateAsync(fields);
      onClose();
    } catch {
      // Shown below.
    }
  };

  return (
    <Modal open title={person ? 'تعديل بيانات الشخص' : 'إضافة شخص خارجي'} onClose={onClose}>
      <form onSubmit={submit}>
        <FormAlert error={mutation.error} />
        <TextField label="الاسم" value={form.name} onChange={set('name')} required autoFocus error={errors.name} />
        <div className="form-grid">
          <TextField label="الهاتف" value={form.phone} onChange={set('phone')} dir="ltr" error={errors.phone} />
          <TextField label="الجهة" value={form.organization} onChange={set('organization')} error={errors.organization} />
        </div>
        <TextField label="ملاحظات" value={form.notes} onChange={set('notes')} error={errors.notes} />
        {person && (
          <SelectField label="الحالة" value={form.status} onChange={set('status')}>
            <option value="ACTIVE">فعّال</option>
            <option value="INACTIVE">معطّل</option>
          </SelectField>
        )}
        <button type="submit" className="btn btn-primary" disabled={mutation.isPending || !form.name.trim()}>
          {mutation.isPending ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
      </form>
    </Modal>
  );
}
