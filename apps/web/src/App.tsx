import { Component, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { PERMISSIONS, type PermissionKey } from '@osooli/shared';
import { AppShell } from './components/AppShell';
import { RequireAuth, RequirePermission } from './components/RouteGuards';
import { DashboardPage } from './pages/DashboardPage';
import { NotFoundPage, ServerErrorPage } from './pages/ErrorPages';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { MySessionsPage } from './pages/MySessionsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { OfflineCenterPage, OfflineInventoryPage, OfflineLookupPage } from './pages/offline/OfflinePages';
import { ReportPage, ReportsPage } from './pages/reports/ReportsPages';
import { CategoriesPage } from './pages/admin/CategoriesPage';
import { ExternalPeoplePage } from './pages/admin/ExternalPeoplePage';
import { LocationsPage } from './pages/admin/LocationsPage';
import { AuditLogPage, SecurityLogPage } from './pages/admin/LogsPages';
import { RolesPage } from './pages/admin/RolesPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { UserDetailPage } from './pages/admin/UserDetailPage';
import { UsersPage } from './pages/admin/UsersPage';
import { AssetDetailPage } from './pages/assets/AssetDetailPage';
import { AssetEditPage, AssetNewPage, QrResolvePage } from './pages/assets/AssetFormPages';
import { AssetsListPage } from './pages/assets/AssetsListPage';
import { InventoryDetailPage, InventoryListPage, InventoryNewPage } from './pages/inventory/InventoryPages';
import { CustodyDetailPage, CustodyListPage, CustodyNewPage } from './pages/operations/CustodyPages';
import { MaintenanceDetailPage, MaintenanceListPage, MaintenanceNewPage } from './pages/operations/MaintenancePages';
import {
  ReturnDetailPage,
  ReturnListPage,
  ReturnNewPage,
  SaleDetailPage,
  SaleListPage,
  SaleNewPage,
  TransferListPage,
} from './pages/operations/ReturnTransferSalePages';

/** Catches render errors so users see an Arabic message, never a stack trace. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <ServerErrorPage /> : this.props.children;
  }
}

/** Permission-gated routes: path, required permission, page. The API enforces the same rules. */
const GUARDED_ROUTES: Array<[string, PermissionKey, ReactNode]> = [
  ['assets', PERMISSIONS.ASSETS_VIEW, <AssetsListPage />],
  ['assets/new', PERMISSIONS.ASSETS_CREATE, <AssetNewPage />],
  ['assets/:id', PERMISSIONS.ASSETS_VIEW, <AssetDetailPage />],
  ['assets/:id/edit', PERMISSIONS.ASSETS_EDIT, <AssetEditPage />],
  ['qr/:token', PERMISSIONS.ASSETS_VIEW, <QrResolvePage />],
  ['transfers', PERMISSIONS.TRANSFERS_VIEW, <TransferListPage />],
  ['custodies', PERMISSIONS.CUSTODY_VIEW, <CustodyListPage />],
  ['custodies/new', PERMISSIONS.CUSTODY_CREATE, <CustodyNewPage />],
  ['custody-returns', PERMISSIONS.CUSTODY_VIEW, <ReturnListPage />],
  ['custody-returns/new', PERMISSIONS.CUSTODY_RETURNS_CREATE, <ReturnNewPage />],
  ['maintenances', PERMISSIONS.MAINTENANCE_VIEW, <MaintenanceListPage />],
  ['maintenances/new', PERMISSIONS.MAINTENANCE_MANAGE, <MaintenanceNewPage />],
  ['maintenances/:id', PERMISSIONS.MAINTENANCE_VIEW, <MaintenanceDetailPage />],
  ['sales', PERMISSIONS.SALES_VIEW, <SaleListPage />],
  ['sales/new', PERMISSIONS.SALES_CREATE, <SaleNewPage />],
  ['sales/:id', PERMISSIONS.SALES_VIEW, <SaleDetailPage />],
  ['inventories', PERMISSIONS.INVENTORY_VIEW, <InventoryListPage />],
  ['inventories/new', PERMISSIONS.INVENTORY_MANAGE, <InventoryNewPage />],
  ['inventories/:id', PERMISSIONS.INVENTORY_VIEW, <InventoryDetailPage />],
  ['offline/lookup', PERMISSIONS.ASSETS_VIEW, <OfflineLookupPage />],
  ['offline/inventories/:id', PERMISSIONS.INVENTORY_MANAGE, <OfflineInventoryPage />],
  ['reports', PERMISSIONS.REPORTS_VIEW, <ReportsPage />],
  ['reports/:key', PERMISSIONS.REPORTS_VIEW, <ReportPage />],
  ['admin/users', PERMISSIONS.USERS_VIEW, <UsersPage />],
  ['admin/users/:id', PERMISSIONS.USERS_VIEW, <UserDetailPage />],
  ['admin/roles', PERMISSIONS.ROLES_MANAGE, <RolesPage />],
  ['admin/categories', PERMISSIONS.CATEGORIES_MANAGE, <CategoriesPage />],
  ['admin/locations', PERMISSIONS.LOCATIONS_MANAGE, <LocationsPage />],
  ['admin/external-people', PERMISSIONS.EXTERNAL_PEOPLE_VIEW, <ExternalPeoplePage />],
  ['admin/settings', PERMISSIONS.SETTINGS_MANAGE, <SettingsPage />],
  ['admin/audit', PERMISSIONS.AUDIT_VIEW, <AuditLogPage />],
  ['admin/security-log', PERMISSIONS.SECURITY_VIEW, <SecurityLogPage />],
];

export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<HomePage />} />
          <Route
            path="dashboard"
            element={
              <RequirePermission permission={PERMISSIONS.DASHBOARD_VIEW}>
                <DashboardPage />
              </RequirePermission>
            }
          />
          {GUARDED_ROUTES.map(([path, permission, page]) => (
            <Route key={path} path={path} element={<RequirePermission permission={permission}>{page}</RequirePermission>} />
          ))}
          {/* Parties to a custody or return may open it without custody permissions; the API decides. */}
          <Route path="custodies/:id" element={<CustodyDetailPage />} />
          <Route path="custody-returns/:id" element={<ReturnDetailPage />} />
          <Route path="offline" element={<OfflineCenterPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="account/sessions" element={<MySessionsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
