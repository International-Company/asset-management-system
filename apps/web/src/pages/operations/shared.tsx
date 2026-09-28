import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CUSTODY_STATUS_LABELS, type CustodyStatus, MAINTENANCE_STATUS_LABELS, type MaintenanceStatus } from '@osooli/shared';
import { api, fileUrl } from '../../lib/api';
import type { Page } from '../../lib/list';
import { StatusPill } from '../assets/AssetsListPage';
import type { AssetListItem, Responsible } from '../assets/types';

export function CustodyStatusBadge({ status }: { status: CustodyStatus }) {
  const tone = { PENDING: 'badge-warning', CONFIRMED: 'badge-success', REJECTED: 'badge-danger', CANCELLED: '' }[status];
  return <span className={`badge ${tone}`}>{CUSTODY_STATUS_LABELS[status]}</span>;
}

export function MaintenanceStatusBadge({ status }: { status: MaintenanceStatus }) {
  const tone = { NEW: '', IN_PROGRESS: 'badge-warning', COMPLETED: 'badge-success', CLOSED: '' }[status];
  return <span className={`badge ${tone}`}>{MAINTENANCE_STATUS_LABELS[status]}</span>;
}

/** Link to an archived official PDF (spec §38). */
export function OfficialPdfLink({ fileId, label = 'المستند الرسمي (PDF)' }: { fileId: string | null | undefined; label?: string }) {
  if (!fileId) return null;
  return (
    <a className="btn btn-sm" href={fileUrl(fileId)} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

export const AssetLink = ({ asset }: { asset: { id: string; assetNumber: string; name?: string } }) => (
  <Link to={`/assets/${asset.id}`}>
    <bdi dir="ltr">{asset.assetNumber}</bdi>
    {asset.name ? ` — ${asset.name}` : ''}
  </Link>
);

export function responsibleBody(r: Responsible) {
  return r.type === 'EMPLOYEE' ? { type: r.type, eapEmployeeId: r.eapEmployeeId } : { type: r.type, externalPersonId: r.externalPersonId };
}

/**
 * Search and add assets to a multi-asset operation. Sold assets are listed but
 * cannot be added; `exclude` hides already-chosen ones.
 */
export function AssetPicker({ exclude, onAdd }: { exclude: string[]; onAdd: (a: AssetListItem) => void }) {
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');
  const results = useQuery({
    queryKey: ['asset-picker', submitted],
    enabled: submitted.length > 0,
    queryFn: () => api<Page<AssetListItem>>(`/assets?q=${encodeURIComponent(submitted)}&pageSize=25`),
  });
  const items = results.data?.items.filter((a) => !exclude.includes(a.id)) ?? [];
  return (
    <fieldset className="group">
      <legend>إضافة أصول</legend>
      <div className="toolbar">
        <div className="field grow">
          <label htmlFor="asset-picker-q">ابحث برقم الأصل أو الاسم أو الرقم التسلسلي أو رمز QR</label>
          <input
            id="asset-picker-q"
            className="input"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setSubmitted(term.trim());
              }
            }}
          />
        </div>
        <button type="button" className="btn" onClick={() => setSubmitted(term.trim())}>
          بحث
        </button>
      </div>
      {results.isFetching && <p className="muted">جارٍ البحث…</p>}
      {results.data && items.length === 0 && <p className="muted">لا توجد نتائج.</p>}
      {items.length > 0 && (
        <ul className="pick-list">
          {items.map((a) => (
            <li key={a.id}>
              <button type="button" className="btn btn-sm" disabled={a.status === 'SOLD'} onClick={() => onAdd(a)}>
                إضافة
              </button>
              <span>
                <bdi dir="ltr">{a.assetNumber}</bdi> — {a.name} <StatusPill status={a.status} />{' '}
                <span className="muted">({a.responsibleEmployee?.fullName ?? a.responsibleExternal?.name ?? '—'})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
