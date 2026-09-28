import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { OperationSequence } from '@osooli/shared';
import { AssetEventType, MainCategoryCode, Prisma } from '../../generated/prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { orderBy, paging } from '../../common/pagination';
import { toJsonSafe } from '../../common/redact';
import { AuditActor, AuditService } from '../audit/audit.service';
import { EmployeesService } from '../employees/employees.service';
import { assetSequenceKey, NumberingService } from '../numbering/numbering.service';
import {
  AssetListQueryDto,
  ChangeCategoryDto,
  ChangeSerialDto,
  CreateAssetDto,
  PurchaseDto,
  RealEstateDto,
  ResponsibleDto,
  TechnicalDto,
  UpdateAssetDto,
  WarrantyDto,
} from './assets.dto';

export const ASSET_DETAIL_INCLUDE = {
  category: true,
  subcategory: { select: { id: true, name: true, status: true } },
  locationDepartment: {
    select: {
      status: true,
      location: { select: { id: true, name: true, status: true } },
      department: { select: { id: true, name: true, status: true } },
    },
  },
  responsibleEmployee: { select: { id: true, eapEmployeeId: true, fullName: true, jobTitle: true, isActive: true } },
  responsibleExternal: { select: { id: true, name: true, organization: true, phone: true, status: true } },
  technical: true,
  realEstate: true,
  numberHistory: { orderBy: { assignedAt: 'asc' } },
  serialHistory: { orderBy: { createdAt: 'asc' } },
  photos: {
    where: { removedAt: null },
    orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, isMain: true, createdAt: true, file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } } },
  },
  sale: { select: { id: true, number: true, saleDate: true } },
} satisfies Prisma.AssetInclude;

type AssetDetail = Prisma.AssetGetPayload<{ include: typeof ASSET_DETAIL_INCLUDE }>;

const LIST_SELECT = {
  id: true,
  assetNumber: true,
  name: true,
  mainCategory: true,
  serialNumber: true,
  status: true,
  updatedAt: true,
  createdAt: true,
  subcategory: { select: { id: true, name: true } },
  locationDepartment: { select: { location: { select: { id: true, name: true } }, department: { select: { id: true, name: true } } } },
  responsibleEmployee: { select: { id: true, fullName: true, isActive: true } },
  responsibleExternal: { select: { id: true, name: true } },
  technical: { select: { macAddress: true, ipAddress: true } },
  photos: { where: { isMain: true, removedAt: null }, select: { file: { select: { id: true } } }, take: 1 },
} satisfies Prisma.AssetSelect;

/** Opaque, stable QR identity (spec §9). Not derived from the asset number. */
function newQrToken(): string {
  return randomBytes(18).toString('base64url');
}

