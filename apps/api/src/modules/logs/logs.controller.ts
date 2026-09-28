import { Controller, Get, Query } from '@nestjs/common';
import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PERMISSIONS } from '@osooli/shared';
import { Prisma, SecurityEventType } from '../../generated/prisma/client';
import { RequirePermissions } from '../../common/decorators';
import { ListQueryDto, paging } from '../../common/pagination';
import { toJsonSafe } from '../../common/redact';
import { PrismaService } from '../../prisma/prisma.service';

class LogRangeDto extends ListQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

class AuditQueryDto extends LogRangeDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  entityType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  operation?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;
}

class SecurityQueryDto extends LogRangeDto {
  @IsOptional()
  @IsEnum(SecurityEventType)
  type?: SecurityEventType;

  @IsOptional()
  @IsUUID()
  userId?: string;
}

function range(q: LogRangeDto) {
  if (!q.from && !q.to) return undefined;
  return { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
}

/**
 * Read-only viewers. The underlying tables are append-only in PostgreSQL,
 * so there is intentionally no write endpoint of any kind.
 */
@Controller()
export class LogsController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  @Get('audit')
  async audit(@Query() q: AuditQueryDto) {
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.operation ? { operation: q.operation } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(range(q) ? { createdAt: range(q) } : {}),
      ...(q.q
        ? {
            OR: [
              { actorName: { contains: q.q, mode: 'insensitive' } },
              { entityId: { contains: q.q, mode: 'insensitive' } },
              { operation: { contains: q.q.toUpperCase() } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, skip, take, orderBy: { id: q.order === 'asc' ? 'asc' : 'desc' } }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items: toJsonSafe(items), total, page, pageSize };
  }

  /** Distinct values for the audit filter drop-downs. */
  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  @Get('audit/facets')
  async auditFacets() {
    const [entityTypes, operations] = await Promise.all([
      this.prisma.auditLog.findMany({ distinct: ['entityType'], select: { entityType: true }, orderBy: { entityType: 'asc' } }),
      this.prisma.auditLog.findMany({ distinct: ['operation'], select: { operation: true }, orderBy: { operation: 'asc' } }),
    ]);
    return { entityTypes: entityTypes.map((e) => e.entityType), operations: operations.map((o) => o.operation) };
  }

  @RequirePermissions(PERMISSIONS.SECURITY_VIEW)
  @Get('security/logs')
  async security(@Query() q: SecurityQueryDto) {
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.SecurityLogWhereInput = {
      ...(q.type ? { type: q.type } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(range(q) ? { createdAt: range(q) } : {}),
      ...(q.q ? { OR: [{ username: { contains: q.q, mode: 'insensitive' } }, { ip: { contains: q.q } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.securityLog.findMany({ where, skip, take, orderBy: { id: q.order === 'asc' ? 'asc' : 'desc' } }),
      this.prisma.securityLog.count({ where }),
    ]);
    return { items: toJsonSafe(items), total, page, pageSize };
  }
}
