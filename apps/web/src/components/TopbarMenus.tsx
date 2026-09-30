import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { SYSTEM_ROLES } from '@osooli/shared';
import { api } from '../lib/api';
import type { Me } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import type { Theme } from '../lib/preferences';
import { entityPath, UNREAD_KEY } from '../pages/NotificationsPage';

/* ── Icons: inline strokes in the text colour; no icon library. ─────────── */

const icon = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export const MenuIcon = () => (
  <svg {...icon}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);
const BellIcon = () => (
  <svg {...icon} width={20} height={20}>
    <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);
const ChevronIcon = () => (
  <svg {...icon} width={14} height={14}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
const DevicesIcon = () => (
  <svg {...icon}>
    <rect x="3" y="4" width="13" height="10" rx="1.5" />
    <path d="M7 18h5" />
    <rect x="17" y="9" width="4" height="10" rx="1" />
  </svg>
);
const MoonIcon = () => (
  <svg {...icon}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </svg>
);
const SignOutIcon = () => (
  <svg {...icon}>
    <path d="M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4" />
    <path d="M14 8l-4 4 4 4M10 12h10" />
  </svg>
);

/* ── Shared open/close behaviour ─────────────────────────────────────────── */

/**
 * A popup anchored to its trigger: closes on an outside click, on Escape
 * (returning focus to the trigger) and when the page changes.
 */
function usePopup(): { open: boolean; setOpen: (v: boolean) => void; root: RefObject<HTMLDivElement | null>; trigger: RefObject<HTMLButtonElement | null> } {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  // Close when the page changes (a link inside the popup was followed).
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (open) setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, root, trigger };
}

/** Arrow keys, Home and End move between the menu's items (WAI-ARIA menu pattern). */
function onMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const go = (i: number) => {
    e.preventDefault();
    items[(i + items.length) % items.length]?.focus();
  };
  if (e.key === 'ArrowDown') go(at + 1);
  else if (e.key === 'ArrowUp') go(at - 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(items.length - 1);
}

/* ── User menu ───────────────────────────────────────────────────────────── */

const ROLE_LABELS: Record<string, string> = {
  [SYSTEM_ROLES.SYSTEM_ADMINISTRATOR]: 'مدير النظام',
  [SYSTEM_ROLES.ASSET_MANAGER]: 'مدير الأصول',
};

/** The first letters of the first two words: "عبدالله فرج" → "ع ف". */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join(' ');
}

export function UserMenu({ me, theme, onTheme, onLogout }: { me: Me; theme: Theme; onTheme: (t: Theme) => void; onLogout: () => void }) {
  const { open, setOpen, root, trigger } = usePopup();
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const role = me.roles.map((r) => ROLE_LABELS[r]).find(Boolean) ?? (me.roles.length ? 'مستخدم' : '');

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, [open]);

  return (
    <div className="popup-anchor" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="user-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`قائمة المستخدم: ${me.fullName}`}
        onClick={() => setOpen(!open)}
      >
        <span className="avatar" aria-hidden="true">
          {initials(me.fullName)}
        </span>
        <span className="user-meta" aria-hidden="true">
          <span className="user-meta-name">{me.fullName}</span>
          {role && <span className="user-meta-role">{role}</span>}
        </span>
        <span className="user-chevron">
          <ChevronIcon />
        </span>
      </button>
      {open && (
        <div ref={menu} id={menuId} className="popup menu" role="menu" aria-label="قائمة المستخدم" onKeyDown={onMenuKeyDown}>
          <div className="menu-header" role="none">
            <span className="avatar avatar-lg" aria-hidden="true">
              {initials(me.fullName)}
            </span>
            <span className="menu-header-text">
              <strong>{me.fullName}</strong>
              <span className="menu-header-sub">
                <bdi dir="ltr">{me.username}</bdi>
                {role && ` · ${role}`}
              </span>
            </span>
          </div>
          <div className="menu-separator" role="separator" />
          <Link role="menuitem" className="menu-item" to="/account/sessions">
            <DevicesIcon />
            <span>جلساتي وبصماتي</span>
          </Link>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={theme === 'dark'}
            className="menu-item"
            onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <MoonIcon />
            <span>المظهر الداكن</span>
            <span className="switch" aria-hidden="true" />
          </button>
          <div className="menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="menu-item menu-item-danger"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <SignOutIcon />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Notifications panel ─────────────────────────────────────────────────── */

interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

const LATEST_KEY = ['notifications', 'latest'] as const;

export function NotificationsMenu({ unread }: { unread: number }) {
  const { open, setOpen, root, trigger } = usePopup();
  const panelId = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const latest = useQuery({
    queryKey: LATEST_KEY,
    queryFn: () => api<{ items: NotificationRow[] }>('/notifications?page=1&pageSize=25'),
    enabled: open,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: UNREAD_KEY });
    void queryClient.invalidateQueries({ queryKey: LATEST_KEY });
    void queryClient.invalidateQueries({ queryKey: ['/notifications'] });
  };
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: refresh });
  const openOne = async (n: NotificationRow) => {
    setOpen(false);
    if (!n.readAt) await api(`/notifications/${n.id}/read`, { method: 'POST' }).then(refresh, () => undefined);
    navigate(entityPath(n.entityType, n.entityId) ?? '/notifications');
  };
  const items = (latest.data?.items ?? []).slice(0, 8);
  const label = unread ? `الإشعارات: ${unread} غير مقروء` : 'الإشعارات';

  return (
    <div className="popup-anchor" ref={root}>
      <button ref={trigger} type="button" className="icon-btn" aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        <BellIcon />
        {unread > 0 && (
          <span className="icon-btn-count" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div id={panelId} className="popup notif-panel" role="dialog" aria-label="الإشعارات">
          <div className="notif-head">
            <strong>الإشعارات</strong>
            {unread > 0 && (
              <button type="button" className="btn-link" disabled={readAll.isPending} onClick={() => readAll.mutate()}>
                تحديد الكل كمقروء
              </button>
            )}
          </div>
          <PanelBody loading={latest.isPending} empty={items.length === 0}>
            <ul className="notif-list">
              {items.map((n) => (
                <li key={n.id}>
                  <button type="button" className="notif-item" data-unread={!n.readAt} onClick={() => void openOne(n)}>
                    <span className="notif-dot" aria-hidden="true" />
                    <span className="notif-text">
                      <span className="notif-title">{n.title}</span>
                      {n.body && <span className="notif-body">{n.body}</span>}
                      <span className="notif-time">{formatDateTime(n.createdAt)}</span>
                    </span>
                    {!n.readAt && <span className="sr-only">غير مقروء</span>}
                  </button>
                </li>
              ))}
            </ul>
          </PanelBody>
          <Link className="notif-foot" to="/notifications">
            عرض كل الإشعارات
          </Link>
        </div>
      )}
    </div>
  );
}

function PanelBody({ loading, empty, children }: { loading: boolean; empty: boolean; children: ReactNode }) {
  if (loading) return <p className="notif-empty">جارٍ التحميل…</p>;
  if (empty) return <p className="notif-empty">لا توجد إشعارات.</p>;
  return <>{children}</>;
}
