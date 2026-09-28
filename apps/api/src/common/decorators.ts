import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@osooli/shared';
import type { AuthenticatedRequest, RequestUser } from './request-user';

export const IS_PUBLIC = 'osooli:isPublic';
export const PERMISSIONS_KEY = 'osooli:permissions';
export const ANY_AUTHENTICATED = 'osooli:anyAuthenticated';

/** No authentication required (health liveness, login steps). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Requires ALL listed permissions. Endpoints without @RequirePermissions,
 * @AnyAuthenticated or @Public are denied (fail-closed).
 */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const ANY_PERMISSION_KEY = 'osooli:anyPermission';

/** Requires AT LEAST ONE of the listed permissions (e.g. employee lookup used by several screens). */
export const RequireAnyPermission = (...permissions: PermissionKey[]) =>
  SetMetadata(ANY_PERMISSION_KEY, permissions);

/** Any signed-in user may call this endpoint (e.g. own profile, own sessions). */
export const AnyAuthenticated = () => SetMetadata(ANY_AUTHENTICATED, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    return ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  },
);
