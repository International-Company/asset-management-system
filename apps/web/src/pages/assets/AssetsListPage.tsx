import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ASSET_STATUS_LABELS, AssetStatus, MAIN_CATEGORY_LABELS, PERMISSIONS, type MainCategoryCode } from '@osooli/shared';
import { api, ApiError, openFile } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { useServerList } from '../../lib/list';
import { type Column, DataTable, SearchBox } from '../../components/DataTable';
import { SelectField } from '../../components/Form';
import { UrlCheckboxGroup, UrlSelectField, UrlTextField } from '../../components/UrlFields';
import { SavedSearchBar } from '../../components/SavedSearches';
import type { AssetListItem, CategoryLookup, LocationLookup } from './types';

const STATUS_TONE: Record<AssetStatus, string> = {
  NEW: 'badge-success',
  IN_USE: 'badge-success',
  UNUSED: '',
  UNDER_MAINTENANCE: 'badge-warning',
  DAMAGED: 'badge-danger',
  LOST: 'badge-danger',
  DISPOSED: '',
  SOLD: '',
};

export function StatusPill({ status }: { status: AssetStatus }) {
  return <span className={`badge ${STATUS_TONE[status]}`}>{ASSET_STATUS_LABELS[status]}</span>;
}

export function responsibleName(a: Pick<AssetListItem, 'responsibleEmployee' | 'responsibleExternal'>): string {
  return a.responsibleEmployee?.fullName ?? a.responsibleExternal?.name ?? '—';
}

const OPTIONAL_COLUMNS: Array<[key: string, label: string]> = [
  ['category', 'الفئة'],
  ['serial', 'الرقم التسلسلي'],
  ['location', 'الموقع / القسم'],
  ['responsible', 'المسؤول'],
  ['network', 'MAC / IP'],
  ['created', 'تاريخ الإنشاء'],
];
const DEFAULT_HIDDEN = ['network', 'created'];

const BASIC_FILTERS = ['mainCategory', 'subcategoryId', 'status', 'locationId', 'departmentId'];
/** Advanced conditions (spec §41); all combine with AND on the server. */
const ADVANCED_FILTERS = [
  'statusIn',
  'responsibleType',
  'inactiveResponsible',
  'serialInternal',
  'hasPhoto',
  'createdFrom',
  'createdTo',
  'purchaseFrom',
  'purchaseTo',
  'warrantyUntil',
  'manufacturer',
  'supplier',
];
const ALL_FILTERS = [...BASIC_FILTERS, ...ADVANCED_FILTERS];

function useHiddenColumns(): [string[], (key: string) => void, (hidden: string[]) => void] {
  const read = () => {
    try {
      const v = JSON.parse(localStorage.getItem('osooli.assets.hiddenColumns') ?? 'null');
      return Array.isArray(v) ? (v as string[]) : DEFAULT_HIDDEN;
    } catch {
      return DEFAULT_HIDDEN;
    }
  };
  const [hidden, setHidden] = useState<string[]>(read);
  const toggle = (key: string) =>
    setHidden((h) => {
      const next = h.includes(key) ? h.filter((k) => k !== key) : [...h, key];
      try {
        localStorage.setItem('osooli.assets.hiddenColumns', JSON.stringify(next));
      } catch {
        // storage unavailable: keep in memory only
      }
      return next;
    });
  const replaceAll = (next: string[]) => {
    setHidden(next);
    try {
      localStorage.setItem('osooli.assets.hiddenColumns', JSON.stringify(next));
    } catch {
      // storage unavailable: keep in memory only
    }
  };
  return [hidden, toggle, replaceAll];
}

