import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ASSET_STATUS_LABELS, type AssetStatus, CUSTODY_STATUS_LABELS, type CustodyStatus, PERMISSIONS } from '@osooli/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { useServerList } from '../../lib/list';
import { type Column, DataTable, SearchBox } from '../../components/DataTable';
import { fieldErrors, FormAlert, formError, SelectField, TextField } from '../../components/Form';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { ErrorState, Loading } from '../../components/States';
import { ResponsiblePicker } from '../assets/ResponsiblePicker';
import type { AssetDetail, AssetListItem, Responsible } from '../assets/types';
import { AssetLink, AssetPicker, CustodyStatusBadge, OfficialPdfLink, responsibleBody } from './shared';

const HANDOVER: AssetStatus[] = ['NEW', 'IN_USE', 'UNUSED', 'DAMAGED'];

interface CustodyRow {
  id: string;
  number: string;
  status: CustodyStatus;
  createdAt: string;
  confirmedAt: string | null;
  newResponsibleEmployee: { fullName: string } | null;
  newResponsibleExternal: { name: string } | null;
  _count: { items: number };
}

export function CustodyListPage() {
  const { can } = useAuth();
  const { state, update, query } = useServerList<CustodyRow>('/custodies', ['status'], { order: 'desc' });
  const columns: Column<CustodyRow>[] = [
    { key: 'number', label: 'رقم المحضر', render: (c) => <Link to={`/custodies/${c.id}`}><bdi dir="ltr">{c.number}</bdi></Link> },
    { key: 'to', label: 'المسؤول الجديد', render: (c) => c.newResponsibleEmployee?.fullName ?? c.newResponsibleExternal?.name ?? '—' },
    { key: 'count', label: 'عدد الأصول', render: (c) => c._count.items },
    { key: 'status', label: 'الحالة', render: (c) => <CustodyStatusBadge status={c.status} /> },
    { key: 'created', label: 'تاريخ الإنشاء', render: (c) => formatDateTime(c.createdAt) },
    { key: 'confirmed', label: 'تاريخ التأكيد', render: (c) => formatDateTime(c.confirmedAt) },
  ];
  return (
    <>
      <div className="page-header">
        <div>
          <h1>محاضر العهدة</h1>
          <p className="muted">لا يتغير المسؤول حتى يؤكد المسؤول الجديد الاستلام.</p>
        </div>
        {can(PERMISSIONS.CUSTODY_CREATE) && (
          <Link className="btn btn-primary" to="/custodies/new">
            محضر عهدة جديد
          </Link>
        )}
      </div>
      <div className="toolbar">
        <SearchBox value={state.q} onSearch={(q) => update({ q })} label="بحث برقم المحضر أو المسؤول أو رقم الأصل" />
        <SelectField label="الحالة" value={state.filters.status} onChange={(e) => update({ filters: { status: e.target.value } })}>
          <option value="">الكل</option>
          {Object.entries(CUSTODY_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
      </div>
      <DataTable columns={columns} query={query} state={state} onChange={update} rowKey={(c) => c.id} empty="لا توجد محاضر." />
    </>
  );
}

interface Line {
  asset: Pick<AssetListItem, 'id' | 'assetNumber' | 'name' | 'status'> & { responsible: string };
  condition: AssetStatus;
  notes: string;
}

function toLine(a: { id: string; assetNumber: string; name: string; status: AssetStatus; responsible: string }): Line {
  return { asset: a, condition: HANDOVER.includes(a.status) ? a.status : 'IN_USE', notes: '' };
}

export function CustodyNewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // null until the user edits the list; until then the preset asset (if any) is the list.
  const [edited, setEdited] = useState<Line[] | null>(null);
  const [responsible, setResponsible] = useState<Responsible | null>(null);
  const [notes, setNotes] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);
  const preset = params.get('assetId');

  // Pre-fill from the asset page ("تسليم عهدة").
  const presetAsset = useQuery({ queryKey: ['assets', preset], enabled: !!preset, queryFn: () => api<AssetDetail>(`/assets/${preset}`) });
  const p = presetAsset.data;
  const presetLines = p ? [toLine({ ...p, responsible: p.responsibleEmployee?.fullName ?? p.responsibleExternal?.name ?? '—' })] : [];
  const lines = edited ?? presetLines;
  const setLines = (fn: (l: Line[]) => Line[]) => setEdited(fn(lines));

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/custodies', {
        method: 'POST',
        json: { newResponsible: responsibleBody(responsible!), items: lines.map((l) => ({ assetId: l.asset.id, condition: l.condition, notes: l.notes })), notes },
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['/custodies'] });
      navigate(`/custodies/${res.id}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setClientError(!lines.length ? 'أضف أصلًا واحدًا على الأقل.' : !responsible ? 'اختر المسؤول الجديد.' : null);
    if (lines.length && responsible) create.mutate();
  };
  const set = (i: number, patch: Partial<Line>) => setLines((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const errors = fieldErrors(create.error);

  return (
    <form onSubmit={submit} noValidate>
      <p className="muted">
        <Link to="/custodies">محاضر العهدة</Link> / محضر جديد
      </p>
      <h1>محضر عهدة جديد</h1>
      <FormAlert error={create.error} />
      {clientError && (
        <div className="alert alert-error" role="alert">
          {clientError}
        </div>
      )}
      <section className="card">
        <ResponsiblePicker legend="المسؤول الجديد (المستلم) *" value={responsible} onChange={setResponsible} error={errors.newResponsible ?? errors['responsible.eapEmployeeId']} />
        <AssetPicker
          exclude={lines.map((l) => l.asset.id)}
          onAdd={(a) => setLines((l) => [...l, toLine({ ...a, responsible: a.responsibleEmployee?.fullName ?? a.responsibleExternal?.name ?? '—' })])}
        />
        {lines.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الأصل</th>
                  <th>المسؤول الحالي</th>
                  <th>الحالة عند التسليم</th>
                  <th>ملاحظات</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.asset.id}>
                    <td>
                      <bdi dir="ltr">{l.asset.assetNumber}</bdi> — {l.asset.name}
                    </td>
                    <td>{l.asset.responsible}</td>
                    <td>
                      <select className="input" aria-label={`الحالة عند التسليم ${l.asset.assetNumber}`} value={l.condition} onChange={(e) => set(i, { condition: e.target.value as AssetStatus })}>
                        {HANDOVER.map((s) => (
                          <option key={s} value={s}>
                            {ASSET_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input className="input" aria-label={`ملاحظات ${l.asset.assetNumber}`} value={l.notes} maxLength={1000} onChange={(e) => set(i, { notes: e.target.value })} />
                    </td>
                    <td>
                      <button type="button" className="btn btn-sm" onClick={() => setLines((x) => x.filter((_, j) => j !== i))}>
                        إزالة
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="field" style={{ marginBlockStart: '1rem' }}>
          <label htmlFor="custody-notes">ملاحظات المحضر</label>
          <textarea id="custody-notes" className="input" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <p className="hint">يبقى المسؤول الحالي كما هو حتى يؤكد المستلم الاستلام.</p>
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          {create.isPending ? 'جارٍ الحفظ…' : 'إنشاء المحضر'}
        </button>
      </section>
    </form>
  );
}

interface CustodyDetail {
  id: string;
  number: string;
  status: CustodyStatus;
  notes: string | null;
  createdAt: string;
  createdByName: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
  rejectedAt: string | null;
  rejectedByName: string | null;
  rejectionReason: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancellationReason: string | null;
  officialFileId: string | null;
  canAct: boolean;
  newResponsibleEmployee: { fullName: string } | null;
  newResponsibleExternal: { name: string; organization: string | null } | null;
  items: Array<{
    id: string;
    conditionAtHandover: AssetStatus;
    notes: string | null;
    asset: { id: string; assetNumber: string; name: string; status: AssetStatus };
    previousResponsibleEmployee: { fullName: string } | null;
    previousResponsibleExternal: { name: string } | null;
  }>;
}

export function CustodyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const custody = useQuery({ queryKey: ['custodies', id], queryFn: () => api<CustodyDetail>(`/custodies/${id}`) });
  const [dialog, setDialog] = useState<'confirm' | 'reject' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const act = useMutation({
    mutationFn: (action: 'confirm' | 'reject' | 'cancel') =>
      api(`/custodies/${id}/${action}`, { method: 'POST', json: action === 'confirm' ? {} : { reason } }),
    onSuccess: () => {
      setDialog(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['custodies'] });
      void queryClient.invalidateQueries({ queryKey: ['/custodies'] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });

  if (custody.isPending) return <Loading />;
  if (custody.isError) return <ErrorState error={custody.error} onRetry={() => void custody.refetch()} />;
  const c = custody.data;
  const to = c.newResponsibleEmployee?.fullName ?? c.newResponsibleExternal?.name ?? '—';
  const external = !!c.newResponsibleExternal;

  return (
    <>
      <p className="muted">
        <Link to="/custodies">محاضر العهدة</Link> / <bdi dir="ltr">{c.number}</bdi>
      </p>
      <div className="page-header">
        <div>
          <h1>
            محضر عهدة <bdi dir="ltr">{c.number}</bdi>
          </h1>
          <CustodyStatusBadge status={c.status} />
        </div>
        <div className="row-actions">
          <OfficialPdfLink fileId={c.officialFileId} />
          {c.canAct && (
            <>
              <button type="button" className="btn btn-primary" onClick={() => setDialog('confirm')}>
                {external ? 'تأكيد الاستلام بالنيابة' : 'تأكيد الاستلام'}
              </button>
              <button type="button" className="btn btn-danger" onClick={() => setDialog('reject')}>
                رفض الاستلام
              </button>
            </>
          )}
          {c.status === 'PENDING' && can(PERMISSIONS.CUSTODY_CANCEL) && (
            <button type="button" className="btn" onClick={() => setDialog('cancel')}>
              إلغاء المحضر
            </button>
          )}
        </div>
      </div>

      {c.status === 'PENDING' && (
        <div className="alert alert-info" role="status">
          المحضر بانتظار تأكيد {to}. لا يتغير المسؤول الحالي للأصول قبل التأكيد.
        </div>
      )}

      <section className="card">
        <dl className="details">
          <dt>المسؤول الجديد</dt>
          <dd>
            {to} {external && <span className="badge">شخص خارجي</span>}
          </dd>
          <dt>أنشأه</dt>
          <dd>
            {c.createdByName ?? '—'} — {formatDateTime(c.createdAt)}
          </dd>
          {c.confirmedAt && (
            <>
              <dt>تأكيد الاستلام</dt>
              <dd>
                {c.confirmedByName ?? '—'} — {formatDateTime(c.confirmedAt)}
              </dd>
            </>
          )}
          {c.rejectedAt && (
            <>
              <dt>الرفض</dt>
              <dd>
                {c.rejectedByName ?? '—'} — {formatDateTime(c.rejectedAt)}. السبب: {c.rejectionReason}
              </dd>
            </>
          )}
          {c.cancelledAt && (
            <>
              <dt>الإلغاء</dt>
              <dd>
                {c.cancelledByName ?? '—'} — {formatDateTime(c.cancelledAt)}. السبب: {c.cancellationReason}
              </dd>
            </>
          )}
          <dt>ملاحظات</dt>
          <dd>{c.notes ?? '—'}</dd>
        </dl>
      </section>

      <section className="card">
        <h2>الأصول ({c.items.length})</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>الأصل</th>
                <th>المسؤول السابق</th>
                <th>الحالة عند التسليم</th>
                <th>ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {c.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <AssetLink asset={i.asset} />
                  </td>
                  <td>{i.previousResponsibleEmployee?.fullName ?? i.previousResponsibleExternal?.name ?? '—'}</td>
                  <td>{ASSET_STATUS_LABELS[i.conditionAtHandover]}</td>
                  <td>{i.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={dialog === 'confirm'}
        title="تأكيد الاستلام"
        message={
          external
            ? `تؤكد استلام ${c.items.length} أصل بالنيابة عن ${to}. سيُسجَّل ذلك باسمك في سجل التدقيق.`
            : `تؤكد استلام ${c.items.length} أصل. ستصبح المسؤول عنها وتتحول حالتها إلى «قيد الاستخدام»، ويُصدر مستند رسمي.`
        }
        confirmLabel="تأكيد"
        busy={act.isPending}
        error={formError(act.error)}
        onConfirm={() => act.mutate('confirm')}
        onClose={() => setDialog(null)}
      />
      {(dialog === 'reject' || dialog === 'cancel') && (
        <Modal
          open
          title={dialog === 'reject' ? 'رفض الاستلام' : 'إلغاء المحضر'}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="btn btn-danger" disabled={!reason.trim() || act.isPending} onClick={() => act.mutate(dialog)}>
                {dialog === 'reject' ? 'رفض' : 'إلغاء المحضر'}
              </button>
              <button type="button" className="btn" onClick={() => setDialog(null)}>
                رجوع
              </button>
            </>
          }
        >
          <FormAlert error={act.error} />
          <TextField label="السبب *" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} autoFocus />
          <p className="hint">لا يتغير المسؤول الحالي، ويبقى المحضر في التاريخ.</p>
        </Modal>
      )}
    </>
  );
}
