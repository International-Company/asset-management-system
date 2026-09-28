import { Injectable } from '@nestjs/common';
import { OperationSequence } from '@osooli/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { paging } from '../../common/pagination';
import { AuditActor, AuditService } from '../audit/audit.service';
import { AssetsService } from '../assets/assets.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { CreateTransferDto, OperationListQueryDto } from './operations.dto';
import { assertNotSold, lockAsset } from './operations.shared';

const TRANSFER_INCLUDE = {
  asset: { select: { id: true, assetNumber: true, name: true } },
  fromLocation: { select: { id: true, name: true } },
  fromDepartment: { select: { id: true, name: true } },
  toLocation: { select: { id: true, name: true } },
  toDepartment: { select: { id: true, name: true } },
} satisfies Prisma.TransferInclude;

/**
 * Transfer (spec §23): changes location/department only — never the
 * responsible person. Direct, no approval, final at creation.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly assets: AssetsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(q: OperationListQueryDto) {
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.TransferWhereInput = {
      ...(q.assetId ? { assetId: q.assetId } : {}),
      ...(q.q
        ? {
            OR: [
              { number: { contains: q.q, mode: 'insensitive' } },
              { asset: { assetNumber: { contains: q.q, mode: 'insensitive' } } },
              { asset: { name: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.transfer.findMany({ where, skip, take, include: TRANSFER_INCLUDE, orderBy: { occurredAt: q.order === 'asc' ? 'asc' : 'desc' } }),
      this.prisma.transfer.count({ where }),
    ]);
    return { items: await this.withActors(items), total, page, pageSize };
  }

  async get(id: string) {
    const t = await this.prisma.transfer.findUnique({ where: { id }, include: TRANSFER_INCLUDE });
    if (!t) throw AppError.notFound('عملية النقل غير موجودة.');
    return (await this.withActors([t]))[0];
  }

  async create(dto: CreateTransferDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const asset = await lockAsset(tx, dto.assetId);
      assertNotSold(asset);
      if (asset.locationId === dto.toLocationId && asset.departmentId === dto.toDepartmentId) {
        throw AppError.validation({ toDepartmentId: ['الأصل موجود في هذا الموقع والقسم حاليًا.'] });
      }
      const link = await tx.locationDepartment.findUnique({
        where: { locationId_departmentId: { locationId: dto.toLocationId, departmentId: dto.toDepartmentId } },
        include: { location: true, department: true },
      });
      if (!link || link.status !== 'ACTIVE' || link.location.status !== 'ACTIVE' || link.department.status !== 'ACTIVE') {
        throw AppError.validation({ toDepartmentId: ['تركيبة الموقع والقسم الجديدة غير مسجلة أو معطّلة.'] });
      }

      const number = await this.numbering.allocateOperationNumber(tx, OperationSequence.TRANSFER);
      const transfer = await tx.transfer.create({
        data: {
          number,
          assetId: asset.id,
          fromLocationId: asset.locationId,
          fromDepartmentId: asset.departmentId,
          toLocationId: dto.toLocationId,
          toDepartmentId: dto.toDepartmentId,
          notes: dto.notes ?? null,
          actorId: actor.id!,
        },
      });
      await tx.asset.update({
        where: { id: asset.id },
        data: { locationId: dto.toLocationId, departmentId: dto.toDepartmentId, version: { increment: 1 } },
      });

      const summary = {
        number,
        fromLocation: asset.locationDepartment.location.name,
        fromDepartment: asset.locationDepartment.department.name,
        toLocation: link.location.name,
        toDepartment: link.department.name,
        notes: dto.notes ?? null,
      };
      await this.assets.event(tx, asset.id, 'TRANSFERRED', actor, summary, undefined, { type: 'Transfer', id: transfer.id });
      await this.audit.record(
        {
          actor,
          operation: 'TRANSFER_CREATED',
          entityType: 'Transfer',
          entityId: transfer.id,
          oldData: { location: summary.fromLocation, department: summary.fromDepartment },
          newData: { number, assetNumber: asset.assetNumber, location: summary.toLocation, department: summary.toDepartment },
        },
        tx,
      );
      await this.notifications.notify(
        {
          typeKey: 'transfer.created',
          title: `نقل الأصل ${asset.assetNumber} (${number})`,
          body: `من ${summary.fromLocation} / ${summary.fromDepartment} إلى ${summary.toLocation} / ${summary.toDepartment}`,
          entityType: 'Transfer',
          entityId: transfer.id,
        },
        tx,
      );
      return { id: transfer.id, number };
    });
  }

  private async withActors<T extends { actorId: string }>(rows: T[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.actorId))] } },
      select: { id: true, employee: { select: { fullName: true } } },
    });
    const names = new Map(users.map((u) => [u.id, u.employee.fullName]));
    return rows.map((r) => ({ ...r, actorName: names.get(r.actorId) ?? null }));
  }
}
