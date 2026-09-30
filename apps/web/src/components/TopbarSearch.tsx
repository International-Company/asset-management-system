import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ASSET_STATUS_LABELS,
  type AssetStatus,
  PERMISSIONS,
  type PermissionKey,
} from '@osooli/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Modal } from './Modal';
import { QrScanner } from './QrScanner';

/* ── Icons (inline strokes, like the rest of the top bar) ───────────────── */

const svg = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const SearchIcon = ({ size = 18 }: { size?: number }) => (
  <svg {...svg} width={size} height={size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </svg>
);
const QrIcon = () => (
  <svg {...svg} width={19} height={19}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <path d="M14 14h2v2h-2zM18 14h2M14 18v2M18 18h2v2" />
  </svg>
);

/* ── Resolving a scanned or typed code to a page ────────────────────────── */

interface AssetHit {
  id: string;
  assetNumber: string;
  name: string;
  serialNumber: string;
  status: AssetStatus;
  locationDepartment: { location: { name: string }; department: { name: string } };
}

/**
 * What a code on a label (or typed) leads to: the /qr/{token} link printed on
 * labels, else an exact asset number or serial, else the asset list filtered by
 * the code.
 */
export async function resolveCode(raw: string): Promise<string> {
  const code = raw.trim();
  const qr = /\/qr\/([^/?#\s]+)/.exec(code);
  if (qr) return `/qr/${qr[1]}`;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return '/offline/lookup';
  const res = await api<{ items: AssetHit[] }>(`/assets?q=${encodeURIComponent(code)}&pageSize=25`);
  const lower = code.toLowerCase();
  const exact = res.items.filter(
    (a) => a.assetNumber.toLowerCase() === lower || a.serialNumber.toLowerCase() === lower,
  );
  if (exact.length === 1) return `/assets/${exact[0].id}`;
  if (res.items.length === 1) return `/assets/${res.items[0].id}`;
  return `/assets?q=${encodeURIComponent(code)}`;
}

/** The QR button: scan a label with the camera (or type its code) from any page. */
export function QrScanButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const onResult = async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      const to = await resolveCode(code);
      setOpen(false);
      navigate(to);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذر البحث عن الأصل.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label="مسح رمز QR"
        title="مسح رمز QR"
        onClick={() => (setError(null), setOpen(true))}
      >
        <QrIcon />
      </button>
      <Modal open={open} title="مسح رمز QR" onClose={() => setOpen(false)}>
        <p className="muted" style={{ marginBlockStart: 0 }}>
          وجّه الكاميرا إلى ملصق الأصل، أو اكتب رقم الأصل أو رقمه التسلسلي.
        </p>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        {open && <QrScanner onResult={(c) => void onResult(c)} busy={busy} />}
      </Modal>
    </>
  );
}

/* ── Global search (Ctrl+K) ──────────────────────────────────────────────── */

export interface SearchPage {
  to: string;
  label: string;
  section: string;
}

/** Record numbers the search recognises, e.g. "CUS-000031" or just "CUS". */
const RECORD_TYPES: Array<{
  prefix: string;
  label: string;
  list: string;
  permission: PermissionKey;
  detail: (id: string, number: string) => string;
}> = [
  {
    prefix: 'CUS',
    label: 'محضر عهدة',
    list: '/custodies',
    permission: PERMISSIONS.CUSTODY_VIEW,
    detail: (id) => `/custodies/${id}`,
  },
  {
    prefix: 'RET',
    label: 'محضر إرجاع',
    list: '/custody-returns',
    permission: PERMISSIONS.CUSTODY_VIEW,
    detail: (id) => `/custody-returns/${id}`,
  },
  {
    prefix: 'MNT',
    label: 'طلب صيانة',
    list: '/maintenances',
    permission: PERMISSIONS.MAINTENANCE_VIEW,
    detail: (id) => `/maintenances/${id}`,
  },
  {
    prefix: 'SAL',
    label: 'عملية بيع',
    list: '/sales',
    permission: PERMISSIONS.SALES_VIEW,
    detail: (id) => `/sales/${id}`,
  },
  {
    prefix: 'INV',
    label: 'جرد',
    list: '/inventories',
    permission: PERMISSIONS.INVENTORY_VIEW,
    detail: (id) => `/inventories/${id}`,
  },
  {
    prefix: 'TRF',
    label: 'عملية نقل',
    list: '/transfers',
    permission: PERMISSIONS.TRANSFERS_VIEW,
    detail: (_id, n) => `/transfers?q=${encodeURIComponent(n)}`,
  },
];

interface Result {
  key: string;
  group: 'الأصول' | 'المحاضر' | 'الصفحات';
  title: string;
  meta?: string;
  badge?: string;
  code?: string;
  to: string;
}

/** Waits until typing pauses before searching. */
function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function GlobalSearch({ pages }: { pages: SearchPage[] }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const listId = useId();
  const term = useDebounced(query.trim(), 200);
  const canAssets = can(PERMISSIONS.ASSETS_VIEW);

  // Ctrl+K / ⌘K anywhere; "/" when not typing in a field.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
      setTimeout(() => input.current?.focus(), 0);
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  const assets = useQuery({
    queryKey: ['global-search', 'assets', term],
    queryFn: () => api<{ items: AssetHit[] }>(`/assets?q=${encodeURIComponent(term)}&pageSize=25`),
    enabled: open && canAssets && term.length >= 2,
    staleTime: 30_000,
  });

  const recordType = RECORD_TYPES.find(
    (r) => new RegExp(`^${r.prefix}(?:[-\\s]?\\d*)$`, 'i').test(term) && can(r.permission),
  );
  const records = useQuery({
    queryKey: ['global-search', 'records', recordType?.prefix, term],
    queryFn: () =>
      api<{ items: Array<{ id: string; number: string }> }>(
        `${recordType!.list}?q=${encodeURIComponent(term)}&pageSize=25`,
      ),
    enabled: open && !!recordType && term.length >= 3,
    staleTime: 30_000,
  });

  const results = useMemo<Result[]>(() => {
    const out: Result[] = [];
    if (recordType && records.data) {
      for (const r of records.data.items.slice(0, 5)) {
        out.push({
          key: `rec-${r.id}`,
          group: 'المحاضر',
          title: `${recordType.label}`,
          code: r.number,
          to: recordType.detail(r.id, r.number),
        });
      }
    }
    if (term.length >= 2 && assets.data) {
      for (const a of assets.data.items.slice(0, 6)) {
        out.push({
          key: `asset-${a.id}`,
          group: 'الأصول',
          title: a.name,
          code: a.assetNumber,
          meta: `${a.locationDepartment.location.name} / ${a.locationDepartment.department.name}`,
          badge: ASSET_STATUS_LABELS[a.status],
          to: `/assets/${a.id}`,
        });
      }
      if (assets.data.items.length > 6) {
        out.push({
          key: 'asset-all',
          group: 'الأصول',
          title: `عرض كل النتائج لـ «${term}»`,
          to: `/assets?q=${encodeURIComponent(term)}`,
        });
      }
    }
    const q = query.trim();
    for (const p of pages
      .filter((p) => !q || p.label.includes(q) || p.section.includes(q))
      .slice(0, q ? 6 : 8)) {
      out.push({
        key: `page-${p.to}`,
        group: 'الصفحات',
        title: p.label,
        meta: p.section,
        to: p.to,
      });
    }
    return out;
  }, [assets.data, records.data, recordType, term, query, pages]);

  // Keep the highlighted row within the list as results change.
  const [seenKeys, setSeenKeys] = useState('');
  const keys = results.map((r) => r.key).join('|');
  if (keys !== seenKeys) {
    setSeenKeys(keys);
    setActive(0);
  }

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const go = (r: Result) => {
    close();
    navigate(r.to);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[active];
      if (r) go(r);
      else if (query.trim() && canAssets) {
        close();
        navigate(`/assets?q=${encodeURIComponent(query.trim())}`);
      }
    }
  };

  useEffect(() => {
    if (open)
      document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, listId, open]);

  const loading = (assets.isFetching && term.length >= 2) || (records.isFetching && !!recordType);
  const optionId = (i: number) => `${listId}-${i}`;
  let lastGroup = '';

  return (
    <>
      <button
        type="button"
        className="search-trigger"
        aria-label="البحث في النظام"
        aria-keyshortcuts="Control+K"
        onClick={() => setOpen(true)}
      >
        <SearchIcon />
        <span className="search-trigger-text">ابحث عن أصل أو محضر أو صفحة…</span>
        <kbd className="search-kbd" dir="ltr">
          Ctrl K
        </kbd>
      </button>

      <dialog
        ref={dialog}
        className="palette"
        aria-label="البحث في النظام"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
      >
        {/* Contents exist only while open, so hidden results never sit in the page. */}
        {open && (
          <div className="palette-box">
            <div className="palette-input-row">
              <SearchIcon size={20} />
              <input
                ref={input}
                className="palette-input"
                role="combobox"
                aria-expanded={results.length > 0}
                aria-controls={listId}
                aria-activedescendant={results[active] ? optionId(active) : undefined}
                aria-autocomplete="list"
                aria-label="ابحث عن أصل أو محضر أو صفحة"
                placeholder="رقم الأصل، الاسم، الرقم التسلسلي، رقم محضر مثل CUS-000031، أو اسم صفحة"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
              />
              {loading && <span className="palette-spinner" aria-label="جارٍ البحث" />}
              <kbd className="search-kbd" dir="ltr">
                Esc
              </kbd>
            </div>

            <ul id={listId} className="palette-list" role="listbox" aria-label="نتائج البحث">
              {results.map((r, i) => {
                const header = r.group !== lastGroup ? r.group : null;
                lastGroup = r.group;
                return (
                  <li key={r.key} role="presentation">
                    {header && (
                      <div className="palette-group" role="presentation">
                        {header}
                      </div>
                    )}
                    <div
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === active}
                      className="palette-option"
                      onMouseMove={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => go(r)}
                    >
                      <span className="palette-option-main">
                        <span className="palette-option-title">
                          {r.code && (
                            <bdi className="palette-code" dir="ltr">
                              {r.code}
                            </bdi>
                          )}
                          {r.title}
                        </span>
                        {r.meta && <span className="palette-option-meta">{r.meta}</span>}
                      </span>
                      {r.badge && <span className="badge">{r.badge}</span>}
                      <span className="palette-enter" aria-hidden="true">
                        ↵
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>

            {term.length >= 2 && !loading && results.every((r) => r.group === 'الصفحات') && (
              <p className="palette-empty">لا توجد أصول أو محاضر تطابق «{term}».</p>
            )}
            <div className="palette-foot" aria-hidden="true">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> للتنقل
              </span>
              <span>
                <kbd>↵</kbd> للفتح
              </span>
              <span>
                <kbd>Esc</kbd> للإغلاق
              </span>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
