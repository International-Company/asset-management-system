import { Injectable } from '@nestjs/common';
import { OperationSequence } from '@osooli/shared';
import { MaintenanceStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { paging } from '../../common/pagination';
import { toJsonSafe } from '../../common/redact';
import { AuditActor, AuditService } from '../audit/audit.service';
import { AssetsService, snapshotOf } from '../assets/assets.service';
import { QrService } from '../assets/qr.service';
import { EmployeesService } from '../employees/employees.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { escapeHtml } from '../pdf/pdf.service';
import { formatOfficialDate, ltr, OfficialDocumentService } from '../pdf/official-document.service';
import { StorageService, UploadedFile } from '../storage/storage.service';
import {
  CompleteMaintenanceDto,
  CreateMaintenanceDto,
  MaintenanceListQueryDto,
  StartMaintenanceDto,
  UpdateMaintenanceDto,
} from './operations.dto';
import { ASSET_COLUMNS, assertNotSold, assetCells, lockAsset, statusAr } from './operations.shared';

const MAINTENANCE_INCLUDE = {
  asset: { select: { id: true, assetNumber: true, name: true, status: true } },
  technicianEmployee: { select: { id: true, eapEmployeeId: true, fullName: true } },
  provider: { select: { id: true, name: true, type: true, phone: true } },
  beforePhoto: { select: { id: true, originalName: true } },
  afterPhoto: { select: { id: true, originalName: true } },
  documents: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, isOfficial: true, createdAt: true, versions: { where: { isCurrent: true }, select: { fileId: true, file: { select: { originalName: true } } } } },
  },
} satisfies Prisma.MaintenanceInclude;

const TECHNICIAN_TYPE_AR = { EMPLOYEE: 'موظف', EXTERNAL: 'فني خارجي', COMPANY: 'شركة' } as const;
/** Assets in these states cannot enter maintenance. */
const NOT_MAINTAINABLE = new Set(['SOLD', 'LOST', 'DISPOSED']);

/**
 * Maintenance requests (spec §31–32). Lifecycle:
 * NEW (جديدة) → IN_PROGRESS (قيد الصيانة) → COMPLETED (مكتملة) → CLOSED (انتهاء الصيانة).
 * The asset is "under maintenance" while in progress; completion sets its
 * resulting status; closing makes the record and cost final (DB trigger).
 */
