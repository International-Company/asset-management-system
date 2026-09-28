import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { deleteUnlessInUse } from '../../common/errors/in-use';
import { orderBy, paging } from '../../common/pagination';
import { AuditActor, AuditService } from '../audit/audit.service';
import {
  ExternalPersonDto,
  MaintenanceProviderDto,
  ReferenceListQueryDto,
  UpdateExternalPersonDto,
  UpdateMaintenanceProviderDto,
} from './reference.dto';

/**
 * External responsible people (spec §13) and external maintenance
 * technicians/companies (spec §31, managed in Settings §64).
 */
@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── External people ───────────────────────────────────────────────────

  async listExternal(query: ReferenceListQueryDto) {
    const { skip, take, page, pageSize } = paging(query);
    const where: Prisma.ExternalPersonWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { organization: { contains: query.q, mode: 'insensitive' } },
              { phone: { contains: query.q } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.externalPerson.findMany({
        where,
        skip,
        take,
        orderBy: orderBy<Prisma.ExternalPersonOrderByWithRelationInput>(
          query,
          { name: (d) => ({ name: d }), organization: (d) => ({ organization: d }), createdAt: (d) => ({ createdAt: d }) },
          'name',
        ),
        include: { _count: { select: { responsibleFor: true } } },
      }),
      this.prisma.externalPerson.count({ where }),
    ]);
    return { items: items.map(({ _count, ...p }) => ({ ...p, assetCount: _count.responsibleFor })), total, page, pageSize };
  }

  async createExternal(dto: ExternalPersonDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const row = await tx.externalPerson.create({ data: dto });
      await this.audit.record({ actor, operation: 'EXTERNAL_PERSON_CREATED', entityType: 'ExternalPerson', entityId: row.id, newData: row }, tx);
      return row;
    });
  }

  async updateExternal(id: string, dto: UpdateExternalPersonDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const before = await tx.externalPerson.findUnique({ where: { id } });
      if (!before) throw AppError.notFound('الشخص غير موجود.');
      const after = await tx.externalPerson.update({ where: { id }, data: dto });
      const changes = AuditService.diff(before, after);
      delete changes.updatedAt;
      await this.audit.record({ actor, operation: 'EXTERNAL_PERSON_UPDATED', entityType: 'ExternalPerson', entityId: id, newData: changes }, tx);
      return after;
    });
  }

  async removeExternal(id: string, actor: AuditActor): Promise<void> {
    await deleteUnlessInUse(
      () =>
        this.prisma.transaction(async (tx) => {
          const before = await tx.externalPerson.findUnique({ where: { id } });
          if (!before) throw AppError.notFound('الشخص غير موجود.');
          await tx.externalPerson.delete({ where: { id } });
          await this.audit.record({ actor, operation: 'EXTERNAL_PERSON_DELETED', entityType: 'ExternalPerson', entityId: id, oldData: before }, tx);
        }),
      'الشخص',
    );
  }

  // ── Maintenance providers ─────────────────────────────────────────────

  async listProviders(query: ReferenceListQueryDto) {
    const { skip, take, page, pageSize } = paging(query);
    const where: Prisma.MaintenanceProviderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.maintenanceProvider.findMany({
        where,
        skip,
        take,
        orderBy: orderBy<Prisma.MaintenanceProviderOrderByWithRelationInput>(
          query,
          { name: (d) => ({ name: d }), type: (d) => ({ type: d }), createdAt: (d) => ({ createdAt: d }) },
          'name',
        ),
      }),
      this.prisma.maintenanceProvider.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async createProvider(dto: MaintenanceProviderDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const row = await tx.maintenanceProvider.create({ data: dto });
      await this.audit.record({ actor, operation: 'MAINTENANCE_PROVIDER_CREATED', entityType: 'MaintenanceProvider', entityId: row.id, newData: row }, tx);
      return row;
    });
  }

  async updateProvider(id: string, dto: UpdateMaintenanceProviderDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const before = await tx.maintenanceProvider.findUnique({ where: { id } });
      if (!before) throw AppError.notFound('مزود الصيانة غير موجود.');
      const after = await tx.maintenanceProvider.update({ where: { id }, data: dto });
      const changes = AuditService.diff(before, after);
      delete changes.updatedAt;
      await this.audit.record({ actor, operation: 'MAINTENANCE_PROVIDER_UPDATED', entityType: 'MaintenanceProvider', entityId: id, newData: changes }, tx);
      return after;
    });
  }

  async removeProvider(id: string, actor: AuditActor): Promise<void> {
    await deleteUnlessInUse(
      () =>
        this.prisma.transaction(async (tx) => {
          const before = await tx.maintenanceProvider.findUnique({ where: { id } });
          if (!before) throw AppError.notFound('مزود الصيانة غير موجود.');
          await tx.maintenanceProvider.delete({ where: { id } });
          await this.audit.record({ actor, operation: 'MAINTENANCE_PROVIDER_DELETED', entityType: 'MaintenanceProvider', entityId: id, oldData: before }, tx);
        }),
      'مزود الصيانة',
    );
  }
}
