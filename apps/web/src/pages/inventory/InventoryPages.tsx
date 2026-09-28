import { FormEvent, useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ASSET_STATUS_LABELS,
  type AssetStatus,
  INVENTORY_STATUS_LABELS,
  type InventoryStatus,
  PERMISSIONS,
} from '@osooli/shared';
import { api, fileUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { useServerList } from '../../lib/list';
import { type Column, DataTable, SearchBox, Tabs } from '../../components/DataTable';
import { fieldErrors, FormAlert, formError, SelectField, TextField } from '../../components/Form';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { QrScanner } from '../../components/QrScanner';
import { ErrorState, Loading } from '../../components/States';
import { ResponsiblePicker } from '../assets/ResponsiblePicker';
import type { LocationLookup, Responsible } from '../assets/types';
import { AssetLink, OfficialPdfLink } from '../operations/shared';

export const CHECK_STATUSES: AssetStatus[] = [
  'NEW',
  'IN_USE',
  'UNUSED',
  'UNDER_MAINTENANCE',
  'DAMAGED',
  'LOST',
  'DISPOSED',
];

interface Scope {
  locationId: string | null;
  departmentId: string | null;
  location: { name: string } | null;
  department: { name: string } | null;
}
const scopeText = (s: Scope) =>
  `${s.location?.name ?? 'كل المواقع'} / ${s.department?.name ?? 'كل الأقسام'}`;

function InventoryStatusBadge({ status }: { status: InventoryStatus }) {
  return (
    <span className={`badge ${status === 'IN_PROGRESS' ? 'badge-warning' : 'badge-success'}`}>
      {INVENTORY_STATUS_LABELS[status]}
    </span>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="نسبة الإنجاز"
      >
        <span style={{ inlineSize: `${pct}%` }} />
      </div>
      <span className="hint">
        فُحص {done} من {total} ({pct}%)
      </span>
    </div>
  );
}

// ── List ────────────────────────────────────────────────────────────────

interface InventoryRow {
  id: string;
  number: string;
  status: InventoryStatus;
  createdAt: string;
  closedAt: string | null;
  scopes: Scope[];
  total: number;
  checked: number;
}

export function InventoryListPage() {
  const { can } = useAuth();
  const { state, update, query } = useServerList<InventoryRow>('/inventories', ['status'], {
    order: 'desc',
  });
  const columns: Column<InventoryRow>[] = [
    {
      key: 'number',
      label: 'رقم الجرد',
      render: (r) => (
        <Link to={`/inventories/${r.id}`}>
          <bdi dir="ltr">{r.number}</bdi>
        </Link>
      ),
    },
    { key: 'scope', label: 'النطاق', render: (r) => r.scopes.map(scopeText).join('، ') },
    { key: 'progress', label: 'الإنجاز', render: (r) => `${r.checked} / ${r.total}` },
    { key: 'status', label: 'الحالة', render: (r) => <InventoryStatusBadge status={r.status} /> },
    { key: 'created', label: 'البدء', render: (r) => formatDateTime(r.createdAt) },
    { key: 'closed', label: 'الإغلاق', render: (r) => formatDateTime(r.closedAt) },
  ];
  return (
    <>
      <div className="page-header">
        <div>
          <h1>الجرد</h1>
          <p className="muted">
            لا يُغلق الجرد قبل فحص جميع الأصول المتوقعة. بعد الإغلاق يصبح نهائيًا.
          </p>
        </div>
        {can(PERMISSIONS.INVENTORY_MANAGE) && (
          <Link className="btn btn-primary" to="/inventories/new">
            جرد جديد
          </Link>
        )}
      </div>
      <div className="toolbar">
        <SearchBox value={state.q} onSearch={(q) => update({ q })} label="بحث برقم الجرد" />
        <SelectField
          label="الحالة"
          value={state.filters.status}
          onChange={(e) => update({ filters: { status: e.target.value } })}
        >
          <option value="">الكل</option>
          {Object.entries(INVENTORY_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
      </div>
      <DataTable
        columns={columns}
        query={query}
        state={state}
        onChange={update}
        rowKey={(r) => r.id}
        empty="لا توجد عمليات جرد."
      />
    </>
  );
}

// ── New ─────────────────────────────────────────────────────────────────

interface DepartmentOption {
  id: string;
  name: string;
}

/** Scope: a location, a location + department, several locations, or several departments (spec §33). */
export function InventoryNewPage() {
  const navigate = useNavigate();
  const locations = useQuery({
    queryKey: ['lookups', 'locations'],
    queryFn: () => api<LocationLookup[]>('/lookups/locations'),
  });
  const allDepartments = [
    ...new Map((locations.data ?? []).flatMap((l) => l.departments).map((d) => [d.id, d])).values(),
  ] as DepartmentOption[];
  const [rows, setRows] = useState<Array<{ locationId: string; departmentId: string }>>([
    { locationId: '', departmentId: '' },
  ]);
  const [notes, setNotes] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/inventories', {
        method: 'POST',
        json: {
          scopes: rows.map((r) => ({
            ...(r.locationId ? { locationId: r.locationId } : {}),
            ...(r.departmentId ? { departmentId: r.departmentId } : {}),
          })),
          notes,
        },
      }),
    onSuccess: (res) => navigate(`/inventories/${res.id}`),
  });
  const set = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const valid = rows.some((r) => r.locationId || r.departmentId);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) create.mutate();
  };
  return (
    <form onSubmit={submit} noValidate>
      <p className="muted">
        <Link to="/inventories">الجرد</Link> / جرد جديد
      </p>
      <h1>جرد جديد</h1>
      <FormAlert error={create.error} />
      <section className="card">
        <h2>النطاق</h2>
        <p className="muted">
          أضف سطرًا لكل موقع أو قسم. اترك القسم فارغًا لجرد الموقع كله، أو الموقع فارغًا لجرد القسم
          في كل المواقع.
        </p>
        {rows.map((r, i) => {
          const deps = r.locationId
            ? (locations.data?.find((l) => l.id === r.locationId)?.departments ?? [])
            : allDepartments;
          return (
            <div key={i} className="toolbar">
              <SelectField
                label="الموقع"
                value={r.locationId}
                onChange={(e) => set(i, { locationId: e.target.value, departmentId: '' })}
              >
                <option value="">كل المواقع</option>
                {locations.data?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="القسم"
                value={r.departmentId}
                onChange={(e) => set(i, { departmentId: e.target.value })}
              >
                <option value="">كل الأقسام</option>
                {deps.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </SelectField>
              {rows.length > 1 && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
                >
                  إزالة
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setRows((r) => [...r, { locationId: '', departmentId: '' }])}
        >
          إضافة موقع أو قسم
        </button>
        {fieldErrors(create.error).scopes && (
          <p className="field-error">{fieldErrors(create.error).scopes.join(' ')}</p>
        )}
        <div className="field" style={{ marginBlockStart: '1rem' }}>
          <label htmlFor="inv-notes">ملاحظات</label>
          <textarea
            id="inv-notes"
            className="input"
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <p className="hint">
          تُحفظ البيانات المتوقعة لكل أصل (الموقع، القسم، المسؤول، الحالة) لحظة إنشاء الجرد. الأصول
          المباعة والمستبعدة لا تدخل الجرد.
        </p>
        <button type="submit" className="btn btn-primary" disabled={!valid || create.isPending}>
          {create.isPending ? 'جارٍ الإنشاء…' : 'بدء الجرد'}
        </button>
      </section>
    </form>
  );
}

// ── Detail / counting ───────────────────────────────────────────────────

interface Named {
  id: string;
  name: string;
}
interface Item {
  id: string;
  exists: boolean | null;
  checkedAt: string | null;
  confirmedByQr: boolean;
  hasDiscrepancy: boolean;
  notes: string | null;
  photoId: string | null;
  expectedStatus: AssetStatus;
  actualStatus: AssetStatus | null;
  asset: { id: string; assetNumber: string; name: string; serialNumber: string };
  expectedLocation: Named;
  expectedDepartment: Named;
  actualLocation: Named | null;
  actualDepartment: Named | null;
  expectedResponsibleEmployee: { fullName: string } | null;
  expectedResponsibleExternal: { name: string } | null;
  actualResponsibleEmployee: { fullName: string } | null;
  actualResponsibleExternal: { name: string } | null;
}
interface InventoryDetail {
  id: string;
  number: string;
  status: InventoryStatus;
  notes: string | null;
  createdAt: string;
  createdByName: string | null;
  closedAt: string | null;
  closedByName: string | null;
  scopes: Scope[];
  reopenings: Array<{ id: string; reason: string; createdAt: string; actorName: string | null }>;
  unregistered: Array<{
    id: string;
    description: string;
    scannedCode: string | null;
    notes: string | null;
    recordedAt: string;
    recordedByName: string | null;
    photo: { id: string } | null;
  }>;
  counts: {
    total: number;
    checked: number;
    unchecked: number;
    found: number;
    notFound: number;
    discrepancies: number;
    unregistered: number;
  };
  officialFileId: string | null;
  officialVersion: number | null;
}

type Filter = 'unchecked' | 'checked' | 'discrepancy' | 'notFound' | 'all' | 'unregistered';
type ScanResult =
  | { kind: 'ITEM'; item: Item; viaQr: boolean }
  | { kind: 'OUT_OF_SCOPE'; asset: { id: string; assetNumber: string; name: string } }
  | { kind: 'UNKNOWN'; code: string };

const resp = (e: { fullName: string } | null, x: { name: string } | null) =>
  e?.fullName ?? x?.name ?? '—';

export function InventoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const inv = useQuery({
    queryKey: ['inventories', id],
    queryFn: () => api<InventoryDetail>(`/inventories/${id}`),
  });
  const [filter, setFilter] = useState<Filter>('unchecked');
  const [checking, setChecking] = useState<{ item: Item; viaQr: boolean } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [outOfScope, setOutOfScope] = useState<{
    id: string;
    assetNumber: string;
    name: string;
  } | null>(null);
  const [unregistered, setUnregistered] = useState<{ code: string } | null>(null);
  const [dialog, setDialog] = useState<'close' | 'reopen' | null>(null);
  const [reason, setReason] = useState('');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['inventories', id] });
    void queryClient.invalidateQueries({ queryKey: [`/inventories/${id}/items`] });
  };
  const scan = useMutation({
    mutationFn: (code: string) =>
      api<ScanResult>(`/inventories/${id}/scan`, { method: 'POST', json: { code } }),
    onSuccess: (r) => {
      setScanning(false);
      if (r.kind === 'ITEM') setChecking({ item: r.item, viaQr: r.viaQr });
      else if (r.kind === 'OUT_OF_SCOPE') setOutOfScope(r.asset);
      else setUnregistered({ code: r.code });
    },
  });
  const addItem = useMutation({
    mutationFn: (assetId: string) =>
      api<Item>(`/inventories/${id}/items`, { method: 'POST', json: { assetId } }),
    onSuccess: (item) => {
      setOutOfScope(null);
      refresh();
      setChecking({ item, viaQr: true });
    },
  });
  const close = useMutation({
    mutationFn: () => api(`/inventories/${id}/close`, { method: 'POST' }),
    onSuccess: () => {
      setDialog(null);
      refresh();
    },
  });
  const reopen = useMutation({
    mutationFn: () => api(`/inventories/${id}/reopen`, { method: 'POST', json: { reason } }),
    onSuccess: () => {
      setDialog(null);
      setReason('');
      refresh();
    },
  });
  const onScan = useCallback((code: string) => scan.mutate(code), [scan]);

  if (inv.isPending) return <Loading />;
  if (inv.isError) return <ErrorState error={inv.error} onRetry={() => void inv.refetch()} />;
  const d = inv.data;
  const open = d.status === 'IN_PROGRESS';
  const manage = can(PERMISSIONS.INVENTORY_MANAGE) && open;

  return (
    <>
      <p className="muted">
        <Link to="/inventories">الجرد</Link> / <bdi dir="ltr">{d.number}</bdi>
      </p>
      <div className="page-header">
        <div>
          <h1>
            جرد <bdi dir="ltr">{d.number}</bdi>
          </h1>
          <InventoryStatusBadge status={d.status} />
          <Progress done={d.counts.checked} total={d.counts.total} />
        </div>
        <div className="row-actions" style={{ flexWrap: 'wrap' }}>
          <OfficialPdfLink
            fileId={d.officialFileId}
            label={
              d.officialVersion && d.officialVersion > 1
                ? `محضر الجرد (نسخة ${d.officialVersion})`
                : 'محضر الجرد (PDF)'
            }
          />
          {manage && (
            <button type="button" className="btn btn-primary" onClick={() => setScanning(true)}>
              مسح أصل
            </button>
          )}
          {manage && (
            <button type="button" className="btn" onClick={() => setDialog('close')}>
              إغلاق الجرد
            </button>
          )}
          {!open && can(PERMISSIONS.INVENTORY_REOPEN) && (
            <button type="button" className="btn btn-danger" onClick={() => setDialog('reopen')}>
              إعادة فتح استثنائية
            </button>
          )}
        </div>
      </div>

      <section className="card">
        <dl className="details">
          <dt>النطاق</dt>
          <dd>{d.scopes.map(scopeText).join('، ')}</dd>
          <dt>بدأه</dt>
          <dd>
            {d.createdByName ?? '—'} — {formatDateTime(d.createdAt)}
          </dd>
          {d.closedAt && (
            <>
              <dt>أغلقه</dt>
              <dd>
                {d.closedByName ?? '—'} — {formatDateTime(d.closedAt)}
              </dd>
            </>
          )}
          <dt>النتائج</dt>
          <dd>
            موجودة {d.counts.found} · غير موجودة {d.counts.notFound} · فروقات{' '}
            {d.counts.discrepancies} · غير مسجلة {d.counts.unregistered}
          </dd>
          {d.reopenings.length > 0 && (
            <>
              <dt>إعادة الفتح</dt>
              <dd>
                {d.reopenings.map((r) => (
                  <div key={r.id}>
                    {r.actorName} — {formatDateTime(r.createdAt)}: {r.reason}
                  </div>
                ))}
              </dd>
            </>
          )}
        </dl>
      </section>

      <Tabs
        tabs={[
          ['unchecked', `غير مفحوص (${d.counts.unchecked})`],
          ['checked', `مفحوص (${d.counts.checked})`],
          ['discrepancy', `فروقات (${d.counts.discrepancies})`],
          ['notFound', `غير موجود (${d.counts.notFound})`],
          ['all', `الكل (${d.counts.total})`],
          ['unregistered', `أصول غير مسجلة (${d.counts.unregistered})`],
        ]}
        active={filter}
        onChange={setFilter}
      />
      {filter === 'unregistered' ? (
        <UnregisteredList d={d} canAdd={manage} onAdd={() => setUnregistered({ code: '' })} />
      ) : (
        <ItemsTable
          key={filter}
          inventoryId={d.id}
          filter={filter}
          canCheck={manage}
          onCheck={(item) => setChecking({ item, viaQr: false })}
        />
      )}

      {scanning && (
        <Modal open title="مسح أصل" onClose={() => setScanning(false)}>
          <FormAlert error={scan.error} />
          <QrScanner onResult={onScan} busy={scan.isPending} />
        </Modal>
      )}
      {checking && (
        <CheckDialog
          inventoryId={d.id}
          item={checking.item}
          viaQr={checking.viaQr}
          onClose={() => setChecking(null)}
          onDone={refresh}
        />
      )}
      {outOfScope && (
        <ConfirmDialog
          open
          title="أصل خارج قائمة الجرد"
          message={`الأصل ${outOfScope.assetNumber} — ${outOfScope.name} مسجل لكنه غير متوقع في هذا النطاق. هل تريد إضافته إلى الجرد وتسجيل مكانه الفعلي؟`}
          confirmLabel="إضافة وفحص"
          busy={addItem.isPending}
          error={formError(addItem.error)}
          onConfirm={() => addItem.mutate(outOfScope.id)}
          onClose={() => setOutOfScope(null)}
        />
      )}
      {unregistered && (
        <UnregisteredDialog
          inventoryId={d.id}
          code={unregistered.code}
          onClose={() => setUnregistered(null)}
          onDone={refresh}
        />
      )}
      <ConfirmDialog
        open={dialog === 'close'}
        title="إغلاق الجرد"
        message={
          d.counts.unchecked > 0
            ? `لم يُفحص ${d.counts.unchecked} أصل بعد؛ لا يمكن الإغلاق قبل فحص جميع الأصول المتوقعة.`
            : `سيُطبَّق ${d.counts.discrepancies} فرق على بيانات الأصول (الموقع، القسم، المسؤول، الحالة). الأصول غير الموجودة لا تتغير حالتها. يصبح الجرد نهائيًا ويُصدر محضر رسمي.`
        }
        confirmLabel="إغلاق الجرد نهائيًا"
        busy={close.isPending}
        error={formError(close.error)}
        onConfirm={() => close.mutate()}
        onClose={() => setDialog(null)}
      />
      {dialog === 'reopen' && (
        <Modal
          open
          title="إعادة فتح الجرد (استثنائي)"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button
                type="button"
                className="btn btn-danger"
                disabled={!reason.trim() || reopen.isPending}
                onClick={() => reopen.mutate()}
              >
                إعادة الفتح
              </button>
              <button type="button" className="btn" onClick={() => setDialog(null)}>
                رجوع
              </button>
            </>
          }
        >
          <FormAlert error={reopen.error} />
          <TextField
            label="السبب *"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            autoFocus
          />
          <p className="hint">
            تُسجَّل إعادة الفتح (السبب، المستخدم، الوقت) في سجل التدقيق. عند الإغلاق مجددًا يصدر
            محضر بنسخة جديدة.
          </p>
        </Modal>
      )}
    </>
  );
}