@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly assets: AssetsService,
    private readonly employees: EmployeesService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly official: OfficialDocumentService,
    private readonly qr: QrService,
  ) {}

  async list(q: MaintenanceListQueryDto) {
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.MaintenanceWhereInput = {
      ...(q.status ? { status: q.status } : {}),
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
      this.prisma.maintenance.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: q.order === 'asc' ? 'asc' : 'desc' },
        include: { asset: { select: { id: true, assetNumber: true, name: true } }, technicianEmployee: { select: { fullName: true } }, provider: { select: { name: true } } },
      }),
      this.prisma.maintenance.count({ where }),
    ]);
    return { items: toJsonSafe(items), total, page, pageSize };
  }

  async get(id: string) {
    const m = await this.prisma.maintenance.findUnique({ where: { id }, include: MAINTENANCE_INCLUDE });
    if (!m) throw AppError.notFound('طلب الصيانة غير موجود.');
    const ids = [m.createdById, m.closedById].filter((x): x is string => !!x);
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, employee: { select: { fullName: true } } } });
    const name = (uid: string | null) => (uid ? (users.find((u) => u.id === uid)?.employee.fullName ?? null) : null);
    return toJsonSafe({
      ...m,
      durationDays: m.startDate && m.endDate ? Math.max(0, Math.round((m.endDate.getTime() - m.startDate.getTime()) / 86_400_000)) : null,
      createdByName: name(m.createdById),
      closedByName: name(m.closedById),
    });
  }

  // ── Open (before photo required) ──────────────────────────────────────

  async create(dto: CreateMaintenanceDto, beforePhoto: UploadedFile | undefined, actor: AuditActor) {
    if (!beforePhoto) throw AppError.validation({ beforePhoto: ['صورة ما قبل الصيانة إلزامية.'] });
    return this.prisma.transaction(async (tx) => {
      const asset = await lockAsset(tx, dto.assetId);
      assertNotSold(asset);
      if (NOT_MAINTAINABLE.has(asset.status)) throw AppError.invalidState(`لا يمكن فتح صيانة لأصل حالته «${statusAr(asset.status)}».`);
      const technician = await this.resolveTechnician(tx, dto);
      await this.assertCurrency(tx, dto.cost, dto.currency);
      const photo = await this.storage.store(beforePhoto, actor.id!, tx, { imagesOnly: true });

      const number = await this.numbering.allocateOperationNumber(tx, OperationSequence.MAINTENANCE);
      const m = await tx.maintenance.create({
        data: {
          number,
          assetId: asset.id,
          technicianType: dto.technicianType,
          ...technician,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          cost: dto.cost ?? null,
          currency: dto.cost ? (dto.currency ?? null) : null,
          beforePhotoId: photo.id,
          statusBeforeMaintenance: asset.status,
          createdById: actor.id!,
        },
      });
      await this.assets.event(tx, asset.id, 'MAINTENANCE_OPENED', actor, { number }, undefined, { type: 'Maintenance', id: m.id });
      await this.audit.record(
        { actor, operation: 'MAINTENANCE_OPENED', entityType: 'Maintenance', entityId: m.id, newData: { number, assetNumber: asset.assetNumber, technicianType: dto.technicianType } },
        tx,
      );
      await this.notifications.notify(
        { typeKey: 'maintenance.opened', title: `طلب صيانة ${number} للأصل ${asset.assetNumber}`, entityType: 'Maintenance', entityId: m.id },
        tx,
      );
      return { id: m.id, number };
    });
  }

  /** NEW → IN_PROGRESS: the asset becomes "under maintenance". */
  async start(id: string, dto: StartMaintenanceDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const m = await this.lock(tx, id, ['NEW']);
      const asset = await lockAsset(tx, m.assetId);
      assertNotSold(asset);
      const startDate = dto.startDate ? new Date(dto.startDate) : (m.startDate ?? new Date());
      await tx.maintenance.update({ where: { id }, data: { status: 'IN_PROGRESS', startDate, version: { increment: 1 } } });
      await tx.asset.update({ where: { id: asset.id }, data: { status: 'UNDER_MAINTENANCE', version: { increment: 1 } } });
      await this.assets.event(tx, asset.id, 'MAINTENANCE_UPDATED', actor, { number: m.number, status: 'IN_PROGRESS' }, undefined, { type: 'Maintenance', id });
      await this.audit.record(
        { actor, operation: 'MAINTENANCE_STARTED', entityType: 'Maintenance', entityId: id, oldData: { status: 'NEW', assetStatus: asset.status }, newData: { status: 'IN_PROGRESS', assetStatus: 'UNDER_MAINTENANCE' } },
        tx,
      );
      return { id, status: 'IN_PROGRESS' as const };
    });
  }

  /** Cost and details stay editable until the request is closed (spec §32). */
  async update(id: string, dto: UpdateMaintenanceDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const m = await this.lock(tx, id, ['NEW', 'IN_PROGRESS', 'COMPLETED']);
      const cost = dto.cost !== undefined ? dto.cost : m.cost?.toString() ?? null;
      const currency = dto.currency !== undefined ? dto.currency : m.currency;
      await this.assertCurrency(tx, cost, currency);
      const data = {
        ...(dto.cost !== undefined ? { cost: dto.cost } : {}),
        ...(dto.currency !== undefined || dto.cost !== undefined ? { currency: cost ? currency : null } : {}),
        ...(dto.whatWasRepaired !== undefined ? { whatWasRepaired: dto.whatWasRepaired } : {}),
        ...(dto.startDate !== undefined ? { startDate: dto.startDate ? new Date(dto.startDate) : null } : {}),
      };
      const after = await tx.maintenance.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      const changes = AuditService.diff(
        { cost: m.cost, currency: m.currency, whatWasRepaired: m.whatWasRepaired, startDate: m.startDate },
        { cost: after.cost, currency: after.currency, whatWasRepaired: after.whatWasRepaired, startDate: after.startDate },
      );
      if (Object.keys(changes).length) {
        await this.assets.event(tx, m.assetId, 'MAINTENANCE_UPDATED', actor, { number: m.number, changes }, undefined, { type: 'Maintenance', id });
        await this.audit.record({ actor, operation: 'MAINTENANCE_UPDATED', entityType: 'Maintenance', entityId: id, newData: changes }, tx);
      }
      return { id };
    });
  }

  /** IN_PROGRESS → COMPLETED: after photo required; the asset takes the resulting status. */
  async complete(id: string, dto: CompleteMaintenanceDto, afterPhoto: UploadedFile | undefined, actor: AuditActor) {
    if (!afterPhoto) throw AppError.validation({ afterPhoto: ['صورة ما بعد الصيانة إلزامية عند الإنهاء.'] });
    return this.prisma.transaction(async (tx) => {
      const m = await this.lock(tx, id, ['IN_PROGRESS']);
      const asset = await lockAsset(tx, m.assetId);
      assertNotSold(asset);
      const cost = dto.cost !== undefined ? dto.cost : m.cost?.toString() ?? null;
      const currency = dto.currency !== undefined ? dto.currency : m.currency;
      await this.assertCurrency(tx, cost, currency);
      const endDate = dto.endDate ? new Date(dto.endDate) : new Date();
      if (m.startDate && endDate < m.startDate) throw AppError.validation({ endDate: ['تاريخ الانتهاء قبل تاريخ البدء.'] });
      const photo = await this.storage.store(afterPhoto, actor.id!, tx, { imagesOnly: true });

      await tx.maintenance.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          endDate,
          afterPhotoId: photo.id,
          whatWasRepaired: dto.whatWasRepaired,
          resultingStatus: dto.resultingStatus,
          cost,
          currency: cost ? currency : null,
          version: { increment: 1 },
        },
      });
      await tx.asset.update({ where: { id: asset.id }, data: { status: dto.resultingStatus, version: { increment: 1 } } });
      await this.assets.event(
        tx,
        asset.id,
        'MAINTENANCE_COMPLETED',
        actor,
        { number: m.number, resultingStatus: dto.resultingStatus, whatWasRepaired: dto.whatWasRepaired },
        undefined,
        { type: 'Maintenance', id },
      );
      await this.audit.record(
        {
          actor,
          operation: 'MAINTENANCE_COMPLETED',
          entityType: 'Maintenance',
          entityId: id,
          oldData: { status: 'IN_PROGRESS', assetStatus: asset.status },
          newData: { status: 'COMPLETED', assetStatus: dto.resultingStatus, cost, currency },
        },
        tx,
      );
      await this.notifications.notify(
        { typeKey: 'maintenance.completed', title: `اكتملت صيانة الأصل ${asset.assetNumber} (${m.number})`, entityType: 'Maintenance', entityId: id },
        tx,
      );
      return { id, status: 'COMPLETED' as const };
    });
  }

  /** COMPLETED → CLOSED ("انتهاء الصيانة"): final and immutable; the official PDF is archived. */
  async close(id: string, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const m = await this.lock(tx, id, ['COMPLETED']);
      const asset = await lockAsset(tx, m.assetId);
      const closedAt = new Date();
      const full = await tx.maintenance.findUniqueOrThrow({ where: { id }, include: MAINTENANCE_INCLUDE });

      // The PDF is archived before the row becomes immutable.
      await this.official.archive(
        tx,
        { maintenanceId: id },
        {
          title: 'تقرير صيانة',
          number: m.number,
          date: closedAt,
          fields: [
            { label: 'الفني', value: escapeHtml(`${full.technicianEmployee?.fullName ?? full.provider?.name ?? '—'} (${TECHNICIAN_TYPE_AR[m.technicianType]})`) },
            { label: 'تاريخ البدء', value: escapeHtml(formatOfficialDate(m.startDate)) },
            { label: 'تاريخ الانتهاء', value: escapeHtml(formatOfficialDate(m.endDate)) },
            { label: 'ما تم إصلاحه', value: escapeHtml(m.whatWasRepaired ?? '') },
            { label: 'الحالة قبل الصيانة', value: escapeHtml(statusAr(m.statusBeforeMaintenance)) },
            { label: 'الحالة الناتجة', value: escapeHtml(m.resultingStatus ? statusAr(m.resultingStatus) : '—') },
            { label: 'التكلفة النهائية', value: m.cost ? ltr(`${m.cost.toString()} ${m.currency ?? ''}`) : '—' },
          ],
          table: { columns: ASSET_COLUMNS, rows: [assetCells(asset)], qrs: [await this.official.assetQr(this.qr.url(asset.qrToken))] },
          footer: [`أُغلق الطلب نهائيًا بواسطة ${escapeHtml(actor.name ?? '')} بتاريخ ${escapeHtml(formatOfficialDate(closedAt))}. التكلفة نهائية.`],
        },
        actor.id,
      );
      await tx.maintenance.update({ where: { id }, data: { status: 'CLOSED', closedAt, closedById: actor.id } });
      await this.assets.event(tx, m.assetId, 'MAINTENANCE_CLOSED', actor, { number: m.number, cost: m.cost?.toString() ?? null, currency: m.currency }, snapshotOf(asset), {
        type: 'Maintenance',
        id,
      });
      await this.audit.record(
        { actor, operation: 'MAINTENANCE_CLOSED', entityType: 'Maintenance', entityId: id, oldData: { status: 'COMPLETED' }, newData: { status: 'CLOSED', finalCost: m.cost?.toString() ?? null, currency: m.currency } },
        tx,
      );
      await this.notifications.notify(
        { typeKey: 'maintenance.closed', title: `انتهاء صيانة الأصل ${asset.assetNumber} (${m.number})`, entityType: 'Maintenance', entityId: id },
        tx,
      );
      return { id, status: 'CLOSED' as const };
    });
  }

  /** Attaches a named document to an open request. */
  async addDocument(id: string, name: string, file: UploadedFile | undefined, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const m = await this.lock(tx, id, ['NEW', 'IN_PROGRESS', 'COMPLETED']);
      const stored = await this.storage.store(file, actor.id!, tx);
      const doc = await tx.document.create({
        data: { name, maintenanceId: id, createdById: actor.id, versions: { create: { version: 1, fileId: stored.id, uploadedById: actor.id } } },
      });
      await this.audit.record({ actor, operation: 'DOCUMENT_ADDED', entityType: 'Document', entityId: doc.id, newData: { name, maintenance: m.number } }, tx);
      return { id: doc.id };
    });
  }

  private async lock(tx: Tx, id: string, allowed: MaintenanceStatus[]) {
    const rows = await tx.$queryRaw<Array<{ status: MaintenanceStatus }>>`SELECT status FROM maintenances WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw AppError.notFound('طلب الصيانة غير موجود.');
    if (!allowed.includes(rows[0].status)) {
      throw AppError.invalidState(rows[0].status === 'CLOSED' ? 'طلب الصيانة منتهٍ ولا يمكن تعديله.' : 'لا يمكن تنفيذ هذا الإجراء في حالة الطلب الحالية.');
    }
    return tx.maintenance.findUniqueOrThrow({ where: { id } });
  }

  private async resolveTechnician(tx: Tx, dto: CreateMaintenanceDto) {
    if (dto.technicianType === 'EMPLOYEE') {
      if (!dto.technicianEapEmployeeId) throw AppError.validation({ technicianEapEmployeeId: ['اختر الموظف الفني.'] });
      const e = await this.employees.ensureCached(dto.technicianEapEmployeeId, tx);
      if (!e.isActive) throw AppError.validation({ technicianEapEmployeeId: ['الموظف غير فعّال في EAP.'] });
      return { technicianEmployeeId: e.id, providerId: null };
    }
    if (!dto.providerId) throw AppError.validation({ providerId: ['اختر الفني أو الشركة.'] });
    const p = await tx.maintenanceProvider.findUnique({ where: { id: dto.providerId } });
    if (!p || p.status !== 'ACTIVE' || p.type !== dto.technicianType) {
      throw AppError.validation({ providerId: ['مزود الصيانة غير موجود أو معطّل أو من نوع مختلف.'] });
    }
    return { technicianEmployeeId: null, providerId: p.id };
  }

  private async assertCurrency(tx: Tx, cost: string | null | undefined, currency: string | null | undefined) {
    if (!cost) return;
    if (!currency) throw AppError.validation({ currency: ['حدد عملة التكلفة.'] });
    const c = await tx.currency.findUnique({ where: { code: currency } });
    if (!c || c.status !== 'ACTIVE') throw AppError.validation({ currency: ['العملة غير متاحة.'] });
  }
}
