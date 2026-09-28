import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS } from '@osooli/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { FormAlert, formError, TextField } from './Form';
import { ConfirmDialog, Modal } from './Modal';

export interface SavedSearch {
  id: string;
  name: string;
  filters: Record<string, string>;
  columns: string[] | null;
  sort: { sort?: string; order?: 'asc' | 'desc' } | null;
  isShared: boolean;
  mine: boolean;
  ownerName: string;
  shares?: Array<{ roleId: string | null; userId: string | null }>;
}

interface Props {
  /** e.g. "assets" or "report:sales". */
  scope: string;
  current: { filters: Record<string, string>; columns?: string[]; sort?: { sort?: string; order?: 'asc' | 'desc' } };
  onApply: (s: SavedSearch) => void;
}

/** Save the current filters, re-apply saved or shared ones (spec §42). */
export function SavedSearchBar({ scope, current, onApply }: Props) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const key = ['saved-searches', scope];
  const list = useQuery({ queryKey: key, queryFn: () => api<SavedSearch[]>(`/saved-searches?scope=${encodeURIComponent(scope)}`) });
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [deleting, setDeleting] = useState<SavedSearch | null>(null);
  const [sharing, setSharing] = useState<SavedSearch | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const save = useMutation({
    mutationFn: () => api<SavedSearch>('/saved-searches', { method: 'POST', json: { scope, name: name.trim(), filters: current.filters, columns: current.columns, sort: current.sort } }),
    onSuccess: (s) => {
      setSaving(false);
      setName('');
      setSelected(s.id);
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/saved-searches/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleting(null);
      setSelected('');
      void refresh();
    },
  });
  const chosen = list.data?.find((s) => s.id === selected) ?? null;
  const hasFilters = Object.values(current.filters).some(Boolean);

  return (
    <div className="toolbar">
      <div className="field">
        <label htmlFor={`saved-${scope}`}>عمليات البحث المحفوظة</label>
        <select
          id={`saved-${scope}`}
          className="input"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            const s = list.data?.find((x) => x.id === e.target.value);
            if (s) onApply(s);
          }}
        >
          <option value="">اختر…</option>
          {list.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.mine ? (s.isShared ? ' (مشارك)' : '') : ` — من ${s.ownerName}`}
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="btn btn-sm" disabled={!hasFilters} onClick={() => setSaving(true)} title={hasFilters ? undefined : 'حدد فلترًا أولًا'}>
        حفظ البحث الحالي
      </button>
      {chosen?.mine && can(PERMISSIONS.SAVED_SEARCHES_SHARE) && (
        <button type="button" className="btn btn-sm" onClick={() => setSharing(chosen)}>
          مشاركة
        </button>
      )}
      {chosen?.mine && (
        <button type="button" className="btn btn-sm btn-danger" onClick={() => setDeleting(chosen)}>
          حذف
        </button>
      )}

      {saving && (
        <Modal open title="حفظ البحث" onClose={() => setSaving(false)}>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) save.mutate();
            }}
          >
            <FormAlert error={save.error} />
            <TextField label="اسم البحث" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
            <button type="submit" className="btn btn-primary" disabled={!name.trim() || save.isPending}>
              حفظ
            </button>
          </form>
        </Modal>
      )}
      <ConfirmDialog
        open={!!deleting}
        title="حذف البحث المحفوظ"
        message={`حذف «${deleting?.name}»؟`}
        confirmLabel="حذف"
        danger
        busy={remove.isPending}
        error={formError(remove.error)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
      {sharing && <ShareDialog search={sharing} onClose={() => setSharing(null)} onDone={refresh} />}
    </div>
  );
}

function ShareDialog({ search, onClose, onDone }: { search: SavedSearch; onClose: () => void; onDone: () => void }) {
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Array<{ id: string; name: string; status: string }>>('/roles') });
  const [roleIds, setRoleIds] = useState<string[]>(search.shares?.flatMap((s) => (s.roleId ? [s.roleId] : [])) ?? []);
  const userIds = search.shares?.flatMap((s) => (s.userId ? [s.userId] : [])) ?? [];
  const share = useMutation({
    mutationFn: () => api(`/saved-searches/${search.id}/shares`, { method: 'PUT', json: { roleIds, userIds } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Modal
      open
      title={`مشاركة «${search.name}»`}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" disabled={share.isPending} onClick={() => share.mutate()}>
          حفظ المشاركة
        </button>
      }
    >
      <FormAlert error={share.error} />
      <p className="muted">يظهر البحث لأصحاب الأدوار المحددة، ولا يمكنهم تعديله.</p>
      <div className="check-grid">
        {roles.data?.map((r) => (
          <label key={r.id} className="check">
            <input type="checkbox" checked={roleIds.includes(r.id)} onChange={(e) => setRoleIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id)))} />
            {r.name}
          </label>
        ))}
      </div>
    </Modal>
  );
}
