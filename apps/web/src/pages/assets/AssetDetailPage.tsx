import { FormEvent, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MAIN_CATEGORY_LABELS, PERMISSIONS } from '@osooli/shared';
import { api, ApiError, fileUrl, openFile } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime, isolate } from '../../lib/format';
import { ASSET_EVENT_LABELS, ASSET_FIELD_LABELS } from '../../lib/labels';
import { Tabs } from '../../components/DataTable';
import { fieldErrors, FormAlert, formError, SelectField, TextField } from '../../components/Form';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { Empty, ErrorState, Loading } from '../../components/States';
import { StatusPill } from './AssetsListPage';
import type { AssetDetail, CategoryLookup } from './types';
import { TransferDialog } from '../operations/ReturnTransferSalePages';
import { OfficialPdfLink } from '../operations/shared';

type Tab = 'details' | 'photos' | 'documents' | 'history' | 'numbers';

const fmtDate = (v: string | null) => (v ? v.slice(0, 10) : '—');
const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

export function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tab = (params.get('tab') as Tab | null) ?? 'details';
  const asset = useQuery({ queryKey: ['assets', id], queryFn: () => api<AssetDetail>(`/assets/${id}`) });
  const [dialog, setDialog] = useState<'category' | 'serial' | 'delete' | 'transfer' | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => api(`/assets/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['/assets'] });
      navigate('/assets', { replace: true });
    },
  });

  if (asset.isPending) return <Loading />;
  if (asset.isError) {
    if (asset.error instanceof ApiError && asset.error.status === 404) {
      return (
        <div className="card">
          <h1>الأصل غير موجود</h1>
          <p className="muted">ربما حُذف هذا الأصل أو أن الرابط غير صحيح.</p>
          <Link to="/assets">العودة إلى الأصول</Link>
        </div>
      );
    }
    return <ErrorState error={asset.error} onRetry={() => void asset.refetch()} />;
  }
  const a = asset.data;
  const sold = a.status === 'SOLD';
  const mainPhoto = a.photos.find((p) => p.isMain);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['assets', id] });
    void queryClient.invalidateQueries({ queryKey: ['/assets'] });
  };

  const printLabel = async () => {
    setPrintError(null);
    try {
      await openFile('/qr/labels', { assetIds: [a.id], perPage: 1 });
    } catch (e) {
      setPrintError(e instanceof ApiError ? e.message : 'تعذرت الطباعة.');
    }
  };

  return (
    <>
      <p className="muted">
        <Link to="/assets">الأصول</Link> / <bdi dir="ltr">{a.assetNumber}</bdi>
      </p>
      {sold && (
        <div className="banner-sold" role="status">
          تم بيع هذا الأصل{a.sale ? ` (${a.sale.number} بتاريخ ${fmtDate(a.sale.saleDate)})` : ''}. السجل محفوظ تاريخيًا ولا يمكن تنفيذ عمليات عليه.
        </div>
      )}
      {a.responsibleEmployee && !a.responsibleEmployee.isActive && (
        <div className="alert alert-warning" role="status">
          المسؤول الحالي ({a.responsibleEmployee.fullName}) أصبح غير فعّال في EAP. يجب نقل العهدة إلى مسؤول آخر.
        </div>
      )}

      <div className="card asset-head">
        <div>
          <h1>
            <bdi dir="ltr">{a.assetNumber}</bdi> — {a.name}
          </h1>
          <p className="chips">
            <StatusPill status={a.status} />
            <span className="badge">
              {MAIN_CATEGORY_LABELS[a.mainCategory]} / {a.subcategory.name}
            </span>
          </p>
          <div className="row-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
            {can(PERMISSIONS.ASSETS_EDIT) && !sold && (
              <Link className="btn btn-sm" to={`/assets/${a.id}/edit`}>
                تعديل البيانات
              </Link>
            )}
            {can(PERMISSIONS.ASSETS_CHANGE_CATEGORY) && !sold && (
              <button type="button" className="btn btn-sm" onClick={() => setDialog('category')}>
                تغيير الفئة
              </button>
            )}
            {can(PERMISSIONS.ASSETS_EDIT_SERIAL) && !sold && (
              <button type="button" className="btn btn-sm" onClick={() => setDialog('serial')}>
                تعديل الرقم التسلسلي
              </button>
            )}
            {can(PERMISSIONS.TRANSFERS_CREATE) && !sold && (
              <button type="button" className="btn btn-sm" onClick={() => setDialog('transfer')}>
                نقل
              </button>
            )}
            {can(PERMISSIONS.CUSTODY_CREATE) && !sold && (
              <Link className="btn btn-sm" to={`/custodies/new?assetId=${a.id}`}>
                تسليم عهدة
              </Link>
            )}
            {can(PERMISSIONS.CUSTODY_RETURNS_CREATE) && !sold && (
              <Link className="btn btn-sm" to={`/custody-returns/new?assetId=${a.id}`}>
                إرجاع عهدة
              </Link>
            )}
            {can(PERMISSIONS.MAINTENANCE_MANAGE) && !sold && (
              <Link className="btn btn-sm" to={`/maintenances/new?assetId=${a.id}`}>
                صيانة
              </Link>
            )}
            {can(PERMISSIONS.SALES_CREATE) && !sold && (
              <Link className="btn btn-sm btn-danger" to={`/sales/new?assetId=${a.id}`}>
                بيع
              </Link>
            )}
            {can(PERMISSIONS.QR_PRINT) && (
              <button type="button" className="btn btn-sm" onClick={() => void printLabel()}>
                طباعة ملصق QR
              </button>
            )}
            {can(PERMISSIONS.ASSETS_DELETE) && a.canDelete && (
              <button type="button" className="btn btn-sm btn-danger" onClick={() => setDialog('delete')}>
                حذف
              </button>
            )}
          </div>
          {printError && (
            <div className="alert alert-error" role="alert" style={{ marginBlockStart: '0.75rem' }}>
              {printError}
            </div>
          )}
        </div>
        <div className="asset-media">
          {mainPhoto ? <img src={fileUrl(mainPhoto.file.id)} alt="الصورة الرئيسية" /> : <div className="placeholder">لا توجد صورة</div>}
          <img className="qr" src={`/api/v1/assets/${a.id}/qr.svg`} alt={`رمز QR للأصل ${a.assetNumber}`} />
        </div>
      </div>

      <Tabs
        tabs={[
          ['details', 'البيانات'],
          ['photos', `الصور (${a.photos.length})`],
          ['documents', 'المستندات'],
          ['history', 'السجل التاريخي'],
          ['numbers', 'الأرقام السابقة'],
        ]}
        active={tab}
        onChange={(t) => setParams(t === 'details' ? {} : { tab: t }, { replace: true })}
      />

      {tab === 'details' && (
        <>
          <CurrentCustody assetId={a.id} />
          <DetailsTab a={a} />
        </>
      )}
      {tab === 'photos' && <PhotosTab a={a} readOnly={sold} onChange={refresh} />}
      {tab === 'documents' && <DocumentsTab assetId={a.id} readOnly={sold} />}
      {tab === 'history' && <HistoryTab assetId={a.id} />}
      {tab === 'numbers' && <NumbersTab a={a} />}

      {dialog === 'category' && <CategoryDialog a={a} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'serial' && <SerialDialog a={a} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'transfer' && <TransferDialog asset={a} onClose={() => setDialog(null)} onDone={refresh} />}
      <ConfirmDialog
        open={dialog === 'delete'}
        title="حذف الأصل"
        message={`حذف الأصل ${a.assetNumber} نهائيًا؟ يُسمح بذلك فقط لأصل لا تاريخ له. يبقى الحذف مسجلًا في سجل التدقيق، ولا يُعاد استخدام رقمه.`}
        confirmLabel="حذف"
        danger
        busy={remove.isPending}
        error={formError(remove.error)}
        onConfirm={() => remove.mutate()}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

function DetailsTab({ a }: { a: AssetDetail }) {
  const responsible = a.responsibleEmployee
    ? `${a.responsibleEmployee.fullName} (موظف${a.responsibleEmployee.jobTitle ? ` — ${a.responsibleEmployee.jobTitle}` : ''})`
    : a.responsibleExternal
      ? `${a.responsibleExternal.name} (شخص خارجي${a.responsibleExternal.organization ? ` — ${a.responsibleExternal.organization}` : ''})`
      : '—';
  return (
    <>
      <section className="card">
        <h2>البيانات الأساسية</h2>
        <dl className="details">
          <dt>الرقم التسلسلي</dt>
          <dd>
            <bdi dir="ltr">{a.serialNumber}</bdi> {a.serialIsInternal && <span className="badge">رقم داخلي</span>}
          </dd>
          <dt>الموقع</dt>
          <dd>{a.locationDepartment.location.name}</dd>
          <dt>القسم</dt>
          <dd>{a.locationDepartment.department.name}</dd>
          <dt>المسؤول</dt>
          <dd>{responsible}</dd>
          <dt>ملاحظات</dt>
          <dd>{dash(a.notes)}</dd>
          <dt>تاريخ الإنشاء</dt>
          <dd>{formatDateTime(a.createdAt)}</dd>
          <dt>آخر تحديث</dt>
          <dd>{formatDateTime(a.updatedAt)}</dd>
        </dl>
        <p className="hint">الموقع والقسم يتغيران بعملية نقل، والمسؤول بمحضر عهدة، والحالة بالعمليات فقط.</p>
      </section>

      {a.mainCategory === 'TEC' && a.technical && (
        <section className="card">
          <h2>البيانات التقنية</h2>
          <dl className="details">
            {(['manufacturer', 'model', 'macAddress', 'ipAddress', 'operatingSystem', 'specifications'] as const).map((k) => (
              <Detail key={k} label={ASSET_FIELD_LABELS[`technical.${k}`]} value={a.technical![k]} ltr={k === 'macAddress' || k === 'ipAddress'} />
            ))}
          </dl>
        </section>
      )}

      {a.mainCategory === 'REA' && a.realEstate && (
        <section className="card">
          <h2>البيانات العقارية</h2>
          <dl className="details">
            {(['propertyType', 'propertyName', 'locationText', 'area', 'propertyNumber', 'parcelNumber', 'ownershipDeed', 'ownershipDate', 'ownershipNotes'] as const).map((k) => (
              <Detail key={k} label={ASSET_FIELD_LABELS[`realEstate.${k}`]} value={k === 'ownershipDate' ? fmtDate(a.realEstate![k]) : a.realEstate![k]} />
            ))}
          </dl>
        </section>
      )}

      <section className="card">
        <h2>الشراء والضمان</h2>
        <dl className="details">
          <Detail label="تاريخ الشراء" value={fmtDate(a.purchaseDate)} />
          <Detail label="المورد" value={a.supplier} />
          <Detail label="رقم الفاتورة" value={a.invoiceNumber} ltr />
          <Detail label="قيمة الشراء" value={a.purchaseValue ? `${a.purchaseValue} ${a.purchaseCurrency ?? ''}` : null} ltr />
          <Detail label="الضمان" value={a.warrantyExists ? `يوجد — ينتهي ${fmtDate(a.warrantyExpiresAt)}` : 'لا يوجد'} />
          {a.warrantyExists && <Detail label="تفاصيل الضمان" value={a.warrantyDetails} />}
        </dl>
      </section>
    </>
  );
}

function Detail({ label, value, ltr }: { label: string; value: unknown; ltr?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{ltr && value ? <bdi dir="ltr">{dash(value)}</bdi> : dash(value)}</dd>
    </>
  );
}

function PhotosTab({ a, readOnly, onChange }: { a: AssetDetail; readOnly: boolean; onChange: () => void }) {
  const { can } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api(`/assets/${a.id}/photos`, { method: 'POST', body });
    },
    onSuccess: onChange,
  });
  const setMain = useMutation({ mutationFn: (photoId: string) => api(`/assets/${a.id}/photos/${photoId}/main`, { method: 'POST' }), onSuccess: onChange });
  const remove = useMutation({
    mutationFn: (photoId: string) => api(`/assets/${a.id}/photos/${photoId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setRemoving(null);
      onChange();
    },
  });
  const canEdit = can(PERMISSIONS.ASSETS_EDIT) && !readOnly;

  return (
    <section className="card">
      <div className="page-header">
        <h2>الصور</h2>
        {canEdit && (
          <>
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heic"
              capture="environment"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                e.target.value = '';
              }}
            />
            <button type="button" className="btn btn-primary btn-sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
              {upload.isPending ? 'جارٍ الرفع…' : 'إضافة صورة'}
            </button>
          </>
        )}
      </div>
      <FormAlert error={upload.error ?? setMain.error} />
      {a.photos.length === 0 ? (
        <Empty>لا توجد صور لهذا الأصل.</Empty>
      ) : (
        <div className="photo-grid">
          {a.photos.map((p) => (
            <figure key={p.id}>
              <img src={fileUrl(p.file.id)} alt={p.file.originalName} loading="lazy" />
              <figcaption>
                {p.isMain ? (
                  <span className="badge badge-success">الرئيسية</span>
                ) : (
                  canEdit && (
                    <button type="button" className="btn btn-sm" onClick={() => setMain.mutate(p.id)}>
                      جعلها الرئيسية
                    </button>
                  )
                )}
                {can(PERMISSIONS.ASSETS_PHOTOS_DELETE) && !readOnly && (
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => setRemoving(p.id)}>
                    حذف
                  </button>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!removing}
        title="حذف صورة"
        message="تُزال الصورة من الأصل ويُسجَّل الحذف في التاريخ وسجل التدقيق."
        confirmLabel="حذف"
        danger
        busy={remove.isPending}
        error={formError(remove.error)}
        onConfirm={() => removing && remove.mutate(removing)}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}

interface Doc {
  id: string;
  name: string;
  isOfficial: boolean;
  createdAt: string;
  createdByName: string | null;
  versions: Array<{
    id: string;
    version: number;
    isCurrent: boolean;
    createdAt: string;
    uploadedByName: string | null;
    file: { id: string; originalName: string; sizeBytes: string };
  }>;
}

function DocumentsTab({ assetId, readOnly }: { assetId: string; readOnly: boolean }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const docs = useQuery({ queryKey: ['assets', assetId, 'documents'], queryFn: () => api<Doc[]>(`/assets/${assetId}/documents`), enabled: can(PERMISSIONS.DOCUMENTS_VIEW) });
  const [adding, setAdding] = useState(false);
  const [replacing, setReplacing] = useState<Doc | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['assets', assetId] });
  };
  const canUpload = can(PERMISSIONS.DOCUMENTS_UPLOAD) && !readOnly;

  if (!can(PERMISSIONS.DOCUMENTS_VIEW)) return <div className="card">ليست لديك صلاحية عرض المستندات.</div>;
  return (
    <section className="card">
      <div className="page-header">
        <h2>المستندات</h2>
        {canUpload && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            إضافة مستند
          </button>
        )}
      </div>
      {docs.isPending ? (
        <Loading />
      ) : docs.isError ? (
        <ErrorState error={docs.error} onRetry={() => void docs.refetch()} />
      ) : docs.data.length === 0 ? (
        <Empty>لا توجد مستندات.</Empty>
      ) : (
        docs.data.map((d) => (
          <fieldset key={d.id} className="group">
            <legend>
              {d.name} {d.isOfficial && <span className="badge">رسمي</span>}
            </legend>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>النسخة</th>
                    <th>الملف</th>
                    <th>رفعه</th>
                    <th>التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {d.versions.map((v) => (
                    <tr key={v.id}>
                      <td>
                        v{v.version} {v.isCurrent && <span className="badge badge-success">الحالية</span>}
                      </td>
                      <td>
                        <a href={fileUrl(v.file.id)} target="_blank" rel="noreferrer">
                          {v.file.originalName}
                        </a>{' '}
                        <span className="muted">({Math.max(1, Math.round(Number(v.file.sizeBytes) / 1024))} ك.ب)</span>
                      </td>
                      <td>{v.uploadedByName ?? '—'}</td>
                      <td>{formatDateTime(v.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canUpload && !d.isOfficial && (
              <p style={{ marginBlockStart: '0.5rem' }}>
                <button type="button" className="btn btn-sm" onClick={() => setReplacing(d)}>
                  رفع نسخة جديدة
                </button>
              </p>
            )}
          </fieldset>
        ))
      )}
      {adding && <UploadDialog title="إضافة مستند" withName path={`/assets/${assetId}/documents`} onClose={() => setAdding(false)} onDone={refresh} />}
      {replacing && (
        <UploadDialog
          title={`نسخة جديدة: ${replacing.name}`}
          path={`/documents/${replacing.id}/versions`}
          onClose={() => setReplacing(null)}
          onDone={refresh}
          note="تبقى النسخ السابقة محفوظة ومتاحة."
        />
      )}
    </section>
  );
}

function UploadDialog({ title, path, withName, note, onClose, onDone }: { title: string; path: string; withName?: boolean; note?: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData();
      if (withName) body.append('name', name.trim());
      body.append('file', file!);
      return api(path, { method: 'POST', body });
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    upload.mutate();
  };
  return (
    <Modal open title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <FormAlert error={upload.error} />
        {withName && <TextField label="اسم المستند" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} error={fieldErrors(upload.error).name} autoFocus />}
        <div className="field">
          <label htmlFor="upload-file">الملف</label>
          <input id="upload-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span className="hint">الأنواع والحجم المسموح بهما تحددهما إعدادات النظام.</span>
        </div>
        {note && <p className="hint">{note}</p>}
        <button type="submit" className="btn btn-primary" disabled={upload.isPending || !file || (withName && !name.trim())}>
          {upload.isPending ? 'جارٍ الرفع…' : 'رفع'}
        </button>
      </form>
    </Modal>
  );
}

interface AssetEvent {
  id: string;
  type: string;
  actorName: string | null;
  occurredAt: string;
  summary: Record<string, unknown>;
}

function eventSummary(e: AssetEvent): string {
  const s = e.summary ?? {};
  switch (e.type) {
    case 'CREATED':
      return `رقم الأصل ${String(s.assetNumber ?? '')}${s.serialGenerated ? ' — رقم تسلسلي داخلي' : ''}`;
    case 'CATEGORY_CHANGED':
      return `${isolate(s.fromNumber)} ← ${isolate(s.toNumber)} (${isolate(s.fromSubcategory)} ← ${isolate(s.toSubcategory)})${s.reason ? ` — ${String(s.reason)}` : ''}`;
    case 'SERIAL_CHANGED':
      return `${isolate(s.from)} ← ${isolate(s.to)}${s.reason ? ` — ${String(s.reason)}` : ''}`;
    case 'UPDATED': {
      const changes = (s.changes ?? {}) as Record<string, { old: unknown; new: unknown }>;
      return Object.entries(changes)
        .map(([k, v]) => `${ASSET_FIELD_LABELS[k] ?? k}: ${isolate(dash(v.old))} ← ${isolate(dash(v.new))}`)
        .join('، ');
    }
    case 'DOCUMENT_ADDED':
    case 'DOCUMENT_REPLACED':
      return `${String(s.name ?? '')}${s.version ? ` (v${String(s.version)})` : ''}`;
    case 'PHOTO_ADDED':
    case 'PHOTO_REMOVED':
      return String(s.fileName ?? '');
    default:
      return '';
  }
}

function HistoryTab({ assetId }: { assetId: string }) {
  const events = useQuery({ queryKey: ['assets', assetId, 'history'], queryFn: () => api<AssetEvent[]>(`/assets/${assetId}/history`) });
  if (events.isPending) return <Loading />;
  if (events.isError) return <ErrorState error={events.error} onRetry={() => void events.refetch()} />;
  return (
    <section className="card">
      <h2>السجل التاريخي</h2>
      {events.data.length === 0 ? (
        <Empty>لا توجد أحداث.</Empty>
      ) : (
        <ol className="timeline">
          {events.data.map((e) => (
            <li key={e.id}>
              <strong>{ASSET_EVENT_LABELS[e.type] ?? e.type}</strong>
              <div className="when">
                {formatDateTime(e.occurredAt)} — {e.actorName ?? 'النظام'}
              </div>
              {eventSummary(e) && <div>{eventSummary(e)}</div>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function NumbersTab({ a }: { a: AssetDetail }) {
  return (
    <>
      <section className="card">
        <h2>أرقام الأصل</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>الرقم</th>
                <th>الفئة</th>
                <th>من</th>
                <th>إلى</th>
                <th>السبب</th>
              </tr>
            </thead>
            <tbody>
              {a.numberHistory.map((h) => (
                <tr key={h.id}>
                  <td>
                    <bdi dir="ltr">{h.assetNumber}</bdi> {!h.retiredAt && <span className="badge badge-success">الحالي</span>}
                  </td>
                  <td>{MAIN_CATEGORY_LABELS[h.mainCategory]}</td>
                  <td>{formatDateTime(h.assignedAt)}</td>
                  <td>{formatDateTime(h.retiredAt)}</td>
                  <td>{dash(h.reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h2>تاريخ الرقم التسلسلي</h2>
        {a.serialHistory.length === 0 ? (
          <Empty>لم يتغير الرقم التسلسلي.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>القديم</th>
                  <th>الجديد</th>
                  <th>السبب</th>
                  <th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {a.serialHistory.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <bdi dir="ltr">{h.oldSerial}</bdi>
                    </td>
                    <td>
                      <bdi dir="ltr">{h.newSerial}</bdi>
                    </td>
                    <td>{dash(h.reason)}</td>
                    <td>{formatDateTime(h.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

interface CategoryPreview {
  currentNumber: string;
  expectedNumber: string;
  numberChanges: boolean;
}

/** Category change with confirmation of old → expected new number (spec §21). */
function CategoryDialog({ a, onClose, onDone }: { a: AssetDetail; onClose: () => void; onDone: () => void }) {
  const categories = useQuery({ queryKey: ['lookups', 'categories'], queryFn: () => api<CategoryLookup[]>('/lookups/categories') });
  const [main, setMain] = useState(a.mainCategory as string);
  const [subId, setSubId] = useState('');
  const [reason, setReason] = useState('');
  const preview = useQuery({
    queryKey: ['assets', a.id, 'category-preview', subId],
    queryFn: () => api<CategoryPreview>(`/assets/${a.id}/category-change?subcategoryId=${subId}`),
    enabled: !!subId,
  });
  const change = useMutation({
    mutationFn: () => api(`/assets/${a.id}/category-change`, { method: 'POST', json: { subcategoryId: subId, version: a.version, reason } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const subs = (categories.data?.find((c) => c.code === main)?.subcategories ?? []).filter((s) => s.id !== a.subcategory.id);

  return (
    <Modal
      open
      title="تغيير الفئة"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={!preview.data || change.isPending} onClick={() => change.mutate()}>
            {change.isPending ? 'جارٍ التنفيذ…' : 'تأكيد تغيير الفئة'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            إلغاء
          </button>
        </>
      }
    >
      <FormAlert error={change.error ?? preview.error} />
      <p>
        الفئة الحالية: {MAIN_CATEGORY_LABELS[a.mainCategory]} / {a.subcategory.name}
      </p>
      <div className="form-grid">
        <SelectField
          label="الفئة الرئيسية الجديدة"
          value={main}
          onChange={(e) => {
            setMain(e.target.value);
            setSubId('');
          }}
        >
          {categories.data?.map((c) => (
            <option key={c.code} value={c.code}>
              {MAIN_CATEGORY_LABELS[c.code]}
            </option>
          ))}
        </SelectField>
        <SelectField label="الفئة الفرعية الجديدة" value={subId} onChange={(e) => setSubId(e.target.value)}>
          <option value="">اختر…</option>
          {subs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField label="السبب (اختياري)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      {preview.data &&
        (preview.data.numberChanges ? (
          <div className="alert alert-warning">
            سيتغير رقم الأصل: <bdi dir="ltr">{preview.data.currentNumber}</bdi> ← <bdi dir="ltr">{preview.data.expectedNumber}</bdi> (متوقع). يبقى الرقم القديم محفوظًا في
            التاريخ ولا يُعاد استخدامه، ولا يتغير رمز QR.
          </div>
        ) : (
          <div className="alert alert-info">الفئة الرئيسية لم تتغير؛ يبقى رقم الأصل كما هو.</div>
        ))}
    </Modal>
  );
}

function SerialDialog({ a, onClose, onDone }: { a: AssetDetail; onClose: () => void; onDone: () => void }) {
  const [serial, setSerial] = useState('');
  const [reason, setReason] = useState('');
  const change = useMutation({
    mutationFn: () => api(`/assets/${a.id}/serial`, { method: 'POST', json: { serialNumber: serial.trim(), version: a.version, reason } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Modal open title="تعديل الرقم التسلسلي" onClose={onClose}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate();
        }}
      >
        <FormAlert error={change.error} />
        <p>
          الحالي: <bdi dir="ltr">{a.serialNumber}</bdi> {a.serialIsInternal && <span className="badge">رقم داخلي</span>}
        </p>
        <TextField label="الرقم التسلسلي الجديد" dir="ltr" value={serial} onChange={(e) => setSerial(e.target.value)} maxLength={100} error={fieldErrors(change.error).serialNumber} autoFocus />
        <TextField label="السبب (اختياري)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <p className="hint">تُحفظ القيمة القديمة والجديدة واسم المستخدم والتاريخ.</p>
        <button type="submit" className="btn btn-primary" disabled={!serial.trim() || change.isPending}>
          حفظ
        </button>
      </form>
    </Modal>
  );
}

interface CurrentCustodyInfo {
  responsible: string | null;
  responsibleActive: boolean;
  since: string;
  current: { kind: 'CUSTODY' | 'RETURN'; id: string; number: string; since: string; documentFileId: string | null } | null;
  pending: { id: string; number: string; createdAt: string } | null;
  lastHandover: { id: string; number: string; at: string } | null;
  lastReturn: { id: string; number: string; at: string } | null;
}

function OperationLink({ kind, id, number }: { kind: 'CUSTODY' | 'RETURN'; id: string; number: string }) {
  return (
    <Link to={kind === 'CUSTODY' ? `/custodies/${id}` : `/custody-returns/${id}`}>
      <bdi dir="ltr">{number}</bdi>
    </Link>
  );
}

/** "العهدة الحالية" panel (spec §29). */
function CurrentCustody({ assetId }: { assetId: string }) {
  const info = useQuery({ queryKey: ['assets', assetId, 'custody'], queryFn: () => api<CurrentCustodyInfo>(`/assets/${assetId}/custody`) });
  if (info.isPending) return <Loading />;
  if (info.isError) return <ErrorState error={info.error} onRetry={() => void info.refetch()} />;
  const c = info.data;
  return (
    <section className="card">
      <div className="page-header" style={{ marginBlockEnd: '0.5rem' }}>
        <h2>العهدة الحالية</h2>
        <OfficialPdfLink fileId={c.current?.documentFileId} label="المستند الرسمي" />
      </div>
      <dl className="details">
        <dt>المسؤول الحالي</dt>
        <dd>
          {c.responsible ?? '—'} {!c.responsibleActive && <span className="badge badge-warning">غير فعّال في EAP</span>}
        </dd>
        <dt>تاريخ الاستلام</dt>
        <dd>{formatDateTime(c.since)}</dd>
        <dt>المستند</dt>
        <dd>{c.current ? <OperationLink kind={c.current.kind} id={c.current.id} number={c.current.number} /> : 'منذ إنشاء الأصل'}</dd>
        <dt>حالة العهدة</dt>
        <dd>
          {c.pending ? (
            <span className="badge badge-warning">محضر {c.pending.number} بانتظار التأكيد</span>
          ) : (
            <span className="badge badge-success">مستقرة</span>
          )}
        </dd>
        <dt>آخر تسليم</dt>
        <dd>
          {c.lastHandover ? (
            <>
              <OperationLink kind="CUSTODY" id={c.lastHandover.id} number={c.lastHandover.number} /> — {formatDateTime(c.lastHandover.at)}
            </>
          ) : (
            '—'
          )}
        </dd>
        <dt>آخر إرجاع</dt>
        <dd>
          {c.lastReturn ? (
            <>
              <OperationLink kind="RETURN" id={c.lastReturn.id} number={c.lastReturn.number} /> — {formatDateTime(c.lastReturn.at)}
            </>
          ) : (
            '—'
          )}
        </dd>
      </dl>
    </section>
  );
}
