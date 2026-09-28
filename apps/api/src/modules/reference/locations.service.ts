import { Injectable } from '@nestjs/common';
import { Prisma, RecordStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { deleteUnlessInUse } from '../../common/errors/in-use';
import { orderBy, Page, paging } from '../../common/pagination';
import { AuditActor, AuditService } from '../audit/audit.service';
import { ReferenceListQueryDto, UpdateNamedDto } from './reference.dto';

type Kind = 'location' | 'department';

const LABEL: Record<Kind, string> = { location: 'الموقع', department: 'القسم' };
const ENTITY: Record<Kind, string> = { location: 'Location', department: 'Department' };

/**
 * Locations, departments and their registered combinations (spec §12).
 * A department may appear in several locations; assets may only use a
 * registered, active combination.
 */
@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Locations & departments share the same shape ───────────────────────

  async list(kind: Kind, query: ReferenceListQueryDto): Promise<Page<unknown>> {
    const { skip, take, page, pageSize } = paging(query);
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };
    const order = orderBy<Prisma.LocationOrderByWithRelationInput>(
      query,
      { name: (d) => ({ name: d }), createdAt: (d) => ({ createdAt: d }), status: (d) => ({ status: d }) },
      'name',
    );
    if (kind === 'location') {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.location.findMany({
          where,
          orderBy: order,
          skip,
          take,
          include: {
            departments: { include: { department: { select: { id: true, name: true, status: true } } }, orderBy: { department: { name: 'asc' } } },
          },
        }),
        this.prisma.location.count({ where }),
      ]);
      return { items, total, page, pageSize };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.department.findMany({
        where,
        orderBy: order,
        skip,
        take,
        include: { locations: { include: { location: { select: { id: true, name: true, status: true } } } } },
      }),
      this.prisma.department.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async create(kind: Kind, name: string, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const row =
        kind === 'location' ? await tx.location.create({ data: { name } }) : await tx.department.create({ data: { name } });
      await this.audit.record({ actor, operation: `${ENTITY[kind].toUpperCase()}_CREATED`, entityType: ENTITY[kind], entityId: row.id, newData: row }, tx);
      return row;
    });
  }

  async update(kind: Kind, id: string, dto: UpdateNamedDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const before =
        kind === 'location' ? await tx.location.findUnique({ where: { id } }) : await tx.department.findUnique({ where: { id } });
      if (!before) throw AppError.notFound(`${LABEL[kind]} غير موجود.`);
      const data = { ...(dto.name !== undefined ? { name: dto.name } : {}), ...(dto.status ? { status: dto.status } : {}) };
      const after =
        kind === 'location'
          ? await tx.location.update({ where: { id }, data })
          : await tx.department.update({ where: { id }, data });
      await this.audit.record(
        {
          actor,
          operation: `${ENTITY[kind].toUpperCase()}_UPDATED`,
          entityType: ENTITY[kind],
          entityId: id,
          oldData: { name: before.name, status: before.status },
          newData: { name: after.name, status: after.status },
        },
        tx,
      );
      return after;
    });
  }

  /** Hard delete only when nothing references the record (spec §12, §63). */
  async remove(kind: Kind, id: string, actor: AuditActor): Promise<void> {
    await deleteUnlessInUse(
      () =>
        this.prisma.transaction(async (tx) => {
          const before =
            kind === 'location' ? await tx.location.findUnique({ where: { id } }) : await tx.department.findUnique({ where: { id } });
          if (!before) throw AppError.notFound(`${LABEL[kind]} غير موجود.`);
          // Unused links go with the record; a link used by any asset blocks the delete (RESTRICT).
          await tx.locationDepartment.deleteMany({ where: kind === 'location' ? { locationId: id } : { departmentId: id } });
          if (kind === 'location') await tx.location.delete({ where: { id } });
          else await tx.department.delete({ where: { id } });
          await this.audit.record({ actor, operation: `${ENTITY[kind].toUpperCase()}_DELETED`, entityType: ENTITY[kind], entityId: id, oldData: before }, tx);
        }),
      LABEL[kind],
    );
  }

  // ── Location ↔ department combinations ─────────────────────────────────

  async link(locationId: string, departmentId: string, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const [location, department] = await Promise.all([
        tx.location.findUnique({ where: { id: locationId } }),
        tx.department.findUnique({ where: { id: departmentId } }),
      ]);
      if (!location) throw AppError.notFound('الموقع غير موجود.');
      if (!department) throw AppError.notFound('القسم غير موجود.');
      const existing = await tx.locationDepartment.findUnique({ where: { locationId_departmentId: { locationId, departmentId } } });
      if (existing) throw new AppError('DUPLICATE', 'هذا القسم مرتبط بالموقع مسبقًا.');
      const row = await tx.locationDepartment.create({ data: { locationId, departmentId } });
      await this.audit.record(
        { actor, operation: 'LOCATION_DEPARTMENT_LINKED', entityType: 'LocationDepartment', entityId: `${locationId}:${departmentId}`, newData: { location: location.name, department: department.name } },
        tx,
      );
      return row;
    });
  }

  async setLinkStatus(locationId: string, departmentId: string, status: RecordStatus, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const before = await tx.locationDepartment.findUnique({ where: { locationId_departmentId: { locationId, departmentId } } });
      if (!before) throw AppError.notFound('هذا الربط غير موجود.');
      const after = await tx.locationDepartment.update({
        where: { locationId_departmentId: { locationId, departmentId } },
        data: { status },
      });
      await this.audit.record(
        { actor, operation: 'LOCATION_DEPARTMENT_UPDATED', entityType: 'LocationDepartment', entityId: `${locationId}:${departmentId}`, oldData: { status: before.status }, newData: { status } },
        tx,
      );
      return after;
    });
  }

  async unlink(locationId: string, departmentId: string, actor: AuditActor): Promise<void> {
    await deleteUnlessInUse(
      () =>
        this.prisma.transaction(async (tx) => {
          const deleted = await tx.locationDepartment.deleteMany({ where: { locationId, departmentId } });
          if (deleted.count === 0) throw AppError.notFound('هذا الربط غير موجود.');
          await this.audit.record(
            { actor, operation: 'LOCATION_DEPARTMENT_UNLINKED', entityType: 'LocationDepartment', entityId: `${locationId}:${departmentId}` },
            tx,
          );
        }),
      'ربط القسم بالموقع',
    );
  }
}
