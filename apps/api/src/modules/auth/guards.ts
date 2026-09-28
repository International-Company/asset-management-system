import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@osooli/shared';
import { ANY_AUTHENTICATED, ANY_PERMISSION_KEY, IS_PUBLIC, PERMISSIONS_KEY } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import type { AuthenticatedRequest } from '../../common/request-user';
import { SessionService } from './session.service';

export const SESSION_COOKIE = 'osooli_session';

/** Global guard #1: resolves the session cookie to req.user. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) {
      return true;
    }
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length === 0) throw new AppError('UNAUTHENTICATED');
    req.user = await this.sessions.authenticate(token);
    return true;
  }
}

/**
 * Global guard #2: authorization. Fail-closed — an endpoint must declare
 * @RequirePermissions, @AnyAuthenticated or @Public, otherwise it is denied.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(PERMISSIONS_KEY, targets);
    const anyAuthenticated = this.reflector.getAllAndOverride<boolean>(ANY_AUTHENTICATED, targets);
    const { user } = ctx.switchToHttp().getRequest<AuthenticatedRequest>();

    if (required?.length) {
      if (required.every((p) => user.permissions.has(p))) return true;
      throw new AppError('FORBIDDEN');
    }
    const anyOf = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(ANY_PERMISSION_KEY, targets);
    if (anyOf?.length) {
      if (anyOf.some((p) => user.permissions.has(p))) return true;
      throw new AppError('FORBIDDEN');
    }
    if (anyAuthenticated) return true;

    this.logger.error(`Endpoint without access policy denied: ${ctx.getClass().name}.${ctx.getHandler().name}`);
    throw new AppError('FORBIDDEN');
  }
}
