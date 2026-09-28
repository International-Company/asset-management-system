import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { PermissionKey } from '@osooli/shared';
import { useAuth } from '../lib/auth';
import { Loading } from './States';
import { ForbiddenPage } from '../pages/ErrorPages';

/** Redirects to /login when signed out. UI-only convenience: the API enforces access. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function RequirePermission({ permission, children }: { permission: PermissionKey; children: ReactNode }) {
  const { can } = useAuth();
  return can(permission) ? <>{children}</> : <ForbiddenPage />;
}
