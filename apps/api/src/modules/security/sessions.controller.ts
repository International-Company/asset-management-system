import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PERMISSIONS } from '@osooli/shared';
import { AnyAuthenticated, CurrentUser, RequirePermissions } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import { clientInfo, RequestUser } from '../../common/request-user';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from '../auth/session.service';

const SESSION_FIELDS = {
  id: true,
  status: true,
  ip: true,
  device: true,
  browser: true,
  createdAt: true,
  lastSeenAt: true,
  expiresAt: true,
  endedAt: true,
} as const;

/** Login audit & session management (spec §49). */
@Controller('security/sessions')
export class SessionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  /** The signed-in user's recent sessions. */
  @AnyAuthenticated()
  @Get('mine')
  async mine(@CurrentUser() user: RequestUser) {
    const items = await this.prisma.session.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: SESSION_FIELDS,
    });
    return { items: items.map((s) => ({ ...s, current: s.id === user.sessionId })) };
  }

  @RequirePermissions(PERMISSIONS.SECURITY_VIEW)
  @Get()
  async list(@Query('status') status?: string) {
    const where = status === 'ACTIVE' ? { status: 'ACTIVE' as const } : {};
    const items = await this.prisma.session.findMany({
      where,
      orderBy: { lastSeenAt: 'desc' },
      take: 200,
      select: { ...SESSION_FIELDS, user: { select: { id: true, username: true, employee: { select: { fullName: true } } } } },
    });
    return { items };
  }

  @RequirePermissions(PERMISSIONS.SECURITY_MANAGE)
  @Post(':id/terminate')
  @HttpCode(200)
  async terminate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser, @Req() req: Request) {
    const ended = await this.sessions.end(id, 'TERMINATED', user.id, clientInfo(req));
    if (!ended) throw AppError.invalidState('الجلسة منتهية مسبقًا أو غير موجودة.');
    return { ok: true };
  }
}