function ItemsTable({
  inventoryId,
  filter,
  canCheck,
  onCheck,
}: {
  inventoryId: string;
  filter: Exclude<Filter, 'unregistered'>;
  canCheck: boolean;
  onCheck: (i: Item) => void;
}) {
  const { state, update, query } = useServerList<Item>(
    `/inventories/${inventoryId}/items`,
    ['filter'],
    { filters: { filter } },
  );
  const columns: Column<Item>[] = [
    // Result and the check action come first so they stay visible on phones.
    { key: 'asset', label: 'الأصل', render: (i) => <AssetLink asset={i.asset} /> },
    {
      key: 'result',
      label: 'النتيجة',
      render: (i) =>
        i.checkedAt === null ? (
          <span className="badge">لم يُفحص</span>
        ) : i.exists ? (
          <span className="chips">
            <span className={`badge ${i.hasDiscrepancy ? 'badge-warning' : 'badge-success'}`}>
              {i.hasDiscrepancy ? 'موجود بفروقات' : 'موجود'}
            </span>
            {i.confirmedByQr && <span className="badge">QR</span>}
          </span>
        ) : (
          <span className="badge badge-danger">غير موجود</span>
        ),
    },
    ...(canCheck
      ? [
          {
            key: 'action',
            label: '',
            render: (i: Item) => (
              <button type="button" className="btn btn-sm" onClick={() => onCheck(i)}>
                {i.checkedAt ? 'تعديل الفحص' : 'فحص'}
              </button>
            ),
          },
        ]
      : []),
    {
      key: 'place',
      label: 'الموقع / القسم',
      render: (i) => {
        const expected = `${i.expectedLocation.name} / ${i.expectedDepartment.name}`;
        const actual = i.actualLocation
          ? `${i.actualLocation.name} / ${i.actualDepartment?.name}`
          : null;
        return actual && actual !== expected ? (
          <>
            <s className="muted">{expected}</s> ← <strong>{actual}</strong>
          </>
        ) : (
          expected
        );
      },
    },
    {
      key: 'resp',
      label: 'المسؤول',
      render: (i) => {
        const expected = resp(i.expectedResponsibleEmployee, i.expectedResponsibleExternal);
        const actual = i.exists
          ? resp(i.actualResponsibleEmployee, i.actualResponsibleExternal)
          : null;
        return actual && actual !== expected ? (
          <>
            <s className="muted">{expected}</s> ← <strong>{actual}</strong>
          </>
        ) : (
          expected
        );
      },
    },
    {
      key: 'status',
      label: 'الحالة',
      render: (i) =>
        i.actualStatus && i.actualStatus !== i.expectedStatus ? (
          <>
            <s className="muted">{ASSET_STATUS_LABELS[i.expectedStatus]}</s> ←{' '}
            <strong>{ASSET_STATUS_LABELS[i.actualStatus]}</strong>
          </>
        ) : (
          ASSET_STATUS_LABELS[i.expectedStatus]
        ),
    },
  ];
  return (
    <>
      <div className="toolbar">
        <SearchBox
          value={state.q}
          onSearch={(q) => update({ q })}
          label="بحث برقم الأصل أو الاسم أو الرقم التسلسلي"
        />
      </div>
      <DataTable
        columns={columns}
        query={query}
        state={state}
        onChange={update}
        rowKey={(i) => i.id}
        empty="لا توجد أصول في هذا التصنيف."
      />
    </>
  );
}

