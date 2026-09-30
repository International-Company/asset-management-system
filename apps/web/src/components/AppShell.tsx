import { useEffect, useId, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { PERMISSIONS, type PermissionKey } from '@osooli/shared';
import { fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useMediaQuery, useNavGroups, useOnline, useSidebarCollapsed, useTheme } from '../lib/preferences';
import { useUnreadCount } from '../pages/NotificationsPage';
import { useQueueCounts } from '../pages/offline/OfflinePages';
import { useAutoSync } from '../offline/sync';
import { ConfirmDialog, Modal } from './Modal';
import { MenuIcon, NotificationsMenu, UserMenu } from './TopbarMenus';

interface NavItem {
  to: string;
  label: string;
  /** Short text shown when the sidebar is collapsed (text-first, no icons). */
  abbr: string;
  permission?: PermissionKey;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

/** Navigation grows with each phase; items are hidden without permission. */
export const NAV: NavSection[] = [
  {
    title: 'عام',
    items: [
      { to: '/', label: 'الرئيسية', abbr: 'ر' },
      { to: '/assets', label: 'الأصول', abbr: 'أ', permission: PERMISSIONS.ASSETS_VIEW },
      { to: '/offline', label: 'العمل بدون اتصال', abbr: 'غ' },
    ],
  },
  {
    title: 'العمليات',
    items: [
      { to: '/custodies', label: 'محاضر العهدة', abbr: 'ع', permission: PERMISSIONS.CUSTODY_VIEW },
      { to: '/custody-returns', label: 'محاضر الإرجاع', abbr: 'ج', permission: PERMISSIONS.CUSTODY_VIEW },
      { to: '/transfers', label: 'النقل', abbr: 'ن', permission: PERMISSIONS.TRANSFERS_VIEW },
      { to: '/inventories', label: 'الجرد', abbr: 'د', permission: PERMISSIONS.INVENTORY_VIEW },
      { to: '/maintenances', label: 'الصيانة', abbr: 'ص', permission: PERMISSIONS.MAINTENANCE_VIEW },
      { to: '/sales', label: 'المبيعات', abbr: 'ب', permission: PERMISSIONS.SALES_VIEW },
    ],
  },
  {
    title: 'التقارير',
    items: [{ to: '/reports', label: 'التقارير', abbr: 'ق', permission: PERMISSIONS.REPORTS_VIEW }],
  },
  {
    title: 'الإدارة',
    items: [
      { to: '/dashboard', label: 'لوحة التحكم', abbr: 'ت', permission: PERMISSIONS.DASHBOARD_VIEW },
      { to: '/admin/users', label: 'المستخدمون', abbr: 'م', permission: PERMISSIONS.USERS_VIEW },
      { to: '/admin/roles', label: 'الأدوار والصلاحيات', abbr: 'د', permission: PERMISSIONS.ROLES_MANAGE },
      { to: '/admin/categories', label: 'الفئات', abbr: 'ف', permission: PERMISSIONS.CATEGORIES_MANAGE },
      { to: '/admin/locations', label: 'المواقع والأقسام', abbr: 'و', permission: PERMISSIONS.LOCATIONS_MANAGE },
      { to: '/admin/external-people', label: 'المسؤولون الخارجيون', abbr: 'خ', permission: PERMISSIONS.EXTERNAL_PEOPLE_VIEW },
      { to: '/admin/settings', label: 'الإعدادات', abbr: 'إ', permission: PERMISSIONS.SETTINGS_MANAGE },
    ],
  },
  {
    title: 'السجلات',
    items: [
      { to: '/admin/audit', label: 'سجل التدقيق', abbr: 'س', permission: PERMISSIONS.AUDIT_VIEW },
      { to: '/admin/security-log', label: 'السجل الأمني', abbr: 'ن', permission: PERMISSIONS.SECURITY_VIEW },
    ],
  },
  {
    title: 'حسابي',
    items: [
      { to: '/notifications', label: 'الإشعارات', abbr: 'ش' },
      { to: '/account/sessions', label: 'جلساتي', abbr: 'ج' },
    ],
  },
];

function isActive(to: string, pathname: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
}

function NavItem({ item }: { item: NavItem }) {
  return (
    <li>
      <NavLink to={item.to} end={item.to === '/'} title={item.label}>
        <span className="nav-abbr" aria-hidden="true">
          {item.abbr}
        </span>
        <span className="nav-label">{item.label}</span>
      </NavLink>
    </li>
  );
}

/**
 * A sidebar group that folds open and closed. Closed items are `inert`: out of
 * the tab order and hidden from screen readers, not merely clipped.
 */
function NavGroup({ section, active, open, flat, onToggle }: { section: NavSection; active: boolean; open: boolean; flat: boolean; onToggle: (open: boolean) => void }) {
  const id = useId();
  return (
    <div className="nav-group" data-open={open}>
      <button type="button" className="nav-group-toggle" aria-expanded={open} aria-controls={id} onClick={() => onToggle(!open)}>
        <span className="nav-group-title">{section.title}</span>
        {active && !open && <span className="nav-group-dot" aria-label="تحتوي الصفحة الحالية" />}
        <span className="nav-group-chevron" aria-hidden="true" />
      </button>
      <div className="nav-group-body" id={id} inert={!open && !flat}>
        <ul className="nav-list">
          {section.items.map((item) => (
            <NavItem key={item.to} item={item} />
          ))}
        </ul>
      </div>
    </div>
  );
}

export function AppShell() {
  const { me, can, logout } = useAuth();
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const [theme, setTheme] = useTheme();
  // The mobile drawer stays open only on the page where it was opened, so
  // navigating closes it without an effect.
  const [drawerOpenedAt, setDrawerOpenedAt] = useState<string | null>(null);
  const online = useOnline();
  const unread = useUnreadCount();
  const unreadCount = unread.data?.count ?? 0;
  const location = useLocation();
  const [isGroupOpen, setGroupOpen] = useNavGroups();
  const narrow = useMediaQuery('(max-width: 900px)');
  // Collapsed desktop sidebar lists every item as a shortcut, without groups.
  const flatNav = collapsed && !narrow;
  // Opening a page from elsewhere (a link, the address bar) opens its group.
  useEffect(() => {
    const group = NAV.find((s) => s.items.length > 1 && s.items.some((i) => isActive(i.to, location.pathname)));
    if (group) setGroupOpen(group.title, true);
  }, [location.pathname, setGroupOpen]);
  useAutoSync(me?.id);
  const queue = useQueueCounts();
  const unsynced = queue.pending + queue.review;
  const [logoutDialog, setLogoutDialog] = useState<'offline' | 'pending' | null>(null);

  // Logging out needs the server (to end the session) and wipes this device's
  // offline data, so warn before losing operations that never synced.
  const requestLogout = () => {
    if (!online) setLogoutDialog('offline');
    else if (unsynced > 0) setLogoutDialog('pending');
    else void logout();
  };

  const drawerOpen = drawerOpenedAt === location.pathname;
  const setDrawerOpen = (open: boolean) => setDrawerOpenedAt(open ? location.pathname : null);

  const sections = NAV.map((s) => ({ ...s, items: s.items.filter((i) => !i.permission || can(i.permission)) })).filter(
    (s) => s.items.length > 0,
  );

  const toggleSidebar = () => {
    if (window.matchMedia('(max-width: 900px)').matches) setDrawerOpen(!drawerOpen);
    else setCollapsed(!collapsed);
  };

  return (
    <div className="shell" data-collapsed={collapsed} data-drawer-open={drawerOpen}>
      <aside className="sidebar" aria-label="القائمة الرئيسية">
        <div className="sidebar-brand">
          {me?.company.logoFileId && <img src={fileUrl(me.company.logoFileId)} alt="" className="brand-logo" />}
          <span>نظام إدارة الأصول</span>
        </div>
        <nav className="nav">
          {sections.map((section) =>
            section.items.length === 1 ? (
              // A one-item group is just a link; a toggle around it would only add a click.
              <ul className="nav-list nav-single" key={section.title}>
                <NavItem item={section.items[0]} />
              </ul>
            ) : (
              <NavGroup
                key={section.title}
                section={section}
                active={section.items.some((i) => isActive(i.to, location.pathname))}
                open={isGroupOpen(section.title, section.items.some((i) => isActive(i.to, location.pathname)))}
                flat={flatNav}
                onToggle={(open) => setGroupOpen(section.title, open)}
              />
            ),
          )}
        </nav>
      </aside>
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}

      <header className="topbar">
        <button
          type="button"
          className="icon-btn"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'توسيع القائمة' : 'طي القائمة'}
          aria-expanded={!collapsed || drawerOpen}
        >
          <MenuIcon />
        </button>
        <span className="company">{me?.company.nameAr}</span>
        <span className="spacer" />
        {(unsynced > 0 || !online) && (
          <Link
            className="topbar-chip"
            to="/offline"
            aria-label={queue.review ? `المزامنة: ${queue.pending} بانتظار المزامنة، ${queue.review} تحتاج مراجعة` : `المزامنة: ${queue.pending} بانتظار المزامنة`}
          >
            <span className="label-long">بانتظار المزامنة</span>
            <span className="badge badge-warning">{queue.pending}</span>
            {queue.review > 0 && <span className="badge badge-danger">{queue.review}</span>}
          </Link>
        )}
        <NotificationsMenu unread={unreadCount} />
        <span className="topbar-divider" aria-hidden="true" />
        {me && <UserMenu me={me} theme={theme} onTheme={setTheme} onLogout={requestLogout} />}
      </header>

      <main className="content">
        {!online && (
          <div className="offline-banner" role="status">
            أنت غير متصل بالشبكة. العمليات الحساسة تتطلب اتصالًا. <Link to="/offline">العمل بدون اتصال</Link>
          </div>
        )}
        <Outlet />
      </main>

      <Modal open={logoutDialog === 'offline'} title="تسجيل الخروج" onClose={() => setLogoutDialog(null)}>
        <p>تسجيل الخروج يتطلب اتصالًا بالشبكة لإنهاء الجلسة على الخادم. أعد المحاولة عند عودة الاتصال.</p>
      </Modal>
      <ConfirmDialog
        open={logoutDialog === 'pending'}
        title="عمليات لم تُزامن"
        message={`توجد ${unsynced} عملية على هذا الجهاز لم تصل إلى الخادم (${queue.pending} بانتظار المزامنة، ${queue.review} تحتاج مراجعة). تسجيل الخروج يحذفها نهائيًا من الجهاز.`}
        confirmLabel="تسجيل الخروج وحذفها"
        danger
        onConfirm={() => {
          setLogoutDialog(null);
          void logout();
        }}
        onClose={() => setLogoutDialog(null)}
      />
    </div>
  );
}
