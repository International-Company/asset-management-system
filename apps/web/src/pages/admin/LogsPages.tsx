import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatDateTime, isolate } from '../../lib/format';
import { ENTITY_LABELS, LOGIN_FAILURE_REASONS, operationLabel, SECURITY_EVENT_LABELS } from '../../lib/labels';
import { useServerList } from '../../lib/list';
import { type Column, DataTable, SearchBox } from '../../components/DataTable';
import { SelectField, TextField } from '../../components/Form';
import { Modal } from '../../components/Modal';

interface AuditRow {
  id: string;
  actorId: string | null;
  actorName: string | null;
  operation: string;
  entityType: string;
  entityId: string | null;
  oldData: unknown;
  newData: unknown;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface SecurityRow {
  id: string;
  type: string;
  userId: string | null;
  username: string | null;
  actorId: string | null;
  ip: string | null;
  device: string | null;
  browser: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

/** Converts a date input (YYYY-MM-DD) to the start/end of that day in the browser's local time, as ISO. */
function dayBound(date: string, end: boolean): string {
  return date ? new Date(`${date}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString() : '';
}

function DateFilters({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const [f, setF] = useState(from ? from.slice(0, 10) : '');
  const [t, setT] = useState(to ? to.slice(0, 10) : '');
  return (
    <>
      <TextField label="من تاريخ" type="date" value={f} onChange={(e) => { setF(e.target.value); onChange(dayBound(e.target.value, false), dayBound(t, true)); }} />
      <TextField label="إلى تاريخ" type="date" value={t} onChange={(e) => { setT(e.target.value); onChange(dayBound(f, false), dayBound(e.target.value, true)); }} />
    </>
  );
}

// ── Audit log ──────────────────────────────────────────────────────────

export function AuditLogPage() {
  const { state, update, query } = useServerList<AuditRow>('/audit', ['entityType', 'operation', 'from', 'to'], { order: 'desc' });
  const facets = useQuery({ queryKey: ['audit', 'facets'], queryFn: () => api<{ entityTypes: string[]; operations: string[] }>('/audit/facets') });
  const [open, setOpen] = useState<AuditRow | null>(null);

  const columns: Column<AuditRow>[] = [
    { key: 'at', label: 'الوقت', render: (r) => formatDateTime(r.createdAt) },
    { key: 'actor', label: 'المستخدم', render: (r) => r.actorName ?? '—' },
    { key: 'op', label: 'العملية', render: (r) => operationLabel(r.operation) },
    { key: 'entity', label: 'الكيان', render: (r) => ENTITY_LABELS[r.entityType] ?? r.entityType },
    {
      key: 'details',
      label: '',
      render: (r) => (
        <button type="button" className="btn btn-sm" onClick={() => setOpen(r)}>
          التفاصيل
        </button>
      ),
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>سجل التدقيق</h1>
          <p className="muted">سجل غير قابل للتعديل أو الحذف لكل تغيير على البيانات.</p>
        </div>
      </div>
      <div className="toolbar">
        <SearchBox value={state.q} onSearch={(q) => update({ q })} label="بحث بالمستخدم أو المعرّف" />
        <SelectField label="الكيان" value={state.filters.entityType} onChange={(e) => update({ filters: { entityType: e.target.value } })}>
          <option value="">الكل</option>
          {facets.data?.entityTypes.map((t) => (
            <option key={t} value={t}>
              {ENTITY_LABELS[t] ?? t}
            </option>
          ))}
        </SelectField>
        <SelectField label="العملية" value={state.filters.operation} onChange={(e) => update({ filters: { operation: e.target.value } })}>
          <option value="">الكل</option>
          {facets.data?.operations.map((o) => (
            <option key={o} value={o}>
              {operationLabel(o)}
            </option>
          ))}
        </SelectField>
        <DateFilters from={state.filters.from} to={state.filters.to} onChange={(from, to) => update({ filters: { from, to } })} />
      </div>
      <DataTable columns={columns} query={query} state={state} onChange={update} rowKey={(r) => r.id} empty="لا توجد سجلات مطابقة." />
      <p className="hint">التصدير إلى PDF وExcel يُضاف مع وحدة التقارير.</p>
      {open && <AuditDetail row={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function show(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

/** Normalizes stored old/new data into rows of field → old → new. */
function diffRows(row: AuditRow): Array<{ field: string; old: unknown; new: unknown }> {
  const oldObj = (row.oldData ?? {}) as Record<string, unknown>;
  const newObj = (row.newData ?? {}) as Record<string, unknown>;
  // Updates recorded as { field: { old, new } } by AuditService.diff.
  const isDiff = row.oldData == null && Object.values(newObj).every((v) => v && typeof v === 'object' && 'old' in v && 'new' in v);
  if (isDiff && Object.keys(newObj).length) {
    return Object.entries(newObj).map(([field, v]) => ({ field, ...(v as { old: unknown; new: unknown }) }));
  }
  const fields = [...new Set([...Object.keys(oldObj), ...Object.keys(newObj)])];
  return fields
    .filter((f) => JSON.stringify(oldObj[f]) !== JSON.stringify(newObj[f]) || row.oldData == null || row.newData == null)
    .map((field) => ({ field, old: oldObj[field], new: newObj[field] }));
}

function AuditDetail({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  const rows = diffRows(row);
  return (
    <Modal open wide title={operationLabel(row.operation)} onClose={onClose}>
      <dl className="details">
        <dt>الوقت</dt>
        <dd>{formatDateTime(row.createdAt)}</dd>
        <dt>المستخدم</dt>
        <dd>{row.actorName ?? '—'}</dd>
        <dt>الكيان</dt>
        <dd>
          {ENTITY_LABELS[row.entityType] ?? row.entityType} <bdi dir="ltr" className="muted">{row.entityId}</bdi>
        </dd>
      </dl>
      <h3 style={{ marginBlockStart: '1rem' }}>التغييرات</h3>
      {rows.length === 0 ? (
        <p className="muted">لا توجد بيانات تفصيلية.</p>
      ) : (
        <table className="diff">
          <thead>
            <tr>
              <th>الحقل</th>
              <th>القيمة القديمة</th>
              <th>القيمة الجديدة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.field}>
                <td>
                  <bdi dir="ltr">{r.field}</bdi>
                </td>
                <td className="old">
                  <pre className="json">{show(r.old)}</pre>
                </td>
                <td className="new">
                  <pre className="json">{show(r.new)}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

// ── Security log ───────────────────────────────────────────────────────

function securityDetails(r: SecurityRow): string {
  const d = r.details ?? {};
  if (typeof d.reason === 'string') return LOGIN_FAILURE_REASONS[d.reason] ?? d.reason;
  if (r.type === 'ROLE_CHANGED' && Array.isArray(d.to)) return `الأدوار: ${(d.to as string[]).join('، ') || '—'}`;
  if (r.type === 'PERMISSION_CHANGED') {
    const added = (d.added as string[] | undefined)?.length ?? 0;
    const removed = (d.removed as string[] | undefined)?.length ?? 0;
    return `${String(d.role ?? '')}: +${added} / −${removed}${d.status ? ` (${d.status === 'INACTIVE' ? 'تعطيل' : 'تفعيل'})` : ''}`;
  }
  if (r.type === 'SECURITY_SETTING_CHANGED') return `${isolate(d.key)}: ${isolate(show(d.old))} ← ${isolate(show(d.new))}`;
  return '';
}

export function SecurityLogPage() {
  const { state, update, query } = useServerList<SecurityRow>('/security/logs', ['type', 'from', 'to'], { order: 'desc' });
  const columns: Column<SecurityRow>[] = [
    { key: 'at', label: 'الوقت', render: (r) => formatDateTime(r.createdAt) },
    {
      key: 'type',
      label: 'الحدث',
      render: (r) => (
        <span className={`badge ${r.type === 'LOGIN_FAILED' || r.type === 'ACCOUNT_LOCKED' ? 'badge-danger' : ''}`}>
          {SECURITY_EVENT_LABELS[r.type] ?? r.type}
        </span>
      ),
    },
    { key: 'user', label: 'المستخدم', render: (r) => <bdi dir="ltr">{r.username ?? '—'}</bdi> },
    { key: 'ip', label: 'عنوان IP', render: (r) => <bdi dir="ltr">{r.ip ?? '—'}</bdi> },
    { key: 'device', label: 'الجهاز / المتصفح', render: (r) => (r.device || r.browser ? `${r.device ?? '—'} / ${r.browser ?? '—'}` : '—') },
    { key: 'details', label: 'تفاصيل', render: securityDetails },
  ];
  return (
    <>
      <div className="page-header">
        <div>
          <h1>السجل الأمني</h1>
          <p className="muted">عمليات الدخول والخروج والجلسات وتغييرات الأدوار والصلاحيات والإعدادات الأمنية. غير قابل للتعديل.</p>
        </div>
      </div>
      <div className="toolbar">
        <SearchBox value={state.q} onSearch={(q) => update({ q })} label="بحث باسم المستخدم أو IP" />
        <SelectField label="نوع الحدث" value={state.filters.type} onChange={(e) => update({ filters: { type: e.target.value } })}>
          <option value="">الكل</option>
          {Object.entries(SECURITY_EVENT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
        <DateFilters from={state.filters.from} to={state.filters.to} onChange={(from, to) => update({ filters: { from, to } })} />
      </div>
      <DataTable columns={columns} query={query} state={state} onChange={update} rowKey={(r) => r.id} empty="لا توجد أحداث مطابقة." />
      <p className="hint">التصدير إلى PDF وExcel يُضاف مع وحدة التقارير.</p>
    </>
  );
}