function CheckDialog({
  inventoryId,
  item,
  viaQr,
  onClose,
  onDone,
}: {
  inventoryId: string;
  item: Item;
  viaQr: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const locations = useQuery({
    queryKey: ['lookups', 'locations'],
    queryFn: () => api<LocationLookup[]>('/lookups/locations'),
  });
  const [exists, setExists] = useState(item.exists ?? true);
  const [locationId, setLocationId] = useState(item.actualLocation?.id ?? item.expectedLocation.id);
  const [departmentId, setDepartmentId] = useState(
    item.actualDepartment?.id ?? item.expectedDepartment.id,
  );
  const [changeResponsible, setChangeResponsible] = useState(false);
  const [responsible, setResponsible] = useState<Responsible | null>(null);
  const [status, setStatus] = useState<AssetStatus>(item.actualStatus ?? item.expectedStatus);
  const [notes, setNotes] = useState(item.notes ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append('exists', String(exists));
      body.append('confirmedByQr', String(viaQr || item.confirmedByQr));
      body.append('notes', notes);
      if (exists) {
        body.append('actualLocationId', locationId);
        body.append('actualDepartmentId', departmentId);
        body.append('actualStatus', status);
        if (changeResponsible && responsible) {
          body.append('actualResponsibleType', responsible.type);
          if (responsible.type === 'EMPLOYEE')
            body.append('actualResponsibleEapEmployeeId', responsible.eapEmployeeId);
          else body.append('actualResponsibleExternalId', responsible.externalPersonId);
        }
      }
      if (photo) body.append('photo', photo);
      return api(`/inventories/${inventoryId}/items/${item.id}/check`, { method: 'POST', body });
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const errors = fieldErrors(save.error);
  const deps = locations.data?.find((l) => l.id === locationId)?.departments ?? [];
  const expectedResp = resp(item.expectedResponsibleEmployee, item.expectedResponsibleExternal);

  return (
    <Modal
      open
      wide
      title={`فحص ${item.asset.assetNumber} — ${item.asset.name}`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn-primary"
            disabled={save.isPending || (exists && changeResponsible && !responsible)}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'جارٍ الحفظ…' : 'حفظ الفحص'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            إلغاء
          </button>
        </>
      }
    >
      <FormAlert error={save.error} />
      {viaQr && <div className="alert alert-info">تم التعرف على الأصل بمسح رمز QR.</div>}
      <div className="toolbar" role="radiogroup" aria-label="نتيجة الفحص">
        <label className="check">
          <input type="radio" name="exists" checked={exists} onChange={() => setExists(true)} />{' '}
          موجود
        </label>
        <label className="check">
          <input type="radio" name="exists" checked={!exists} onChange={() => setExists(false)} />{' '}
          غير موجود
        </label>
      </div>
      {exists ? (
        <>
          <p className="muted">
            المتوقع: {item.expectedLocation.name} / {item.expectedDepartment.name} — {expectedResp}{' '}
            — {ASSET_STATUS_LABELS[item.expectedStatus]}
          </p>
          <div className="form-grid">
            <SelectField
              label="الموقع الفعلي"
              value={locationId}
              onChange={(e) => {
                setLocationId(e.target.value);
                setDepartmentId('');
              }}
            >
              {locations.data?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="القسم الفعلي"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              error={errors.actualDepartmentId}
            >
              <option value="">اختر…</option>
              {deps.map((dep) => (
                <option key={dep.id} value={dep.id}>
                  {dep.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="الحالة الفعلية"
              value={status}
              onChange={(e) => setStatus(e.target.value as AssetStatus)}
            >
              {CHECK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ASSET_STATUS_LABELS[s]}
                </option>
              ))}
            </SelectField>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={changeResponsible}
              onChange={(e) => setChangeResponsible(e.target.checked)}
            />{' '}
            المسؤول الفعلي مختلف عن «{expectedResp}»
          </label>
          {changeResponsible && (
            <ResponsiblePicker
              legend="المسؤول الفعلي"
              value={responsible}
              onChange={setResponsible}
              error={errors.actualResponsibleEapEmployeeId ?? errors.actualResponsibleExternalId}
            />
          )}
        </>
      ) : (
        <div className="alert alert-warning">
          يُسجَّل الأصل «غير موجود أثناء الجرد» ولا تتغير حالته تلقائيًا.
        </div>
      )}
      <TextField
        label="ملاحظات"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={1000}
      />
      <div className="field">
        <label htmlFor="check-photo">صورة (اختيارية)</label>
        <input
          id="check-photo"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic"
          capture="environment"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
        />
      </div>
    </Modal>
  );
}

function UnregisteredDialog({
  inventoryId,
  code,
  onClose,
  onDone,
}: {
  inventoryId: string;
  code: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append('description', description.trim());
      body.append('scannedCode', code);
      body.append('notes', notes);
      if (photo) body.append('photo', photo);
      return api(`/inventories/${inventoryId}/unregistered`, { method: 'POST', body });
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Modal open title="أصل غير مسجل" onClose={onClose}>
      <FormAlert error={save.error} />
      {code && (
        <div className="alert alert-warning">
          الرمز <bdi dir="ltr">{code}</bdi> لا يطابق أي أصل مسجل.
        </div>
      )}
      <p className="muted">يُسجَّل الأصل في محضر الجرد فقط، ولا يُنشأ أصل جديد تلقائيًا.</p>
      <TextField
        label="وصف الأصل *"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={500}
        autoFocus
      />
      <TextField
        label="ملاحظات"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={1000}
      />
      <div className="field">
        <label htmlFor="unreg-photo">صورة (اختيارية)</label>
        <input
          id="unreg-photo"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic"
          capture="environment"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
        />
      </div>
      <button
        type="button"
        className="btn btn-primary"
        disabled={!description.trim() || save.isPending}
        onClick={() => save.mutate()}
      >
        تسجيل
      </button>
    </Modal>
  );
}

function UnregisteredList({
  d,
  canAdd,
  onAdd,
}: {
  d: InventoryDetail;
  canAdd: boolean;
  onAdd: () => void;
}) {
  return (
    <section className="card">
      <div className="page-header">
        <h2>أصول غير مسجلة</h2>
        {canAdd && (
          <button type="button" className="btn btn-sm" onClick={onAdd}>
            تسجيل أصل غير مسجل
          </button>
        )}
      </div>
      {d.unregistered.length === 0 ? (
        <p className="muted">لم تُسجَّل أصول غير مسجلة.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>الوصف</th>
                <th>الرمز الممسوح</th>
                <th>ملاحظات</th>
                <th>سجّله</th>
                <th>صورة</th>
              </tr>
            </thead>
            <tbody>
              {d.unregistered.map((u) => (
                <tr key={u.id}>
                  <td>{u.description}</td>
                  <td>
                    <bdi dir="ltr">{u.scannedCode ?? '—'}</bdi>
                  </td>
                  <td>{u.notes ?? '—'}</td>
                  <td>
                    {u.recordedByName ?? '—'} — {formatDateTime(u.recordedAt)}
                  </td>
                  <td>
                    {u.photo ? (
                      <a href={fileUrl(u.photo.id)} target="_blank" rel="noreferrer">
                        عرض
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
