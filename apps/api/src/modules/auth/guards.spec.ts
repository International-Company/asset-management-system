import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS, PermissionKey } from '@osooli/shared';
import { AnyAuthenticated, Public, RequirePermissions } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import { PermissionsGuard } from './guards';

class Endpoints {
  @RequirePermissions(PERMISSIONS.ASSETS_VIEW, PERMISSIONS.ASSETS_EDIT)
  edit() {}

  @AnyAuthenticated()
  me() {}

  @Public()
  health() {}

  undeclared() {}
}

function ctx(handler: keyof Endpoints, permissions: PermissionKey[]): ExecutionContext {
  return {
    getHandler: () => Endpoints.prototype[handler],
    getClass: () => Endpoints,
    switchToHttp: () => ({ getRequest: () => ({ user: { permissions: new Set(permissions) } }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('allows when the user holds every required permission', () => {
    expect(guard.canActivate(ctx('edit', [PERMISSIONS.ASSETS_VIEW, PERMISSIONS.ASSETS_EDIT]))).toBe(true);
  });

  it('denies with FORBIDDEN when any required permission is missing', () => {
    expect(() => guard.canActivate(ctx('edit', [PERMISSIONS.ASSETS_VIEW]))).toThrow(AppError);
  });

  it('allows @AnyAuthenticated and @Public endpoints', () => {
    expect(guard.canActivate(ctx('me', []))).toBe(true);
    expect(guard.canActivate(ctx('health', []))).toBe(true);
  });

  it('is fail-closed for endpoints without an access policy', () => {
    expect(() => guard.canActivate(ctx('undeclared', Object.values(PERMISSIONS)))).toThrow(AppError);
  });
});
