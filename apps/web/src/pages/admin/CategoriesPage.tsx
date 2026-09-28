import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MAIN_CATEGORY_LABELS, type MainCategoryCode } from '@osooli/shared';
import { api } from '../../lib/api';
import { useServerList } from '../../lib/list';
import { type Column, DataTable, SearchBox, Tabs } from '../../components/DataTable';
import { formError, SelectField, StatusBadge } from '../../components/Form';
import { ConfirmDialog } from '../../components/Modal';
import { NameDialog } from './NameDialog';
import type { Status } from './types';
import { useRecordActions } from './useRecordActions';

interface Subcategory {
  id: string;
  name: string;
  mainCategory: MainCategoryCode;
  status: Status;
  assetCount: number;
}
interface MainCategory {
  code: MainCategoryCode;
  nameAr: string;
  subcategoryCount: number;
}

const CODES = Object.keys(MAIN_CATEGORY_LABELS) as MainCategoryCode[];

/** Main categories are fixed (spec §5); subcategories are managed here. */
export function CategoriesPage() {
  const { state, update, query } = useServerList<Subcategory>('/categories/subcategories', ['mainCategory', 'status'], {
    sort: 'name',
    filters: { mainCategory: 'OFF' },
  });
  const main = useQuery({ queryKey: ['/categories'], queryFn: () => api<MainCategory[]>('/categories') });
  const actions = useRecordActions('/categories/subcategories');
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'rename'; row: Subcategory } | null>(null);
  const [deleting, setDeleting] = useState<Subcategory | null>(null);
  const active = state.filters.mainCategory as MainCategoryCode;

  const columns: Column<Subcategory>[] = [
    { key: 'name', label: 'الفئة الفرعية', sort: 'name', render: (s) => s.name },
    { key: 'assets', label: 'عدد الأصول', render: (s) => s.assetCount },
    { key: 'status', label: 'الحالة', render: (s) => <StatusBadge status={s.status} /> },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (s) => (
        <div className="row-actions">
          <button type="button" className="btn btn-sm" onClick={() => setDialog({ mode: 'rename', row: s })}>
            تعديل الاسم
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => actions.update.mutate({ id: s.id, status: s.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}
          >
            {s.status === 'ACTIVE' ? 'تعطيل' : 'تفعيل'}
          </button>
          {s.assetCount === 0 && (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setDeleting(s)}>
              حذف
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>الفئات</h1>
          <p className="muted">الفئات الرئيسية ثابتة. الفئات الفرعية لا تُحذف إذا كانت مستخدمة، ويمكن تعطيلها بدلًا من ذلك.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setDialog({ mode: 'create' })}>
          إضافة فئة فرعية
        </button>
      </div>

      <Tabs
        tabs={CODES.map((c) => [c, `${MAIN_CATEGORY_LABELS[c]} (${c})${main.data ? ` — ${main.data.find((m) => m.code === c)?.subcategoryCount ?? 0}` : ''}`])}
        active={active}
        onChange={(c) => update({ filters: { mainCategory: c } })}
      />

      {actions.update.isError && (
        <div className="alert alert-error" role="alert">
          {formError(actions.update.error)}
        </div>
      )}

      <div className="toolbar">
        <SearchBox value={state.q} onSearch={(q) => update({ q })} />
        <SelectField label="الحالة" value={state.filters.status} onChange={(e) => update({ filters: { status: e.target.value } })}>
          <option value="">الكل</option>
          <option value="ACTIVE">فعّال</option>
          <option value="INACTIVE">معطّل</option>
        </SelectField>
      </div>

      <DataTable
        columns={columns}
        query={query}
        state={state}
        onChange={update}
        rowKey={(s) => s.id}
        empty="لا توجد فئات فرعية في هذه الفئة."
      />

      {dialog?.mode === 'create' && (
        <NameDialog
          title={`فئة فرعية جديدة — ${MAIN_CATEGORY_LABELS[active]}`}
          label="اسم الفئة الفرعية"
          pending={actions.create.isPending}
          error={actions.create.error}
          submit={(name) => actions.create.mutateAsync({ mainCategory: active, name })}
          onClose={() => {
            actions.create.reset();
            setDialog(null);
          }}
        />
      )}
      {dialog?.mode === 'rename' && (
        <NameDialog
          title="تعديل اسم الفئة الفرعية"
          label="الاسم"
          initial={dialog.row.name}
          pending={actions.update.isPending}
          error={actions.update.error}
          submit={(name) => actions.update.mutateAsync({ id: dialog.row.id, name })}
          onClose={() => {
            actions.update.reset();
            setDialog(null);
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="حذف فئة فرعية"
        message={`حذف الفئة الفرعية «${deleting?.name}» نهائيًا؟`}
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
