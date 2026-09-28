import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ASSET_STATUS_LABELS, type AssetStatus, PERMISSIONS } from '@osooli/shared';
import { api, fileUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { useServerList } from '../../lib/list';
import { type Column, DataTable, SearchBox } from '../../components/DataTable';
import { fieldErrors, FormAlert, SelectField, TextField } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { ErrorState, Loading } from '../../components/States';
import { ResponsiblePicker } from '../assets/ResponsiblePicker';
import type { AssetDetail, AssetListItem, CurrencyLookup, LocationLookup, Responsible } from '../assets/types';
import { AssetLink, AssetPicker, OfficialPdfLink, responsibleBody } from './shared';

// ── Custody returns (spec §28) ──────────────────────────────────────────

const RETURN_CONDITIONS: AssetStatus[] = ['UNUSED', 'IN_USE', 'DAMAGED'];

interface ReturnRow {
  id: string;
  number: string;
  occurredAt: string;
  _count: { items: number };
}

export function ReturnListPage() {
  const { can } = useAuth();
  const { state, update, query } = useServerList<ReturnRow>('/custody-returns', [], { order: 'desc' });
  const columns: Column<ReturnRow>[] = [
    { key: 'number', label: 'رقم المحضر', render: (r) => <Link to={`/custody-returns/${r.id}`}><bdi dir="ltr">{r.number}</bdi></Link> },
    { key: 'count', label: 'عدد الأصول', render: (r) => r._count.items },
    { key: 'at', label: 'التاريخ', render: (r) => formatDateTime(r.occurredAt) },
  ];
  return (
    <>
      <div className="page-header">
        <div>
          <h1>محاضر الإرجاع</h1>
          <p className="muted">الإرجاع نافذ فورًا، ولكل أصل مسؤول جديد يُحدد ضمن المحضر.</p>
        </div>
        {can(PERMISSIONS.CUSTODY_RETURNS_CREATE) && (
          <Link className="btn btn-primary" to="/custody-returns/new">
            محضر إرجاع جديد
          </Link>
        )}
      </div>
      <div className="toolbar">
        <SearchBox value={state.q} onSearch={(q) => update({ q })} label="بحث برقم المحضر أو رقم الأصل" />
      </div>
      <DataTable columns={columns} query={query} state={state} onChange={update} rowKey={(r) => r.id} empty="لا توجد محاضر إرجاع." />
    </>
  );
}

interface ReturnLine {
  asset: { id: string; assetNumber: string; name: string; responsible: string };
  condition: AssetStatus;
  responsible: Responsible | null;
  notes: string;
}

export function ReturnNewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [edited, setEdited] = useState<ReturnLine[] | null>(null);
  const [notes, setNotes] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);
  const preset = params.get('assetId');
  const presetAsset = useQuery({ queryKey: ['assets', preset], enabled: !!preset, queryFn: () => api<AssetDetail>(`/assets/${preset}`) });
  const p = presetAsset.data;
  const toLine = (a: { id: string; assetNumber: string; name: string }, responsible: string): ReturnLine => ({
    asset: { id: a.id, assetNumber: a.assetNumber, name: a.name, responsible },
    condition: 'UNUSED',
    responsible: null,
    notes: '',
  });
  const lines = edited ?? (p ? [toLine(p, p.responsibleEmployee?.fullName ?? p.responsibleExternal?.name ?? '—')] : []);
  const set = (i: number, patch: Partial<ReturnLine>) => setEdited(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/custody-returns', {
        method: 'POST',
        json: {
          items: lines.map((l) => ({ assetId: l.asset.id, condition: l.condition, newResponsible: responsibleBody(l.responsible!), notes: l.notes })),
          notes,
        },
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['/custody-returns'] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      navigate(`/custody-returns/${res.id}`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err = !lines.length ? 'أضف أصلًا واحدًا على الأقل.' : lines.some((l) => !l.responsible) ? 'حدد المسؤول الجديد لكل أصل.' : null;
    setClientError(err);
    if (!err) create.mutate();
  };

  return (
    <form onSubmit={submit} noValidate>
      <p className="muted">
        <Link to="/custody-returns">محاضر الإرجاع</Link> / محضر جديد
      </p>
      <h1>محضر إرجاع جديد</h1>
      <FormAlert error={create.error} />
      {clientError && (
        <div className="alert alert-error" role="alert">
          {clientError}
        </div>
      )}
      <section className="card">
        <AssetPicker
          exclude={lines.map((l) => l.asset.id)}
          onAdd={(a: AssetListItem) => setEdited([...lines, toLine(a, a.responsibleEmployee?.fullName ?? a.responsibleExternal?.name ?? '—')])}
        />
        {lines.map((l, i) => (
          <fieldset key={l.asset.id} className="group">
            <legend>
              <bdi dir="ltr">{l.asset.assetNumber}</bdi> — {l.asset.name} <span className="muted">(المسؤول الحالي: {l.asset.responsible})</span>
            </legend>
            <div className="form-grid">
              <SelectField label="الحالة عند الإرجاع" value={l.condition} onChange={(e) => set(i, { condition: e.target.value as AssetStatus })}>
                {RETURN_CONDITIONS.map((s) => (
                  <option key={s} value={s}>
                    {ASSET_STATUS_LABELS[s]}
                  </option>
                ))}
              </SelectField>
              <TextField label="ملاحظات" value={l.notes} maxLength={1000} onChange={(e) => set(i, { notes: e.target.value })} />
            </div>
            <ResponsiblePicker legend="المسؤول الجديد *" value={l.responsible} onChange={(r) => set(i, { responsible: r })} error={fieldErrors(create.error)[`items.${i}.newResponsible`]} />
            <button type="button" className="btn btn-sm" onClick={() => setEdited(lines.filter((_, j) => j !== i))}>
              إزالة الأصل
            </button>
          </fieldset>
        ))}
        <div className="field">
          <label htmlFor="return-notes">ملاحظات المحضر</label>
          <textarea id="return-notes" className="input" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <p className="hint">الإرجاع نافذ فورًا: يتغير المسؤول وتصبح حالة الأصل هي الحالة عند الإرجاع، ويُصدر مستند رسمي.</p>
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          {create.isPending ? 'جارٍ الحفظ…' : 'تسجيل الإرجاع'}
        </button>
      </section>
    </form>
  );
}

