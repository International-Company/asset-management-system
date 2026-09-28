import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, Tx } from '../../prisma/prisma.service';

export interface NotifyInput {
  typeKey: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  /** Users who are "the responsible person" for recipient rules with targetResponsible. */
  responsibleUserIds?: string[];
}

/**
 * Creates notifications for the recipients configured on a notification
 * type (spec §39). Disabled types send nothing. The notifications inbox and
 * recipient management UI arrive with the Notifications module.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async notify(input: NotifyInput, tx?: Tx): Promise<number> {
    const db = tx ?? this.prisma;
    const type = await db.notificationType.findUnique({
      where: { key: input.typeKey },
      include: { recipients: true },
    });
    if (!type) {
      this.logger.error(`Unknown notification type ${input.typeKey}`);
      return 0;
    }
    if (!type.isEnabled) return 0;

    const recipients = new Set<string>();
    const roleIds = type.recipients.flatMap((r) => (r.roleId ? [r.roleId] : []));
    if (roleIds.length) {
      const members = await db.userRole.findMany({
        where: { roleId: { in: roleIds }, role: { status: 'ACTIVE' }, user: { isActive: true } },
        select: { userId: true },
      });
      members.forEach((m) => recipients.add(m.userId));
    }
    type.recipients.forEach((r) => r.userId && recipients.add(r.userId));
    if (type.recipients.some((r) => r.targetResponsible)) {
      input.responsibleUserIds?.forEach((id) => recipients.add(id));
    }
    if (recipients.size === 0) return 0;

    const result = await db.notification.createMany({
      data: [...recipients].map((userId) => ({
        userId,
        typeKey: input.typeKey,
        title: input.title,
        body: input.body ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
      })),
    });
    return result.count;
  }
}
