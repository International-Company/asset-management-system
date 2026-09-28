import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ASSET_STATUS_LABELS, type AssetStatus, MAINTENANCE_STATUS_LABELS, type MaintenanceStatus, PERMISSIONS, TECHNICIAN_TYPE_LABELS, type TechnicianType } from '@osooli/shared';
import { api, fileUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { type Page, useServerList } from '../../lib/list';
import { type Column, DataTable, SearchBox } from '../../components/DataTable';
import { fieldErrors, FormAlert, formError, SelectField, TextField } from '../../components/Form';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { ErrorState, Loading } from '../../components/States';
import { ResponsiblePicker } from '../assets/ResponsiblePicker';
import type { AssetDetail, CurrencyLookup, Responsible } from '../assets/types';
import { AssetLink, MaintenanceStatusBadge, OfficialPdfLink } from './shared';

const RESULTS: AssetStatus[] = ['IN_USE', 'UNUSED', 'DAMAGED', 'DISPOSED'];

interface MaintenanceRow {
  id: string;
  number: string;
  status: MaintenanceStatus;
  createdAt: string;
  cost: string | null;
  currency: string | null;
  asset: { id: string; assetNumber: string; name: string };
  technicianEmployee: { fullName: string } | null;
  provider: { name: string } | null;
}

export function MaintenanceListPage() {
  const { state, update, query } = useServerList<MaintenanceRow>('/maintenances', ['status'], { order: 'desc' });
  const columns: Column<MaintenanceRow>[] = [
    { key: 'number', label: 'رقم الطلب', render: (m) => <Link to={`/maintenances/${m.id}`}><bdi dir="ltr">{m.number}</bdi></Link> },
    { key: 'asset', label: 'الأصل', render: (m) => <AssetLink asset={m.asset} /> },
    { key: 'tech', label: 'الفني', render: (m) => m.technicianEmployee?.fullName ?? m.provider?.name ?? '—' },
    { key: 'status', label: 'الحالة', render: (m) => <MaintenanceStatusBadge status={m.status} /> },
    { key: 'cost', label: 'التكلفة', render: (m) => (m.cost ? <bdi dir="ltr">{`${m.cost} ${m.currency ?? ''}`}</bdi> : '—') },
    { key: 'created', label: 'التاريخ', render: (m) => formatDateTime(m.createdAt) },
  ];
  return (
    <>
      <div className="page-header">
        <div>
          <h1>الصيانة</h1>
          <p className="muted">يُفتح طلب الصيانة من صفحة الأصل. التكلفة قابلة للتعديل حتى «انتهاء الصيانة».</p>
        </div>
      </div>
      <div className="toolbar">
        <SearchBox value={state.q} onSearch={(q) => update({ q })} label="بحث برقم الطلب أو الأصل" />
        <SelectField label="الحالة" value={state.filters.status} onChange={(e) => update({ filters: { status: e.target.value } })}>
          <option value="">الكل</option>
          {Object.entries(MAINTENANCE_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
      </div>
      <DataTable columns={columns} query={query} state={state} onChange={update} rowKey={(m) => m.id} empty="لا توجد طلبات صيانة." />
    </>
  );
}

interface Provider {
  id: string;
  name: string;
  type: 'EXTERNAL' | 'COMPANY';
}

export function MaintenanceNewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const assetId = params.get('assetId') ?? '';
  const asset = useQuery({ queryKey: ['assets', assetId], enabled: !!assetId, queryFn: () => api<AssetDetail>(`/assets/${assetId}`) });
  const providers = useQuery({ queryKey: ['maintenance-providers', 'active'], queryFn: () => api<Page<Provider>>('/maintenance-providers?status=ACTIVE&pageSize=250') });
  const currencies = useQuery({ queryKey: ['lookups', 'currencies'], queryFn: () => api<CurrencyLookup[]>('/lookups/currencies') });
  const [type, setType] = useState<TechnicianType>('COMPANY');
  const [providerId, setProviderId] = useState('');
  const [employee, setEmployee] = useState<Responsible | null>(null);
  const [cost, setCost] = useState('');
  const [currency, setCurrency] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const create = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append('assetId', assetId);
      body.append('technicianType', type);
      if (type === 'EMPLOYEE' && employee?.type === 'EMPLOYEE') body.append('technicianEapEmployeeId', employee.eapEmployeeId);
      if (type !== 'EMPLOYEE') body.append('providerId', providerId);
      body.append('cost', cost);
      body.append('currency', currency);
      body.append('beforePhoto', photo!);
      return api<{ id: string }>('/maintenances', { method: 'POST', body });
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      navigate(`/maintenances/${res.id}`);
    },
  });
  const errors = fieldErrors(create.error);
  const techChosen = type === 'EMPLOYEE' ? employee?.type === 'EMPLOYEE' : !!providerId;
  const valid = techChosen && photo && (!cost || currency);

  if (!assetId) return <div className="card">افتح طلب الصيانة من صفحة الأصل.</div>;
  if (asset.isPending) return <Loading />;
  if (asset.isError) return <ErrorState error={asset.error} />;
  const a = asset.data;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) create.mutate();
  };
  return (
    <form onSubmit={submit} noValidate>
      <p className="muted">
        <Link to={`/assets/${a.id}`}>{a.assetNumber}</Link> / طلب صيانة
      </p>
      <h1>
        طلب صيانة: <bdi dir="ltr">{a.assetNumber}</bdi> — {a.name}
      </h1>
      <FormAlert error={create.error} />
      <section className="card">
        <SelectField
          label="نوع الفني"
          value={type}
          onChange={(e) => {
            setType(e.target.value as TechnicianType);
            setProviderId('');
          }}
        >
          {(Object.keys(TECHNICIAN_TYPE_LABELS) as TechnicianType[]).map((t) => (
            <option key={t} value={t}>
              {TECHNICIAN_TYPE_LABELS[t]}
            </option>
          ))}
        </SelectField>
        {type === 'EMPLOYEE' ? (
          <ResponsiblePicker legend="الموظف الفني *" value={employee} onChange={setEmployee} error={errors.technicianEapEmployeeId} />
        ) : (
          <SelectField label={type === 'COMPANY' ? 'الشركة *' : 'الفني الخارجي *'} value={providerId} onChange={(e) => setProviderId(e.target.value)} error={errors.providerId}>
            <option value="">اختر…</option>
            {providers.data?.items
              .filter((p) => p.type === type)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </SelectField>
        )}
        <div className="form-grid">
          <TextField label="التكلفة المتوقعة" dir="ltr" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} error={errors.cost} />
          <SelectField label="العملة" value={currency} onChange={(e) => setCurrency(e.target.value)} error={errors.currency}>
            <option value="">—</option>
            {currencies.data?.map((c) => (
              <option key={c.code} value={c.code}>
                {c.nameAr} ({c.code})
              </option>
            ))}
          </SelectField>
        </div>
        <div className="field">
          <label htmlFor="before-photo">صورة ما قبل الصيانة *</label>
          <input id="before-photo" type="file" accept="image/png,image/jpeg,image/webp,image/heic" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          {errors.beforePhoto && <span className="field-error">{errors.beforePhoto.join(' ')}</span>}
        </div>
        <button type="submit" className="btn btn-primary" disabled={!valid || create.isPending}>
          {create.isPending ? 'جارٍ الحفظ…' : 'فتح طلب الصيانة'}
        </button>
      </section>
    </form>
  );
}