interface ReturnDetail {
  id: string;
  number: string;
  occurredAt: string;
  notes: string | null;
  actorName: string | null;
  officialFileId: string | null;
  items: Array<{
    id: string;
    conditionAtReturn: AssetStatus;
    notes: string | null;
    asset: { id: string; assetNumber: string; name: string };
    previousResponsibleEmployee: { fullName: string } | null;
    previousResponsibleExternal: { name: string } | null;
    newResponsibleEmployee: { fullName: string } | null;
    newResponsibleExternal: { name: string } | null;
  }>;
}

export function ReturnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const r = useQuery({ queryKey: ['custody-returns', id], queryFn: () => api<ReturnDetail>(`/custody-returns/${id}`) });
  if (r.isPending) return <Loading />;
  if (r.isError) return <ErrorState error={r.error} onRetry={() => void r.refetch()} />;
  const d = r.data;
  return (
    <>
      <p className="muted">
        <Link to="/custody-returns">محاضر الإرجاع</Link> / <bdi dir="ltr">{d.number}</bdi>
      </p>
      <div className="page-header">
        <h1>
          محضر إرجاع <bdi dir="ltr">{d.number}</bdi>
        </h1>
        <OfficialPdfLink fileId={d.officialFileId} />
      </div>
      <section className="card">
        <dl className="details">
          <dt>التاريخ</dt>
          <dd>{formatDateTime(d.occurredAt)}</dd>
          <dt>نفّذه</dt>
          <dd>{d.actorName ?? '—'}</dd>
          <dt>ملاحظات</dt>
          <dd>{d.notes ?? '—'}</dd>
        </dl>
      </section>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>الأصل</th>
              <th>المسؤول السابق</th>
              <th>المسؤول الجديد</th>
              <th>الحالة عند الإرجاع</th>
              <th>ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {d.items.map((i) => (
              <tr key={i.id}>
                <td>
                  <AssetLink asset={i.asset} />
                </td>
                <td>{i.previousResponsibleEmployee?.fullName ?? i.previousResponsibleExternal?.name ?? '—'}</td>
                <td>{i.newResponsibleEmployee?.fullName ?? i.newResponsibleExternal?.name ?? '—'}</td>
                <td>{ASSET_STATUS_LABELS[i.conditionAtReturn]}</td>
                <td>{i.notes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Transfers (spec §23) ────────────────────────────────────────────────

interface TransferRow {
  id: string;
  number: string;
  occurredAt: string;
  notes: string | null;
  actorName: string | null;
  asset: { id: string; assetNumber: string; name: string };
  fromLocation: { name: string };
  fromDepartment: { name: string };
  toLocation: { name: string };
  toDepartment: { name: string };
}

export function TransferListPage() {
  const { state, update, query } = useServerList<TransferRow>('/transfers', [], { order: 'desc' });
  const columns: Column<TransferRow>[] = [
    { key: 'number', label: 'رقم العملية', render: (t) => <bdi dir="ltr">{t.number}</bdi> },
    { key: 'asset', label: 'الأصل', render: (t) => <AssetLink asset={t.asset} /> },
    { key: 'from', label: 'من', render: (t) => `${t.fromLocation.name} / ${t.fromDepartment.name}` },
    { key: 'to', label: 'إلى', render: (t) => `${t.toLocation.name} / ${t.toDepartment.name}` },
    { key: 'by', label: 'بواسطة', render: (t) => t.actorName ?? '—' },
    { key: 'at', label: 'التاريخ', render: (t) => formatDateTime(t.occurredAt) },
    { key: 'notes', label: 'ملاحظات', render: (t) => t.notes ?? '—' },
  ];
  return (
    <>
      <div className="page-header">
        <div>
          <h1>عمليات النقل</h1>
          <p className="muted">النقل يغيّر الموقع والقسم فقط، ولا يغيّر المسؤول. يُنفذ من صفحة الأصل.</p>
        </div>
      </div>
      <div className="toolbar">
        <SearchBox value={state.q} onSearch={(q) => update({ q })} label="بحث برقم العملية أو الأصل" />
      </div>
      <DataTable columns={columns} query={query} state={state} onChange={update} rowKey={(t) => t.id} empty="لا توجد عمليات نقل." />
    </>
  );
}

export function TransferDialog({ asset, onClose, onDone }: { asset: AssetDetail; onClose: () => void; onDone: () => void }) {
  const locations = useQuery({ queryKey: ['lookups', 'locations'], queryFn: () => api<LocationLookup[]>('/lookups/locations') });
  const [locationId, setLocationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [notes, setNotes] = useState('');
  const transfer = useMutation({
    mutationFn: () => api<{ number: string }>('/transfers', { method: 'POST', json: { assetId: asset.id, toLocationId: locationId, toDepartmentId: departmentId, notes } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const deps = locations.data?.find((l) => l.id === locationId)?.departments ?? [];
  const errors = fieldErrors(transfer.error);
  return (
    <Modal
      open
      title={`نقل الأصل ${asset.assetNumber}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={!departmentId || transfer.isPending} onClick={() => transfer.mutate()}>
            {transfer.isPending ? 'جارٍ النقل…' : 'تنفيذ النقل'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            إلغاء
          </button>
        </>
      }
    >
      <FormAlert error={transfer.error} />
      <p>
        الحالي: {asset.locationDepartment.location.name} / {asset.locationDepartment.department.name}
      </p>
      <div className="form-grid">
        <SelectField
          label="الموقع الجديد"
          value={locationId}
          onChange={(e) => {
            setLocationId(e.target.value);
            setDepartmentId('');
          }}
        >
          <option value="">اختر…</option>
          {locations.data?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="القسم الجديد" value={departmentId} disabled={!locationId} onChange={(e) => setDepartmentId(e.target.value)} error={errors.toDepartmentId}>
          <option value="">اختر…</option>
          {deps.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField label="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
      <p className="hint">لا يتغير المسؤول عن الأصل. النقل مباشر ولا يحتاج موافقة.</p>
    </Modal>
  );
}

// ── Sales (spec §30) ────────────────────────────────────────────────────

interface SaleRow {
  id: string;
  number: string;
  saleDate: string;
  saleValue: string;
  currency: string;
  buyerName: string;
  asset: { id: string; assetNumber: string; name: string };
}

export function SaleListPage() {
  const { state, update, query } = useServerList<SaleRow>('/sales', [], { order: 'desc' });
  const columns: Column<SaleRow>[] = [
    { key: 'number', label: 'رقم العملية', render: (s) => <Link to={`/sales/${s.id}`}><bdi dir="ltr">{s.number}</bdi></Link> },
    { key: 'asset', label: 'الأصل', render: (s) => <AssetLink asset={s.asset} /> },
    { key: 'buyer', label: 'المشتري', render: (s) => s.buyerName },
    { key: 'value', label: 'القيمة', render: (s) => <bdi dir="ltr">{`${s.saleValue} ${s.currency}`}</bdi> },
    { key: 'date', label: 'تاريخ البيع', render: (s) => s.saleDate.slice(0, 10) },
  ];
  return (
    <>
      <div className="page-header">
        <div>
          <h1>المبيعات</h1>
          <p className="muted">البيع نهائي. يُنفذ من صفحة الأصل.</p>
        </div>
      </div>
      <div className="toolbar">
        <SearchBox value={state.q} onSearch={(q) => update({ q })} label="بحث برقم العملية أو المشتري أو الرقم المرجعي" />
      </div>
      <DataTable columns={columns} query={query} state={state} onChange={update} rowKey={(s) => s.id} empty="لا توجد مبيعات." />
    </>
  );
}

const BUYER_TYPES = ['فرد', 'شركة', 'جهة حكومية', 'أخرى'];

export function SaleNewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const assetId = params.get('assetId') ?? '';
  const asset = useQuery({ queryKey: ['assets', assetId], enabled: !!assetId, queryFn: () => api<AssetDetail>(`/assets/${assetId}`) });
  const currencies = useQuery({ queryKey: ['lookups', 'currencies'], queryFn: () => api<CurrencyLookup[]>('/lookups/currencies') });
  const [form, setForm] = useState({ saleDate: new Date().toISOString().slice(0, 10), saleValue: '', currency: '', buyerName: '', buyerType: 'فرد', referenceNumber: '', notes: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const sell = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append('assetId', assetId);
      for (const [k, v] of Object.entries(form)) body.append(k, v);
      files.forEach((f) => body.append('files', f));
      return api<{ id: string }>('/sales', { method: 'POST', body });
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['/sales'] });
      navigate(`/sales/${res.id}`);
    },
  });
  const errors = fieldErrors(sell.error);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = /^\d{1,16}(\.\d{1,2})?$/.test(form.saleValue) && form.currency && form.buyerName.trim() && form.saleDate;

  if (!assetId) return <div className="card">اختر الأصل من صفحته ثم اضغط «بيع».</div>;
  if (asset.isPending) return <Loading />;
  if (asset.isError) return <ErrorState error={asset.error} />;
  const a = asset.data;
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) setReviewing(true);
      }}
    >
      <p className="muted">
        <Link to={`/assets/${a.id}`}>{a.assetNumber}</Link> / بيع
      </p>
      <h1>
        بيع الأصل <bdi dir="ltr">{a.assetNumber}</bdi> — {a.name}
      </h1>
      <FormAlert error={sell.error} />
      <section className="card">
        <div className="form-grid">
          <TextField label="تاريخ البيع *" type="date" value={form.saleDate} onChange={set('saleDate')} error={errors.saleDate} />
          <TextField label="قيمة البيع *" dir="ltr" inputMode="decimal" value={form.saleValue} onChange={set('saleValue')} error={errors.saleValue} />
          <SelectField label="العملة *" value={form.currency} onChange={set('currency')} error={errors.currency}>
            <option value="">اختر…</option>
            {currencies.data?.map((c) => (
              <option key={c.code} value={c.code}>
                {c.nameAr} ({c.code})
              </option>
            ))}
          </SelectField>
          <TextField label="اسم المشتري *" value={form.buyerName} onChange={set('buyerName')} maxLength={200} error={errors.buyerName} />
          <SelectField label="نوع المشتري *" value={form.buyerType} onChange={set('buyerType')}>
            {BUYER_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </SelectField>
          <TextField label="الرقم المرجعي" dir="ltr" value={form.referenceNumber} onChange={set('referenceNumber')} maxLength={100} />
        </div>
        <div className="field">
          <label htmlFor="sale-notes">ملاحظات</label>
          <textarea id="sale-notes" className="input" value={form.notes} maxLength={2000} onChange={set('notes')} />
        </div>
        <div className="field">
          <label htmlFor="sale-files">مستندات وصور (اختيارية)</label>
          <input id="sale-files" type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        </div>
        <button type="submit" className="btn btn-danger" disabled={!valid || sell.isPending}>
          مراجعة البيع
        </button>
      </section>
      {reviewing && (
        <Modal
          open
          title="تأكيد البيع النهائي"
          onClose={() => setReviewing(false)}
          footer={
            <>
              <button
                type="button"
                className="btn btn-danger"
                disabled={sell.isPending}
                onClick={() => {
                  setReviewing(false);
                  sell.mutate();
                }}
              >
                {sell.isPending ? 'جارٍ التنفيذ…' : 'تأكيد البيع'}
              </button>
              <button type="button" className="btn" onClick={() => setReviewing(false)}>
                رجوع
              </button>
            </>
          }
        >
          <p>
            بيع <bdi dir="ltr">{a.assetNumber}</bdi> إلى {form.buyerName} بقيمة <bdi dir="ltr">{`${form.saleValue} ${form.currency}`}</bdi>.
          </p>
          <div className="alert alert-warning">البيع نهائي ولا يمكن تعديله. بعده لا يمكن نقل الأصل أو تسليمه أو صيانته.</div>
        </Modal>
      )}
    </form>
  );
}

interface SaleDetail extends SaleRow {
  buyerType: string;
  referenceNumber: string | null;
  notes: string | null;
  statusBeforeSale: AssetStatus;
  createdAt: string;
  actorName: string | null;
  documents: Array<{ id: string; name: string; isOfficial: boolean; versions: Array<{ fileId: string; file: { originalName: string } }> }>;
}

export function SaleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const sale = useQuery({ queryKey: ['sales', id], queryFn: () => api<SaleDetail>(`/sales/${id}`) });
  if (sale.isPending) return <Loading />;
  if (sale.isError) return <ErrorState error={sale.error} onRetry={() => void sale.refetch()} />;
  const s = sale.data;
  const official = s.documents.find((d) => d.isOfficial);
  const attachments = s.documents.filter((d) => !d.isOfficial);
  return (
    <>
      <p className="muted">
        <Link to="/sales">المبيعات</Link> / <bdi dir="ltr">{s.number}</bdi>
      </p>
      <div className="page-header">
        <h1>
          عملية بيع <bdi dir="ltr">{s.number}</bdi>
        </h1>
        <OfficialPdfLink fileId={official?.versions[0]?.fileId} />
      </div>
      <section className="card">
        <dl className="details">
          <dt>الأصل</dt>
          <dd>
            <AssetLink asset={s.asset} />
          </dd>
          <dt>تاريخ البيع</dt>
          <dd>{s.saleDate.slice(0, 10)}</dd>
          <dt>القيمة</dt>
          <dd>
            <bdi dir="ltr">{`${s.saleValue} ${s.currency}`}</bdi>
          </dd>
          <dt>المشتري</dt>
          <dd>
            {s.buyerName} ({s.buyerType})
          </dd>
          <dt>الرقم المرجعي</dt>
          <dd>{s.referenceNumber ?? '—'}</dd>
          <dt>الحالة قبل البيع</dt>
          <dd>{ASSET_STATUS_LABELS[s.statusBeforeSale]}</dd>
          <dt>سجّله</dt>
          <dd>
            {s.actorName ?? '—'} — {formatDateTime(s.createdAt)}
          </dd>
          <dt>ملاحظات</dt>
          <dd>{s.notes ?? '—'}</dd>
        </dl>
      </section>
      <section className="card">
        <h2>المرفقات</h2>
        {attachments.length === 0 ? (
          <p className="muted">لا توجد مرفقات.</p>
        ) : (
          <ul>
            {attachments.map((d) => (
              <li key={d.id}>
                <a href={fileUrl(d.versions[0].fileId)} target="_blank" rel="noreferrer">
                  {d.versions[0].file.originalName}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