const dateOrNull = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00Z`) : null);

/** Purchase fields as Prisma data. A provided `purchase` object replaces all purchase fields. */
function purchaseData(p: PurchaseDto | undefined) {
  if (!p) return {};
  return {
    purchaseDate: dateOrNull(p.date),
    supplier: p.supplier ?? null,
    invoiceNumber: p.invoiceNumber ?? null,
    purchaseValue: p.value ?? null,
    purchaseCurrency: p.currency ?? null,
  };
}

function warrantyData(w: WarrantyDto | undefined) {
  if (!w) return {};
  return w.exists
    ? { warrantyExists: true, warrantyExpiresAt: dateOrNull(w.expiresAt), warrantyDetails: w.details ?? null }
    : { warrantyExists: false, warrantyExpiresAt: null, warrantyDetails: null };
}

function technicalData(t: TechnicalDto) {
  return {
    manufacturer: t.manufacturer ?? null,
    model: t.model ?? null,
    macAddress: t.macAddress ? t.macAddress.toUpperCase().replace(/-/g, ':') : null,
    ipAddress: t.ipAddress ?? null,
    operatingSystem: t.operatingSystem ?? null,
    specifications: t.specifications ?? null,
  };
}

function realEstateData(r: RealEstateDto) {
  return {
    propertyType: r.propertyType ?? null,
    propertyName: r.propertyName ?? null,
    locationText: r.locationText ?? null,
    area: r.area ?? null,
    propertyNumber: r.propertyNumber ?? null,
    parcelNumber: r.parcelNumber ?? null,
    ownershipDeed: r.ownershipDeed ?? null,
    ownershipDate: dateOrNull(r.ownershipDate),
    ownershipNotes: r.ownershipNotes ?? null,
  };
}

/** A compact, JSON-safe picture of the asset for history snapshots. */
export function snapshotOf(a: AssetDetail) {
  return toJsonSafe({
    assetNumber: a.assetNumber,
    name: a.name,
    mainCategory: a.mainCategory,
    subcategory: a.subcategory.name,
    serialNumber: a.serialNumber,
    status: a.status,
    location: a.locationDepartment.location.name,
    department: a.locationDepartment.department.name,
    responsible: a.responsibleEmployee
      ? { type: 'EMPLOYEE', id: a.responsibleEmployee.id, name: a.responsibleEmployee.fullName }
      : { type: 'EXTERNAL', id: a.responsibleExternal?.id, name: a.responsibleExternal?.name },
    purchase: { date: a.purchaseDate, supplier: a.supplier, invoiceNumber: a.invoiceNumber, value: a.purchaseValue, currency: a.purchaseCurrency },
    warranty: { exists: a.warrantyExists, expiresAt: a.warrantyExpiresAt, details: a.warrantyDetails },
    technical: a.technical,
    realEstate: a.realEstate,
    notes: a.notes,
  }) as Prisma.InputJsonValue;
}

/**
 * Asset core (spec §6–22). Operations that change status, location,
 * department or responsible person live in their own modules (phase 4).
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly employees: EmployeesService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────

  async list(q: AssetListQueryDto) {
    const { skip, take, page, pageSize } = paging(q);
    const where = assetWhere(q);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({
        where,
        skip,
        take,
        select: LIST_SELECT,
        orderBy: orderBy<Prisma.AssetOrderByWithRelationInput[]>(
          q,
          {
            assetNumber: (d) => [{ assetNumber: d }],
            name: (d) => [{ name: d }, { assetNumber: 'asc' }],
            status: (d) => [{ status: d }, { assetNumber: 'asc' }],
            createdAt: (d) => [{ createdAt: d }],
            updatedAt: (d) => [{ updatedAt: d }],
          },
          'createdAt',
        ),
      }),
      this.prisma.asset.count({ where }),
    ]);
    return {
      items: items.map(({ photos, ...a }) => ({ ...a, mainPhotoFileId: photos[0]?.file.id ?? null })),
      total,
      page,
      pageSize,
    };
  }

  async get(id: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id }, include: ASSET_DETAIL_INCLUDE });
    if (!asset) throw new AppError('ASSET_NOT_FOUND');
    return { ...toJsonSafe(asset) as object, canDelete: !(await this.hasHistory(this.prisma, id)) };
  }

  /** Resolves a QR token to its asset (spec §9). Tokens stay valid for sold assets (historical). */
  async byQrToken(token: string) {
    const asset = await this.prisma.asset.findUnique({ where: { qrToken: token }, select: { id: true, assetNumber: true, status: true } });
    if (!asset) throw new AppError('ASSET_NOT_FOUND', 'رمز QR لا يطابق أي أصل.');
    return asset;
  }

  /** The asset's history timeline (spec §22), newest first, with actor names. */
  async history(id: string) {
    const exists = await this.prisma.asset.count({ where: { id } });
    if (!exists) throw new AppError('ASSET_NOT_FOUND');
    const events = await this.prisma.assetEvent.findMany({ where: { assetId: id }, orderBy: { id: 'desc' }, take: 500 });
    const actorIds = [...new Set(events.map((e) => e.actorId).filter((x): x is string => !!x))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, employee: { select: { fullName: true } } },
    });
    const names = new Map(users.map((u) => [u.id, u.employee.fullName]));
    return toJsonSafe(events.map((e) => ({ ...e, actorName: e.actorId ? (names.get(e.actorId) ?? null) : null })));
  }

  // ── Create (atomic, spec §19) ─────────────────────────────────────────

  async create(dto: CreateAssetDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const sub = await tx.subcategory.findUnique({ where: { id: dto.subcategoryId } });
      if (!sub || sub.status !== 'ACTIVE') throw AppError.validation({ subcategoryId: ['الفئة الفرعية غير موجودة أو معطّلة.'] });
      await this.assertPlacement(tx, dto.locationId, dto.departmentId);
      const responsible = await this.resolveResponsible(tx, dto.responsible);
      await this.assertCurrency(tx, dto.purchase?.currency);
      this.assertDetailsFitCategory(sub.mainCategory, dto);

      const assetNumber = await this.numbering.allocateAssetNumber(tx, sub.mainCategory);
      const internalSerial = !dto.serialNumber;
      const serialNumber = dto.serialNumber ?? (await this.numbering.allocateOperationNumber(tx, OperationSequence.INTERNAL_SERIAL));

      const asset = await tx.asset.create({
        data: {
          assetNumber,
          name: dto.name,
          mainCategory: sub.mainCategory,
          subcategoryId: sub.id,
          serialNumber,
          serialIsInternal: internalSerial,
          qrToken: newQrToken(),
          locationId: dto.locationId,
          departmentId: dto.departmentId,
          ...responsible,
          notes: dto.notes ?? null,
          ...purchaseData(dto.purchase),
          ...warrantyData(dto.warranty),
          createdById: actor.id,
          numberHistory: { create: { assetNumber, mainCategory: sub.mainCategory, actorId: actor.id, reason: 'إنشاء الأصل' } },
          ...(sub.mainCategory === 'TEC' ? { technical: { create: technicalData(dto.technical ?? {}) } } : {}),
          ...(sub.mainCategory === 'REA' ? { realEstate: { create: realEstateData(dto.realEstate ?? {}) } } : {}),
        },
        include: ASSET_DETAIL_INCLUDE,
      });

      const snapshot = snapshotOf(asset);
      await this.event(tx, asset.id, 'CREATED', actor, { assetNumber, serialGenerated: internalSerial }, snapshot);
      await this.audit.record({ actor, operation: 'ASSET_CREATED', entityType: 'Asset', entityId: asset.id, newData: snapshot }, tx);
      return { id: asset.id, assetNumber };
    });
  }

  // ── Descriptive edit (spec §20) ───────────────────────────────────────

  async update(id: string, dto: UpdateAssetDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const before = await this.loadForWrite(tx, id, dto.version);
      await this.assertCurrency(tx, dto.purchase?.currency);
      this.assertDetailsFitCategory(before.mainCategory, dto);

      await tx.asset.update({
        where: { id },
        data: {
          version: { increment: 1 },
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...purchaseData(dto.purchase),
          ...warrantyData(dto.warranty),
        },
      });
      if (dto.technical) {
        await tx.assetTechnicalDetails.upsert({
          where: { assetId: id },
          create: { assetId: id, ...technicalData(dto.technical) },
          update: technicalData(dto.technical),
        });
      }
      if (dto.realEstate) {
        await tx.assetRealEstateDetails.upsert({
          where: { assetId: id },
          create: { assetId: id, ...realEstateData(dto.realEstate) },
          update: realEstateData(dto.realEstate),
        });
      }

      const after = await tx.asset.findUniqueOrThrow({ where: { id }, include: ASSET_DETAIL_INCLUDE });
      const changes = diffSnapshots(snapshotOf(before), snapshotOf(after));
      if (Object.keys(changes).length === 0) {
        // Nothing actually changed: undo the version bump by rolling back.
        throw new NoChanges();
      }
      await this.event(tx, id, 'UPDATED', actor, { changes });
      await this.audit.record({ actor, operation: 'ASSET_UPDATED', entityType: 'Asset', entityId: id, newData: changes }, tx);
      return { id, version: after.version, changes };
    }).catch((e) => {
      if (e instanceof NoChanges) return { id, version: dto.version, changes: {} };
      throw e;
    });
  }

  // ── Category change (spec §21) ────────────────────────────────────────

  /** What a category change would do, for the confirmation screen. */
  async previewCategoryChange(id: string, subcategoryId: string) {
    const [asset, sub] = await Promise.all([
      this.prisma.asset.findUnique({ where: { id } }),
      this.prisma.subcategory.findUnique({ where: { id: subcategoryId } }),
    ]);
    if (!asset) throw new AppError('ASSET_NOT_FOUND');
    if (!sub || sub.status !== 'ACTIVE') throw AppError.validation({ subcategoryId: ['الفئة الفرعية غير موجودة أو معطّلة.'] });
    const mainChanges = sub.mainCategory !== asset.mainCategory;
    return {
      currentNumber: asset.assetNumber,
      // Preview only: the real number is allocated at confirmation and may differ if another asset is created meanwhile.
      expectedNumber: mainChanges ? await this.numbering.peek(this.prisma, assetSequenceKey(sub.mainCategory)) : asset.assetNumber,
      numberChanges: mainChanges,
      fromCategory: asset.mainCategory,
      toCategory: sub.mainCategory,
    };
  }

  async changeCategory(id: string, dto: ChangeCategoryDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const before = await this.loadForWrite(tx, id, dto.version);
      const sub = await tx.subcategory.findUnique({ where: { id: dto.subcategoryId } });
      if (!sub || sub.status !== 'ACTIVE') throw AppError.validation({ subcategoryId: ['الفئة الفرعية غير موجودة أو معطّلة.'] });
      if (sub.id === before.subcategoryId) throw AppError.invalidState('الأصل ضمن هذه الفئة الفرعية مسبقًا.');

      const mainChanges = sub.mainCategory !== before.mainCategory;
      let assetNumber = before.assetNumber;
      if (mainChanges) {
        // New number from the new category's counter; the old one is retired, never reused.
        assetNumber = await this.numbering.allocateAssetNumber(tx, sub.mainCategory);
        await tx.assetNumberHistory.updateMany({
          where: { assetId: id, retiredAt: null },
          data: { retiredAt: new Date() },
        });
        await tx.assetNumberHistory.create({
          data: { assetId: id, assetNumber, mainCategory: sub.mainCategory, actorId: actor.id, reason: dto.reason ?? 'تغيير الفئة' },
        });
      }
      await tx.asset.update({
        where: { id },
        data: { mainCategory: sub.mainCategory, subcategoryId: sub.id, assetNumber, version: { increment: 1 } },
      });
      // Detail records are created when needed; old ones are kept for history (spec §21.7–8).
      if (sub.mainCategory === 'TEC' && !before.technical) await tx.assetTechnicalDetails.create({ data: { assetId: id } });
      if (sub.mainCategory === 'REA' && !before.realEstate) await tx.assetRealEstateDetails.create({ data: { assetId: id } });

      const summary = {
        fromNumber: before.assetNumber,
        toNumber: assetNumber,
        fromCategory: before.mainCategory,
        toCategory: sub.mainCategory,
        fromSubcategory: before.subcategory.name,
        toSubcategory: sub.name,
        reason: dto.reason ?? null,
      };
      await this.event(tx, id, 'CATEGORY_CHANGED', actor, summary, snapshotOf(before));
      await this.audit.record(
        {
          actor,
          operation: 'ASSET_CATEGORY_CHANGED',
          entityType: 'Asset',
          entityId: id,
          oldData: { assetNumber: before.assetNumber, mainCategory: before.mainCategory, subcategory: before.subcategory.name },
          newData: { assetNumber, mainCategory: sub.mainCategory, subcategory: sub.name },
        },
        tx,
      );
      return { id, assetNumber };
    });
  }

  // ── Serial replacement (spec §8) ──────────────────────────────────────

  async changeSerial(id: string, dto: ChangeSerialDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const before = await this.loadForWrite(tx, id, dto.version);
      if (before.serialNumber.toLowerCase() === dto.serialNumber.toLowerCase()) {
        throw AppError.invalidState('الرقم التسلسلي الجديد مطابق للحالي.');
      }
      await tx.asset.update({
        where: { id },
        data: { serialNumber: dto.serialNumber, serialIsInternal: false, version: { increment: 1 } },
      });
      await tx.serialNumberHistory.create({
        data: { assetId: id, oldSerial: before.serialNumber, newSerial: dto.serialNumber, actorId: actor.id, reason: dto.reason ?? null },
      });
      await this.event(tx, id, 'SERIAL_CHANGED', actor, { from: before.serialNumber, to: dto.serialNumber, reason: dto.reason ?? null });
      await this.audit.record(
        {
          actor,
          operation: 'ASSET_SERIAL_CHANGED',
          entityType: 'Asset',
          entityId: id,
          oldData: { serialNumber: before.serialNumber },
          newData: { serialNumber: dto.serialNumber },
          metadata: { reason: dto.reason ?? null },
        },
        tx,
      );
      return { id, serialNumber: dto.serialNumber };
    });
  }

  // ── Deletion (spec §62) ───────────────────────────────────────────────

  /** Hard delete, only for an asset with no history beyond its creation. Never for sold assets. */
  async remove(id: string, actor: AuditActor): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      const asset = await tx.asset.findUnique({ where: { id }, include: ASSET_DETAIL_INCLUDE });
      if (!asset) throw new AppError('ASSET_NOT_FOUND');
      if (asset.status === 'SOLD') throw new AppError('ASSET_SOLD', 'لا يمكن حذف أصل مباع.');
      if (await this.hasHistory(tx, id)) {
        throw AppError.invalidState('لا يمكن حذف أصل له تاريخ من عمليات أو مستندات أو صور.');
      }
      // Allows the history guard trigger to remove this asset's creation records only.
      await tx.$executeRaw`SET LOCAL osooli.asset_purge = 'on'`;
      await tx.assetEvent.deleteMany({ where: { assetId: id } });
      await tx.assetNumberHistory.deleteMany({ where: { assetId: id } });
      await tx.assetTechnicalDetails.deleteMany({ where: { assetId: id } });
      await tx.assetRealEstateDetails.deleteMany({ where: { assetId: id } });
      await tx.asset.delete({ where: { id } });
      await this.audit.record({ actor, operation: 'ASSET_DELETED', entityType: 'Asset', entityId: id, oldData: snapshotOf(asset) }, tx);
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /** Loads an asset for modification, enforcing optimistic concurrency and the sold-asset rule. */
  async loadForWrite(tx: Tx, id: string, version: number): Promise<AssetDetail> {
    // Row lock: concurrent writers queue here, then see the bumped version.
    const locked = await tx.$queryRaw<Array<{ version: number }>>`SELECT version FROM assets WHERE id = ${id}::uuid FOR UPDATE`;
    if (!locked.length) throw new AppError('ASSET_NOT_FOUND');
    const asset = await tx.asset.findUniqueOrThrow({ where: { id }, include: ASSET_DETAIL_INCLUDE });
    if (asset.status === 'SOLD') throw new AppError('ASSET_SOLD');
    if (asset.version !== version) throw new AppError('STALE_VERSION');
    return asset;
  }

  /** Anything beyond the creation record counts as history (spec §62). */
  private async hasHistory(db: Tx | PrismaService, id: string): Promise<boolean> {
    const c = await db.asset.findUnique({
      where: { id },
      select: {
        status: true,
        _count: {
          select: {
            events: true,
            numberHistory: true,
            serialHistory: true,
            photos: true,
            documents: true,
            transfers: true,
            custodyItems: true,
            custodyReturnItems: true,
            maintenances: true,
            inventoryItems: true,
          },
        },
        sale: { select: { id: true } },
      },
    });
    if (!c) return false;
    const n = c._count;
    return (
      c.status === 'SOLD' ||
      !!c.sale ||
      n.events > 1 ||
      n.numberHistory > 1 ||
      n.serialHistory + n.photos + n.documents + n.transfers + n.custodyItems + n.custodyReturnItems + n.maintenances + n.inventoryItems > 0
    );
  }

  async event(
    tx: Tx,
    assetId: string,
    type: AssetEventType,
    actor: AuditActor,
    summary: Record<string, unknown>,
    snapshot?: Prisma.InputJsonValue,
    operation?: { type: string; id: string },
  ): Promise<void> {
    await tx.assetEvent.create({
      data: {
        assetId,
        type,
        actorId: actor.id,
        summary: toJsonSafe(summary) as Prisma.InputJsonValue,
        snapshot: snapshot ?? Prisma.DbNull,
        operationType: operation?.type ?? null,
        operationId: operation?.id ?? null,
      },
    });
  }

  private async assertPlacement(tx: Tx, locationId: string, departmentId: string): Promise<void> {
    const link = await tx.locationDepartment.findUnique({
      where: { locationId_departmentId: { locationId, departmentId } },
      include: { location: true, department: true },
    });
    if (!link || link.status !== 'ACTIVE' || link.location.status !== 'ACTIVE' || link.department.status !== 'ACTIVE') {
      throw AppError.validation({ departmentId: ['تركيبة الموقع والقسم غير مسجلة أو معطّلة.'] });
    }
  }

  /** Employees must be active in EAP; external people must be active (spec §13, §46). */
  async resolveResponsible(tx: Tx, r: ResponsibleDto): Promise<{ responsibleEmployeeId: string | null; responsibleExternalId: string | null }> {
    if (r.type === 'EMPLOYEE') {
      if (!r.eapEmployeeId) throw AppError.validation({ 'responsible.eapEmployeeId': ['يجب اختيار الموظف.'] });
      const employee = await this.employees.ensureCached(r.eapEmployeeId, tx);
      if (!employee.isActive) {
        throw AppError.validation({ 'responsible.eapEmployeeId': ['الموظف غير فعّال في EAP ولا يمكن تعيينه مسؤولًا.'] });
      }
      return { responsibleEmployeeId: employee.id, responsibleExternalId: null };
    }
    if (!r.externalPersonId) throw AppError.validation({ 'responsible.externalPersonId': ['يجب اختيار الشخص الخارجي.'] });
    const person = await tx.externalPerson.findUnique({ where: { id: r.externalPersonId } });
    if (!person || person.status !== 'ACTIVE') {
      throw AppError.validation({ 'responsible.externalPersonId': ['الشخص الخارجي غير موجود أو معطّل.'] });
    }
    return { responsibleEmployeeId: null, responsibleExternalId: person.id };
  }

  private async assertCurrency(tx: Tx, code: string | null | undefined): Promise<void> {
    if (!code) return;
    const currency = await tx.currency.findUnique({ where: { code } });
    if (!currency || currency.status !== 'ACTIVE') throw AppError.validation({ 'purchase.currency': ['العملة غير متاحة.'] });
  }

  private assertDetailsFitCategory(category: MainCategoryCode, dto: { technical?: unknown; realEstate?: unknown; purchase?: PurchaseDto }): void {
    if (dto.technical && category !== 'TEC') throw AppError.validation({ technical: ['البيانات التقنية خاصة بالأصول التقنية.'] });
    if (dto.realEstate && category !== 'REA') throw AppError.validation({ realEstate: ['البيانات العقارية خاصة بالأصول العقارية.'] });
    if (dto.purchase?.value && !dto.purchase.currency) throw AppError.validation({ 'purchase.currency': ['حدد عملة قيمة الشراء.'] });
  }
}

class NoChanges extends Error {}

const day = (d: string, end = false) => new Date(`${d.slice(0, 10)}T${end ? '23:59:59.999' : '00:00:00'}Z`);

/** Prisma filter for asset search (spec §41). Every condition combines with AND. */
export function assetWhere(q: AssetListQueryDto): Prisma.AssetWhereInput {
  const term = q.q?.trim();
  const and: Prisma.AssetWhereInput[] = [];
  if (q.mainCategory) and.push({ mainCategory: q.mainCategory });
  if (q.subcategoryId) and.push({ subcategoryId: q.subcategoryId });
  if (q.status) and.push({ status: q.status });
  if (q.statusIn?.length) and.push({ status: { in: q.statusIn } });
  if (q.locationId) and.push({ locationId: q.locationId });
  if (q.departmentId) and.push({ departmentId: q.departmentId });
  if (q.responsibleEmployeeId) and.push({ responsibleEmployeeId: q.responsibleEmployeeId });
  if (q.responsibleExternalId) and.push({ responsibleExternalId: q.responsibleExternalId });
  if (q.responsibleType === 'EMPLOYEE') and.push({ responsibleEmployeeId: { not: null } });
  if (q.responsibleType === 'EXTERNAL') and.push({ responsibleExternalId: { not: null } });
  if (q.inactiveResponsible) and.push({ responsibleEmployee: { isActive: false } });
  if (q.serialInternal !== undefined) and.push({ serialIsInternal: q.serialInternal });
  if (q.hasPhoto !== undefined) {
    and.push(q.hasPhoto ? { photos: { some: { removedAt: null } } } : { photos: { none: { removedAt: null } } });
  }
  if (q.createdFrom || q.createdTo) {
    and.push({ createdAt: { ...(q.createdFrom ? { gte: day(q.createdFrom) } : {}), ...(q.createdTo ? { lte: day(q.createdTo, true) } : {}) } });
  }
  if (q.purchaseFrom || q.purchaseTo) {
    and.push({ purchaseDate: { ...(q.purchaseFrom ? { gte: day(q.purchaseFrom) } : {}), ...(q.purchaseTo ? { lte: day(q.purchaseTo) } : {}) } });
  }
  if (q.warrantyUntil) and.push({ warrantyExists: true, warrantyExpiresAt: { lte: day(q.warrantyUntil) } });
  if (q.manufacturer) and.push({ technical: { manufacturer: { contains: q.manufacturer, mode: 'insensitive' } } });
  if (q.supplier) and.push({ supplier: { contains: q.supplier, mode: 'insensitive' } });
  // Global search (spec §41): number (current or old), name, serial, MAC, IP, responsible, QR token.
  if (term) {
    and.push({
      OR: [
        { assetNumber: { contains: term, mode: 'insensitive' } },
        { name: { contains: term, mode: 'insensitive' } },
        { serialNumber: { contains: term, mode: 'insensitive' } },
        { qrToken: term },
        { numberHistory: { some: { assetNumber: { equals: term, mode: 'insensitive' } } } },
        { technical: { macAddress: { contains: term.toUpperCase().replace(/-/g, ':') } } },
        { technical: { ipAddress: { startsWith: term } } },
        { responsibleEmployee: { fullName: { contains: term, mode: 'insensitive' } } },
        { responsibleExternal: { name: { contains: term, mode: 'insensitive' } } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

/** Field-level differences between two snapshots, flattened one level (e.g. "purchase.value"). */
export function diffSnapshots(a: unknown, b: unknown): Record<string, { old: unknown; new: unknown }> {
  const out: Record<string, { old: unknown; new: unknown }> = {};
  const A = (a ?? {}) as Record<string, unknown>;
  const B = (b ?? {}) as Record<string, unknown>;
  for (const key of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[key];
    const y = B[key];
    const nested = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
    if (nested(x) || nested(y)) {
      const inner = diffSnapshots(x ?? {}, y ?? {});
      for (const [k, v] of Object.entries(inner)) {
        if (['assetId', 'createdAt', 'updatedAt'].includes(k)) continue;
        out[`${key}.${k}`] = v;
      }
    } else if (JSON.stringify(x ?? null) !== JSON.stringify(y ?? null)) {
      out[key] = { old: x ?? null, new: y ?? null };
    }
  }
  return out;
}