interface MaintenanceDetail extends MaintenanceRow {
  technicianType: TechnicianType;
  startDate: string | null;
  endDate: string | null;
  durationDays: number | null;
  whatWasRepaired: string | null;
  statusBeforeMaintenance: AssetStatus;
  resultingStatus: AssetStatus | null;
  createdByName: string | null;
  closedAt: string | null;
  closedByName: string | null;
  beforePhoto: { id: string; originalName: string };
  afterPhoto: { id: string; originalName: string } | null;
  documents: Array<{ id: string; name: string; isOfficial: boolean; versions: Array<{ fileId: string; file: { originalName: string } }> }>;
}

export function MaintenanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const m = useQuery({ queryKey: ['maintenances', id], queryFn: () => api<MaintenanceDetail>(`/maintenances/${id}`) });
  const [dialog, setDialog] = useState<'start' | 'cost' | 'complete' | 'close' | 'document' | null>(null);
  const refresh = () => {
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: ['maintenances'] });
    void queryClient.invalidateQueries({ queryKey: ['assets'] });
  };
  const start = useMutation({ mutationFn: () => api(`/maintenances/${id}/start`, { method: 'POST', json: {} }), onSuccess: refresh });
  const close = useMutation({ mutationFn: () => api(`/maintenances/${id}/close`, { method: 'POST' }), onSuccess: refresh });

  if (m.isPending) return <Loading />;
  if (m.isError) return <ErrorState error={m.error} onRetry={() => void m.refetch()} />;
  const d = m.data;
  const manage = can(PERMISSIONS.MAINTENANCE_MANAGE) && d.status !== 'CLOSED';
  const official = d.documents.find((x) => x.isOfficial);

  return (
    <>
      <p className="muted">
        <Link to="/maintenances">الصيانة</Link> / <bdi dir="ltr">{d.number}</bdi>
      </p>
      <div className="page-header">
        <div>
          <h1>
            طلب صيانة <bdi dir="ltr">{d.number}</bdi>
          </h1>
          <MaintenanceStatusBadge status={d.status} />
        </div>
        <div className="row-actions" style={{ flexWrap: 'wrap' }}>
          <OfficialPdfLink fileId={official?.versions[0]?.fileId} label="تقرير الصيانة (PDF)" />
          {manage && d.status === 'NEW' && (
            <button type="button" className="btn btn-primary" onClick={() => setDialog('start')}>
              بدء الصيانة
            </button>
          )}
          {manage && (
            <button type="button" className="btn" onClick={() => setDialog('cost')}>
              تعديل التكلفة
            </button>
          )}
          {manage && d.status === 'IN_PROGRESS' && (
            <button type="button" className="btn btn-primary" onClick={() => setDialog('complete')}>
              إكمال الصيانة
            </button>
          )}
          {d.status === 'COMPLETED' && can(PERMISSIONS.MAINTENANCE_CLOSE) && (
            <button type="button" className="btn btn-primary" onClick={() => setDialog('close')}>
              انتهاء الصيانة
            </button>
          )}
          {manage && can(PERMISSIONS.DOCUMENTS_UPLOAD) && (
            <button type="button" className="btn" onClick={() => setDialog('document')}>
              إضافة مستند
            </button>
          )}
        </div>
      </div>
      {d.status === 'CLOSED' && <div className="alert alert-info">انتهت الصيانة. الطلب نهائي والتكلفة نهائية.</div>}

      <section className="card">
        <dl className="details">
          <dt>الأصل</dt>
          <dd>
            <AssetLink asset={d.asset} />
          </dd>
          <dt>الفني</dt>
          <dd>
            {d.technicianEmployee?.fullName ?? d.provider?.name ?? '—'} ({TECHNICIAN_TYPE_LABELS[d.technicianType]})
          </dd>
          <dt>تاريخ البدء</dt>
          <dd>{formatDateTime(d.startDate)}</dd>
          <dt>تاريخ الانتهاء</dt>
          <dd>{formatDateTime(d.endDate)}</dd>
          <dt>المدة</dt>
          <dd>{d.durationDays !== null ? `${d.durationDays} يوم` : '—'}</dd>
          <dt>التكلفة</dt>
          <dd>{d.cost ? <bdi dir="ltr">{`${d.cost} ${d.currency ?? ''}`}</bdi> : '—'}</dd>
          <dt>ما تم إصلاحه</dt>
          <dd>{d.whatWasRepaired ?? '—'}</dd>
          <dt>الحالة قبل الصيانة</dt>
          <dd>{ASSET_STATUS_LABELS[d.statusBeforeMaintenance]}</dd>
          <dt>الحالة الناتجة</dt>
          <dd>{d.resultingStatus ? ASSET_STATUS_LABELS[d.resultingStatus] : '—'}</dd>
          <dt>فتحه</dt>
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
        </dl>
      </section>

      <section className="card">
        <h2>الصور</h2>
        <div className="photo-grid">
          <figure>
            <img src={fileUrl(d.beforePhoto.id)} alt="قبل الصيانة" />
            <figcaption>قبل الصيانة</figcaption>
          </figure>
          {d.afterPhoto && (
            <figure>
              <img src={fileUrl(d.afterPhoto.id)} alt="بعد الصيانة" />
              <figcaption>بعد الصيانة</figcaption>
            </figure>
          )}
        </div>
      </section>

      {d.documents.filter((x) => !x.isOfficial).length > 0 && (
        <section className="card">
          <h2>المستندات</h2>
          <ul>
            {d.documents
              .filter((x) => !x.isOfficial)
              .map((doc) => (
                <li key={doc.id}>
                  <a href={fileUrl(doc.versions[0].fileId)} target="_blank" rel="noreferrer">
                    {doc.name}
                  </a>
                </li>
              ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={dialog === 'start'}
        title="بدء الصيانة"
        message="ستتحول حالة الأصل إلى «قيد الصيانة»."
        confirmLabel="بدء"
        busy={start.isPending}
        error={formError(start.error)}
        onConfirm={() => start.mutate()}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'close'}
        title="انتهاء الصيانة"
        message="سيصبح الطلب نهائيًا ولا يمكن تعديله، وتصبح التكلفة نهائية، ويُصدر تقرير رسمي."
        confirmLabel="تأكيد الانتهاء"
        busy={close.isPending}
        error={formError(close.error)}
        onConfirm={() => close.mutate()}
        onClose={() => setDialog(null)}
      />
      {dialog === 'cost' && <CostDialog m={d} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'complete' && <CompleteDialog m={d} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'document' && <DocumentDialog id={d.id} onClose={() => setDialog(null)} onDone={refresh} />}
    </>
  );
}

function CostDialog({ m, onClose, onDone }: { m: MaintenanceDetail; onClose: () => void; onDone: () => void }) {
  const currencies = useQuery({ queryKey: ['lookups', 'currencies'], queryFn: () => api<CurrencyLookup[]>('/lookups/currencies') });
  const [cost, setCost] = useState(m.cost ?? '');
  const [currency, setCurrency] = useState(m.currency ?? '');
  const save = useMutation({ mutationFn: () => api(`/maintenances/${m.id}`, { method: 'PATCH', json: { cost, currency } }), onSuccess: onDone });
  const errors = fieldErrors(save.error);
  return (
    <Modal open title="تعديل التكلفة" onClose={onClose}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <FormAlert error={save.error} />
        <div className="form-grid">
          <TextField label="التكلفة" dir="ltr" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} error={errors.cost} />
          <SelectField label="العملة" value={currency} onChange={(e) => setCurrency(e.target.value)} error={errors.currency}>
            <option value="">—</option>
            {currencies.data?.map((c) => (
              <option key={c.code} value={c.code}>
                {c.nameAr} ({c.code})
              </option>
            ))}
          </SelectField>
        </div>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          حفظ
        </button>
      </form>
    </Modal>
  );
}

function CompleteDialog({ m, onClose, onDone }: { m: MaintenanceDetail; onClose: () => void; onDone: () => void }) {
  const [repaired, setRepaired] = useState(m.whatWasRepaired ?? '');
  const [result, setResult] = useState<AssetStatus>('IN_USE');
  const [photo, setPhoto] = useState<File | null>(null);
  const complete = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append('whatWasRepaired', repaired.trim());
      body.append('resultingStatus', result);
      body.append('afterPhoto', photo!);
      return api(`/maintenances/${m.id}/complete`, { method: 'POST', body });
    },
    onSuccess: onDone,
  });
  const errors = fieldErrors(complete.error);
  return (
    <Modal open title="إكمال الصيانة" onClose={onClose}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          complete.mutate();
        }}
      >
        <FormAlert error={complete.error} />
        <div className="field">
          <label htmlFor="repaired">ما تم إصلاحه *</label>
          <textarea id="repaired" className="input" value={repaired} maxLength={2000} onChange={(e) => setRepaired(e.target.value)} />
          {errors.whatWasRepaired && <span className="field-error">{errors.whatWasRepaired.join(' ')}</span>}
        </div>
        <SelectField label="حالة الأصل بعد الصيانة *" value={result} onChange={(e) => setResult(e.target.value as AssetStatus)}>
          {RESULTS.map((s) => (
            <option key={s} value={s}>
              {ASSET_STATUS_LABELS[s]}
            </option>
          ))}
        </SelectField>
        <div className="field">
          <label htmlFor="after-photo">صورة ما بعد الصيانة *</label>
          <input id="after-photo" type="file" accept="image/png,image/jpeg,image/webp,image/heic" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={!repaired.trim() || !photo || complete.isPending}>
          إكمال
        </button>
      </form>
    </Modal>
  );
}

function DocumentDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append('name', name.trim());
      body.append('file', file!);
      return api(`/maintenances/${id}/documents`, { method: 'POST', body });
    },
    onSuccess: onDone,
  });
  return (
    <Modal open title="إضافة مستند للصيانة" onClose={onClose}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          upload.mutate();
        }}
      >
        <FormAlert error={upload.error} />
        <TextField label="اسم المستند" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
        <div className="field">
          <label htmlFor="mnt-doc">الملف</label>
          <input id="mnt-doc" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={!name.trim() || !file || upload.isPending}>
          رفع
        </button>
      </form>
    </Modal>
  );
}
