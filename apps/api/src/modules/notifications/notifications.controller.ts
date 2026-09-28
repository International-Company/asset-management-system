import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { PERMISSIONS } from '@osooli/shared';
import { Prisma } from '../../generated/prisma/client';
import { AnyAuthenticated, CurrentUser, RequirePermissions } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import { ListQueryDto, paging } from '../../common/pagination';
import { actorOf, RequestUser } from '../../common/request-user';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const flag = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

class NotificationQueryDto extends ListQueryDto {
  @IsOptional()
  @Transform(flag)
  @IsBoolean()
  unread?: boolean;

  /** System-wide view for users with notifications.view_all (spec §39). */
  @IsOptional()
  @Transform(flag)
  @IsBoolean()
  all?: boolean;
}

class ToggleTypeDto {
  @IsBoolean()
  isEnabled: boolean;
}

class RecipientsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  roleIds: string[];

  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  userIds: string[];

  @IsBoolean()
  targetResponsible: boolean;
}

const uuid = new ParseUUIDPipe();

/**
 * Notification inbox (spec §39). Users can read and mark notifications as
 * read but never delete them (no endpoint; a DB trigger blocks deletion).
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @AnyAuthenticated()
  @Get()
  async list(@Query() q: NotificationQueryDto, @CurrentUser() user: RequestUser) {
    if (q.all && !user.permissions.has(PERMISSIONS.NOTIFICATIONS_VIEW_ALL)) throw new AppError('FORBIDDEN');
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.NotificationWhereInput = {
      ...(q.all ? {} : { userId: user.id }),
      ...(q.unread ? { readAt: null } : {}),
      ...(q.q ? { title: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { type: { select: { label: true } }, ...(q.all ? { user: { select: { username: true, employee: { select: { fullName: true } } } } } : {}) },
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  @AnyAuthenticated()
  @Get('unread-count')
  async unreadCount(@CurrentUser() user: RequestUser) {
    return { count: await this.prisma.notification.count({ where: { userId: user.id, readAt: null } }) };
  }

  @AnyAuthenticated()
  @Post(':id/read')
  @HttpCode(200)
  async read(@Param('id', uuid) id: string, @CurrentUser() user: RequestUser) {
    const result = await this.prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    if (result.count === 0 && !(await this.prisma.notification.count({ where: { id, userId: user.id } }))) {
      throw AppError.notFound('الإشعار غير موجود.');
    }
    return { ok: true };
  }

  @AnyAuthenticated()
  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: RequestUser) {
    const result = await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: result.count };
  }
}

/** Notification types, enable/disable and recipients (spec §39, §64). System Administrator only. */
@RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
@Controller('notification-types')
export class NotificationTypesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const types = await this.prisma.notificationType.findMany({
      orderBy: { key: 'asc' },
      include: { recipients: { include: { role: { select: { id: true, name: true } } } } },
    });
    const userIds = types.flatMap((t) => t.recipients.map((r) => r.userId)).filter((x): x is string => !!x);
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, employee: { select: { fullName: true } } } });
    return types.map((t) => ({
      key: t.key,
      label: t.label,
      isEnabled: t.isEnabled,
      targetResponsible: t.recipients.some((r) => r.targetResponsible),
      roles: t.recipients.flatMap((r) => (r.role ? [r.role] : [])),
      users: t.recipients.flatMap((r) => {
        const u = r.userId ? users.find((x) => x.id === r.userId) : null;
        return u ? [{ id: u.id, username: u.username, fullName: u.employee.fullName }] : [];
      }),
    }));
  }

  @Patch(':key')
  async toggle(@Param('key') key: string, @Body() dto: ToggleTypeDto, @CurrentUser() user: RequestUser) {
    return this.prisma.transaction(async (tx) => {
      const before = await tx.notificationType.findUnique({ where: { key } });
      if (!before) throw AppError.notFound('نوع الإشعار غير موجود.');
      const after = await tx.notificationType.update({ where: { key }, data: { isEnabled: dto.isEnabled } });
      await this.audit.record(
        { actor: actorOf(user), operation: 'NOTIFICATION_TYPE_UPDATED', entityType: 'NotificationType', entityId: key, oldData: { isEnabled: before.isEnabled }, newData: { isEnabled: after.isEnabled } },
        tx,
      );
      return after;
    });
  }

  @Put(':key/recipients')
  async recipients(@Param('key') key: string, @Body() dto: RecipientsDto, @CurrentUser() user: RequestUser) {
    return this.prisma.transaction(async (tx) => {
      const type = await tx.notificationType.findUnique({ where: { key }, include: { recipients: true } });
      if (!type) throw AppError.notFound('نوع الإشعار غير موجود.');
      if ((await tx.role.count({ where: { id: { in: dto.roleIds } } })) !== dto.roleIds.length) throw AppError.validation({ roleIds: ['أحد الأدوار غير موجود.'] });
      if ((await tx.user.count({ where: { id: { in: dto.userIds } } })) !== dto.userIds.length) throw AppError.validation({ userIds: ['أحد المستخدمين غير موجود.'] });
      await tx.notificationRecipient.deleteMany({ where: { typeKey: key } });
      await tx.notificationRecipient.createMany({
        data: [
          ...dto.roleIds.map((roleId) => ({ typeKey: key, roleId })),
          ...dto.userIds.map((userId) => ({ typeKey: key, userId })),
          ...(dto.targetResponsible ? [{ typeKey: key, targetResponsible: true }] : []),
        ],
      });
      await this.audit.record(
        {
          actor: actorOf(user),
          operation: 'NOTIFICATION_RECIPIENTS_CHANGED',
          entityType: 'NotificationType',
          entityId: key,
          oldData: { recipients: type.recipients.map((r) => ({ roleId: r.roleId, userId: r.userId, targetResponsible: r.targetResponsible })) },
          newData: dto,
        },
        tx,
      );
      return { key };
    });
  }
}
