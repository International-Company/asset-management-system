import { createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PermissionKey } from '@osooli/shared';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { ClientInfo, RequestUser } from '../../common/request-user';
import { SettingsService } from '../settings/settings.service';
import { SecurityLogService } from '../security/security-log.service';

/** Avoid a write on every request: lastSeenAt is refreshed at most this often. */
const TOUCH_INTERVAL_MS = 60_000;

@Injectable()
export class SessionService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly securityLog: SecurityLogService,
  ) {}

  hashToken(token: string): string {
    return createHmac('sha256', this.env.ENCRYPTION_KEY).update(token).digest('hex');
  }

  async create(userId: string, client: ClientInfo, tx: Tx): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const maxHours = await this.settings.get('security.sessionMaxHours', tx);
    const expiresAt = new Date(Date.now() + maxHours * 3_600_000);
    const session = await tx.session.create({
      data: {
        userId,
        tokenHash: this.hashToken(token),
        ip: client.ip,
        userAgent: client.userAgent,
        device: client.device,
        browser: client.browser,
        expiresAt,
      },
    });
    return { token, sessionId: session.id, expiresAt };
  }

  /** Resolves a session token to the request user, enforcing idle and absolute timeouts. */
  async authenticate(token: string): Promise<RequestUser> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { user: { include: { employee: true } } },
    });
    if (!session || session.status !== 'ACTIVE') {
      throw new AppError(session ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED');
    }

    const now = Date.now();
    const idleMinutes = await this.settings.get('security.sessionIdleMinutes');
    const idleExpired = session.lastSeenAt.getTime() + idleMinutes * 60_000 < now;
    if (idleExpired || session.expiresAt.getTime() < now) {
      await this.end(session.id, 'EXPIRED', null);
      throw new AppError('SESSION_EXPIRED');
    }
    if (!session.user.isActive) {
      await this.end(session.id, 'TERMINATED', null);
      throw new AppError('UNAUTHENTICATED');
    }

    if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
    }

    const access = await this.loadAccess(session.userId);
    return {
      id: session.user.id,
      username: session.user.username,
      employeeId: session.user.employeeId,
      fullName: session.user.employee.fullName,
      sessionId: session.id,
      roleKeys: access.roleKeys,
      permissions: access.permissions,
    };
  }

  /** Effective permissions = union of all ACTIVE roles (spec §44). */
  async loadAccess(userId: string): Promise<{ roleKeys: string[]; permissions: Set<PermissionKey> }> {
    const assignments = await this.prisma.userRole.findMany({
      where: { userId, role: { status: 'ACTIVE' } },
      include: { role: { include: { permissions: true } } },
    });
    const permissions = new Set<PermissionKey>();
    for (const a of assignments) {
      for (const p of a.role.permissions) permissions.add(p.permissionKey as PermissionKey);
    }
    return { roleKeys: [...new Set(assignments.map((a) => a.role.key))], permissions };
  }

  /** Ends a session once; returns false if it was already ended. */
  async end(
    sessionId: string,
    status: 'LOGGED_OUT' | 'EXPIRED' | 'TERMINATED',
    actorId: string | null,
    client?: ClientInfo,
  ): Promise<boolean> {
    return this.prisma.transaction(async (tx) => {
      const result = await tx.session.updateMany({
        where: { id: sessionId, status: 'ACTIVE' },
        data: { status, endedAt: new Date(), terminatedById: status === 'TERMINATED' ? actorId : null },
      });
      if (result.count === 0) return false;
      const session = await tx.session.findUniqueOrThrow({ where: { id: sessionId } });
      await this.securityLog.record(
        {
          type: status === 'LOGGED_OUT' ? 'LOGOUT' : status === 'EXPIRED' ? 'SESSION_EXPIRED' : 'SESSION_TERMINATED',
          userId: session.userId,
          actorId,
          sessionId,
          client: client ?? null,
        },
        tx,
      );
      return true;
    });
  }
}