export function AssetsListPage() {
  const { can } = useAuth();
  const { state, update, query } = useServerList<AssetListItem>(
    '/assets',
    ALL_FILTERS,
    { sort: 'createdAt', order: 'desc' },
  );
  const categories = useQuery({ queryKey: ['lookups', 'categories'], queryFn: () => api<CategoryLookup[]>('/lookups/categories') });
  const locations = useQuery({ queryKey: ['lookups', 'locations'], queryFn: () => api<LocationLookup[]>('/lookups/locations') });
  const [hidden, toggleColumn, setHidden] = useHiddenColumns();
  const [advanced, setAdvanced] = useState(() => ADVANCED_FILTERS.some((k) => state.filters[k]));
  const [selected, setSelected] = useState<string[]>([]);
  const [showColumns, setShowColumns] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const canPrint = can(PERMISSIONS.QR_PRINT);

  const f = state.filters;
  const subs = categories.data?.find((c) => c.code === f.mainCategory)?.subcategories ?? [];
  const deps = locations.data?.find((l) => l.id === f.locationId)?.departments ?? [];
  const pageIds = query.data?.items.map((a) => a.id) ?? [];
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));

  const columns: Column<AssetListItem>[] = [
    ...(canPrint
      ? [
          {
            key: 'select',
            label: '',
            render: (a: AssetListItem) => (
              <input
                type="checkbox"
                aria-label={`تحديد ${a.assetNumber}`}
                checked={selected.includes(a.id)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id)))}
              />
            ),
          },
        ]
      : []),
    {
      key: 'number',
      label: 'رقم الأصل',
      sort: 'assetNumber',
      render: (a) => (
        <Link to={`/assets/${a.id}`}>
          <bdi dir="ltr">{a.assetNumber}</bdi>
        </Link>
      ),
    },
    { key: 'name', label: 'اسم الأصل', sort: 'name', render: (a) => a.name },
    { key: 'category', label: 'الفئة', render: (a) => `${MAIN_CATEGORY_LABELS[a.mainCategory]} / ${a.subcategory.name}` },
    { key: 'serial', label: 'الرقم التسلسلي', render: (a) => <bdi dir="ltr">{a.serialNumber}</bdi> },
    { key: 'location', label: 'الموقع / القسم', render: (a) => `${a.locationDepartment.location.name} / ${a.locationDepartment.department.name}` },
    {
      key: 'responsible',
      label: 'المسؤول',
      render: (a) => (
        <>
          {responsibleName(a)}
          {a.responsibleEmployee && !a.responsibleEmployee.isActive && <span className="badge badge-warning">غير فعّال</span>}
        </>
      ),
    },
    {
      key: 'network',
      label: 'MAC / IP',
      render: (a) => (a.technical ? <bdi dir="ltr">{[a.technical.macAddress, a.technical.ipAddress].filter(Boolean).join(' · ') || '—'}</bdi> : '—'),
    },
    { key: 'status', label: 'الحالة', sort: 'status', render: (a) => <StatusPill status={a.status} /> },
    { key: 'created', label: 'تاريخ الإنشاء', sort: 'createdAt', render: (a) => formatDateTime(a.createdAt) },
  ];
  const visible = columns.filter((c) => !hidden.includes(c.key));

  const print = async () => {
    setPrintError(null);
    try {
      await openFile('/qr/labels', { assetIds: selected, perPage: 24 });
    } catch (e) {
      setPrintError(e instanceof ApiError ? e.message : 'تعذرت الطباعة.');
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>الأصول</h1>
          <p className="muted">ابحث برقم الأصل أو الاسم أو الرقم التسلسلي أو MAC أو IP أو اسم المسؤول أو رمز QR.</p>
        </div>
        {can(PERMISSIONS.ASSETS_CREATE) && (
          <Link className="btn btn-primary" to="/assets/new">
            أصل جديد
          </Link>
        )}
      </div>

      <div className="toolbar">
        <SearchBox value={state.q} onSearch={(q) => update({ q })} label="بحث" />
        <SelectField label="الفئة" value={f.mainCategory} onChange={(e) => update({ filters: { mainCategory: e.target.value, subcategoryId: '' } })}>
          <option value="">الكل</option>
          {categories.data?.map((c) => (
            <option key={c.code} value={c.code}>
              {MAIN_CATEGORY_LABELS[c.code as MainCategoryCode]}
            </option>
          ))}
        </SelectField>
        <SelectField label="الفئة الفرعية" value={f.subcategoryId} disabled={!f.mainCategory} onChange={(e) => update({ filters: { subcategoryId: e.target.value } })}>
          <option value="">الكل</option>
          {subs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="الحالة" value={f.status} onChange={(e) => update({ filters: { status: e.target.value } })}>
          <option value="">الكل</option>
          {Object.values(AssetStatus).map((s) => (
            <option key={s} value={s}>
              {ASSET_STATUS_LABELS[s]}
            </option>
          ))}
        </SelectField>
        <SelectField label="الموقع" value={f.locationId} onChange={(e) => update({ filters: { locationId: e.target.value, departmentId: '' } })}>
          <option value="">الكل</option>
          {locations.data?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="القسم" value={f.departmentId} disabled={!f.locationId} onChange={(e) => update({ filters: { departmentId: e.target.value } })}>
          <option value="">الكل</option>
          {deps.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="toolbar">
        <button type="button" className="btn btn-sm" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
          بحث متقدم
        </button>
        <button type="button" className="btn btn-sm" aria-expanded={showColumns} onClick={() => setShowColumns((s) => !s)}>
          الأعمدة
        </button>
        {canPrint && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={allOnPage}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...new Set([...s, ...pageIds])] : s.filter((id) => !pageIds.includes(id))))}
              />
              تحديد كل الصفحة
            </label>
            <button type="button" className="btn btn-sm" disabled={selected.length === 0} onClick={() => void print()}>
              طباعة ملصقات QR ({selected.length})
            </button>
            {selected.length > 0 && (
              <button type="button" className="btn-link" onClick={() => setSelected([])}>
                إلغاء التحديد
              </button>
            )}
          </>
        )}
      </div>
      {advanced && <AdvancedSearch filters={f} onChange={(patch) => update({ filters: patch })} />}
      <SavedSearchBar
        scope="assets"
        current={{
          filters: { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), ...(state.q ? { q: state.q } : {}) },
          columns: OPTIONAL_COLUMNS.map(([k]) => k).filter((k) => !hidden.includes(k)),
          sort: { sort: state.sort, order: state.order },
        }}
        onApply={(saved) => {
          const { q = '', ...rest } = saved.filters;
          update({
            q,
            ...(saved.sort?.sort ? { sort: saved.sort.sort, order: saved.sort.order ?? 'asc' } : {}),
            filters: Object.fromEntries(ALL_FILTERS.map((k) => [k, rest[k] ?? ''])),
          });
          if (saved.columns) setHidden(OPTIONAL_COLUMNS.map(([k]) => k).filter((k) => !saved.columns!.includes(k)));
          if (ADVANCED_FILTERS.some((k) => rest[k])) setAdvanced(true);
        }}
      />
      {showColumns && (
        <fieldset className="group">
          <legend>إظهار / إخفاء الأعمدة</legend>
          <div className="check-grid">
            {OPTIONAL_COLUMNS.map(([key, label]) => (
              <label key={key} className="check">
                <input type="checkbox" checked={!hidden.includes(key)} onChange={() => toggleColumn(key)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {printError && (
        <div className="alert alert-error" role="alert">
          {printError}
        </div>
      )}

      <DataTable columns={visible} query={query} state={state} onChange={update} rowKey={(a) => a.id} empty="لا توجد أصول مطابقة." caption="الأصول" />
    </>
  );
}

const YES_NO: Array<[string, string]> = [
  ['', 'الكل'],
  ['true', 'نعم'],
  ['false', 'لا'],
];

/** Advanced conditions panel (spec §41). */
function AdvancedSearch({ filters: f, onChange }: { filters: Record<string, string>; onChange: (patch: Record<string, string>) => void }) {
  const bind = (key: string) => ({ value: f[key] ?? '', onChange: (v: string) => onChange({ [key]: v }) });
  return (
    <fieldset className="group">
      <legend>بحث متقدم</legend>
      <UrlCheckboxGroup label="الحالات" options={Object.values(AssetStatus).map((s) => [s, ASSET_STATUS_LABELS[s]])} {...bind('statusIn')} />
      <div className="form-grid" style={{ marginBlockStart: '0.75rem' }}>
        <UrlSelectField label="نوع المسؤول" {...bind('responsibleType')}>
          <option value="">الكل</option>
          <option value="EMPLOYEE">موظف</option>
          <option value="EXTERNAL">شخص خارجي</option>
        </UrlSelectField>
        <UrlSelectField label="مسؤول غير فعّال في EAP" {...bind('inactiveResponsible')}>
          <option value="">الكل</option>
          <option value="true">نعم</option>
        </UrlSelectField>
        {(['serialInternal', 'hasPhoto'] as const).map((key) => (
          <UrlSelectField key={key} label={key === 'serialInternal' ? 'رقم تسلسلي داخلي' : 'له صور'} {...bind(key)}>
            {YES_NO.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </UrlSelectField>
        ))}
        <UrlTextField label="أُنشئ من" type="date" {...bind('createdFrom')} />
        <UrlTextField label="أُنشئ إلى" type="date" {...bind('createdTo')} />
        <UrlTextField label="شراء من" type="date" {...bind('purchaseFrom')} />
        <UrlTextField label="شراء إلى" type="date" {...bind('purchaseTo')} />
        <UrlTextField label="ضمان ينتهي قبل" type="date" {...bind('warrantyUntil')} />
        <UrlTextField label="الشركة المصنعة" {...bind('manufacturer')} />
        <UrlTextField label="المورد" {...bind('supplier')} />
      </div>
      <button type="button" className="btn-link" onClick={() => onChange(Object.fromEntries(ADVANCED_FILTERS.map((k) => [k, ''])))}>
        مسح الشروط المتقدمة
      </button>
    </fieldset>
  );
}
