import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { PERMISSIONS, type PermissionKey } from '@osooli/shared';
import { fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useOnline, useSidebarCollapsed, useTheme } from '../lib/preferences';
import { useUnreadCount } from '../pages/NotificationsPage';
import { useQueueCounts } from '../pages/offline/OfflinePages';
import { useAutoSync } from '../offline/sync';
import { ConfirmDialog, Modal } from './Modal';

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
        <nav>
          {sections.map((section) => (
            <ul className="nav" key={section.title}>
              <li className="nav-section">{section.title}</li>
              {section.items.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.to === '/'} title={item.label}>
                    <span className="nav-abbr" aria-hidden="true">
                      {item.abbr}
                    </span>
                    <span className="nav-label">{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          ))}
        </nav>
        {/* On phones the theme toggle lives in the drawer to keep the top bar on one line. */}
        <button type="button" className="btn sidebar-theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? 'المظهر الفاتح' : 'المظهر الداكن'}
        </button>
      </aside>
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}

      <header className="topbar">
        <button
          type="button"
          className="btn"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'توسيع القائمة' : 'طي القائمة'}
          aria-expanded={!collapsed || drawerOpen}
        >
          القائمة
        </button>
        <span className="company">{me?.company.nameAr}</span>
        <span className="spacer" />
        <button
          type="button"
          className="btn topbar-theme"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="تبديل المظهر"
        >
          <span className="label-long">{theme === 'dark' ? 'المظهر الفاتح' : 'المظهر الداكن'}</span>
          <span className="label-short">{theme === 'dark' ? 'فاتح' : 'داكن'}</span>
        </button>
        <Link className="btn" to="/notifications" aria-label={unreadCount ? `الإشعارات: ${unreadCount} غير مقروء` : 'الإشعارات'}>
          <span className="label-long">الإشعارات</span>
          <span className="label-short">إشعارات</span>
          {unreadCount > 0 && <span className="badge badge-danger">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </Link>
        {(unsynced > 0 || !online) && (
          <Link
            className="btn topbar-sync"
            to="/offline"
            aria-label={queue.review ? `المزامنة: ${queue.pending} بانتظار المزامنة، ${queue.review} تحتاج مراجعة` : `المزامنة: ${queue.pending} بانتظار المزامنة`}
          >
            <span className="label-long">بانتظار المزامنة</span>
            <span className="label-short">مزامنة</span>
            <span className="badge badge-warning">{queue.pending}</span>
            {queue.review > 0 && <span className="badge badge-danger">{queue.review}</span>}
          </Link>
        )}
        <span className="user-name">{me?.fullName}</span>
        <button type="button" className="btn" onClick={requestLogout} aria-label="تسجيل الخروج">
          <span className="label-long">تسجيل الخروج</span>
          <span className="label-short">خروج</span>
        </button>
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
