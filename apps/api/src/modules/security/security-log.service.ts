import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SecurityEventType } from '../../generated/prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { redact, toJsonSafe } from '../../common/redact';
import type { ClientInfo } from '../../common/request-user';

export interface SecurityEvent {
  type: SecurityEventType;
  userId?: string | null;
  username?: string | null;
  actorId?: string | null;
  sessionId?: string | null;
  client?: ClientInfo | null;
  details?: Record<string, unknown>;
}

/** Append-only security log (spec §50). Never stores credentials or biometrics. */
@Injectable()
export class SecurityLogService {
  private readonly logger = new Logger(SecurityLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(event: SecurityEvent, tx?: Tx): Promise<void> {
    const client = tx ?? this.prisma;
    await client.securityLog.create({
      data: {
        type: event.type,
        userId: event.userId ?? null,
        username: event.username ?? null,
        actorId: event.actorId ?? null,
        sessionId: event.sessionId ?? null,
        ip: event.client?.ip ?? null,
        device: event.client?.device ?? null,
        browser: event.client?.browser ?? null,
        details: redact(toJsonSafe(event.details ?? {})) as Prisma.InputJsonValue,
      },
    });
    this.logger.log({ securityEvent: event.type, userId: event.userId, username: event.username });
  }
}
