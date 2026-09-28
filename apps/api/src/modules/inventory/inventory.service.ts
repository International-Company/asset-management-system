import { Injectable } from '@nestjs/common';
import { OperationSequence } from '@osooli/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { paging } from '../../common/pagination';
import { toJsonSafe } from '../../common/redact';
import { AuditActor, AuditService } from '../audit/audit.service';
import { AssetsService } from '../assets/assets.service';
import { EmployeesService } from '../employees/employees.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { escapeHtml } from '../pdf/pdf.service';
import { formatOfficialDate, ltr, OfficialDocumentService } from '../pdf/official-document.service';
import { StorageService, UploadedFile } from '../storage/storage.service';
import { statusAr } from '../operations/operations.shared';
import { AddItemDto, CheckItemDto, CreateInventoryDto, InventoryItemsQueryDto, InventoryListQueryDto, UnregisteredDto } from './inventory.dto';

/** Assets no longer counted: sold assets, and disposed assets that left service. */
const NOT_COUNTED = ['SOLD', 'DISPOSED'] as const;

const ITEM_INCLUDE = {
  asset: { select: { id: true, assetNumber: true, name: true, serialNumber: true, status: true } },
  expectedLocation: { select: { id: true, name: true } },
  expectedDepartment: { select: { id: true, name: true } },
  expectedResponsibleEmployee: { select: { id: true, eapEmployeeId: true, fullName: true } },
  expectedResponsibleExternal: { select: { id: true, name: true } },
  actualLocation: { select: { id: true, name: true } },
  actualDepartment: { select: { id: true, name: true } },
  actualResponsibleEmployee: { select: { id: true, eapEmployeeId: true, fullName: true } },
  actualResponsibleExternal: { select: { id: true, name: true } },
} satisfies Prisma.InventoryItemInclude;

type ItemRow = Prisma.InventoryItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

const respName = (e: { fullName: string } | null, x: { name: string } | null) => e?.fullName ?? x?.name ?? '—';

/**
 * Inventory counts (spec §33–35). Expected data is frozen at creation; each
 * asset is checked (found / not found, actual placement, responsible,
 * condition, photo, QR confirmation). Closing requires every expected asset
 * to be checked and applies discrepancies to the assets; a closed inventory
 * is immutable except for an exceptional, audited reopening.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly assets: AssetsService,
    private readonly employees: EmployeesService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly official: OfficialDocumentService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────

  async list(q: InventoryListQueryDto) {
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.InventoryWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { number: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.inventory.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: q.order === 'asc' ? 'asc' : 'desc' },
        include: {
          scopes: { include: { location: { select: { name: true } }, department: { select: { name: true } } } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.inventory.count({ where }),
    ]);
    const checked = await this.prisma.inventoryItem.groupBy({
      by: ['inventoryId'],
      where: { inventoryId: { in: rows.map((r) => r.id) }, checkedAt: { not: null } },
      _count: true,
    });
    return {
      items: rows.map(({ _count, ...r }) => ({ ...r, total: _count.items, checked: checked.find((c) => c.inventoryId === r.id)?._count ?? 0 })),
      total,
      page,
      pageSize,
    };
  }

  async get(id: string) {
    const inv = await this.prisma.inventory.findUnique({
      where: { id },
      include: {
        scopes: { include: { location: { select: { id: true, name: true } }, department: { select: { id: true, name: true } } } },
        reopenings: { orderBy: { createdAt: 'asc' } },
        unregistered: { orderBy: { recordedAt: 'asc' }, include: { photo: { select: { id: true } } } },
        documents: { where: { isOfficial: true }, select: { versions: { where: { isCurrent: true }, select: { fileId: true, version: true } } } },
      },
    });
    if (!inv) throw AppError.notFound('الجرد غير موجود.');
    const base = { inventoryId: id };
    const [total, checked, found, notFound, discrepancies] = await Promise.all([
      this.prisma.inventoryItem.count({ where: base }),
      this.prisma.inventoryItem.count({ where: { ...base, checkedAt: { not: null } } }),
      this.prisma.inventoryItem.count({ where: { ...base, exists: true } }),
      this.prisma.inventoryItem.count({ where: { ...base, exists: false } }),
      this.prisma.inventoryItem.count({ where: { ...base, hasDiscrepancy: true } }),
    ]);
    const userIds = [inv.createdById, inv.closedById, ...inv.reopenings.map((r) => r.actorId), ...inv.unregistered.map((u) => u.recordedById)].filter(
      (x): x is string => !!x,
    );
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, employee: { select: { fullName: true } } } });
    const name = (uid: string | null) => (uid ? (users.find((u) => u.id === uid)?.employee.fullName ?? null) : null);
    const officialVersion = inv.documents[0]?.versions[0];
    return toJsonSafe({
      ...inv,
      documents: undefined,
      createdByName: name(inv.createdById),
      closedByName: name(inv.closedById),
      reopenings: inv.reopenings.map((r) => ({ ...r, actorName: name(r.actorId) })),
      unregistered: inv.unregistered.map((u) => ({ ...u, recordedByName: name(u.recordedById) })),
      counts: { total, checked, unchecked: total - checked, found, notFound, discrepancies, unregistered: inv.unregistered.length },
      officialFileId: officialVersion?.fileId ?? null,
      officialVersion: officialVersion?.version ?? null,
    });
  }

  async items(id: string, q: InventoryItemsQueryDto) {
    const { skip, take, page, pageSize } = paging(q);
    const filter: Record<string, Prisma.InventoryItemWhereInput> = {
      all: {},
      unchecked: { checkedAt: null },
      checked: { checkedAt: { not: null } },
      found: { exists: true },
      discrepancy: { hasDiscrepancy: true },
      notFound: { exists: false },
    };
    const where: Prisma.InventoryItemWhereInput = {
      inventoryId: id,
      ...filter[q.filter ?? 'all'],
      ...(q.q
        ? {
            asset: {
              OR: [
                { assetNumber: { contains: q.q, mode: 'insensitive' } },
                { name: { contains: q.q, mode: 'insensitive' } },
                { serialNumber: { contains: q.q, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.inventoryItem.findMany({ where, skip, take, include: ITEM_INCLUDE, orderBy: { asset: { assetNumber: 'asc' } } }),
      this.prisma.inventoryItem.count({ where }),
    ]);
    return { items: toJsonSafe(items), total, page, pageSize };
  }

  // ── Create (spec §33) ─────────────────────────────────────────────────

  async create(dto: CreateInventoryDto, actor: AuditActor) {
    const scopes = dto.scopes.filter((s) => s.locationId || s.departmentId);
    if (!scopes.length) throw AppError.validation({ scopes: ['حدد موقعًا أو قسمًا واحدًا على الأقل.'] });

    return this.prisma.transaction(
      async (tx) => {
        const scopeWhere: Prisma.AssetWhereInput[] = scopes.map((s) => ({
          ...(s.locationId ? { locationId: s.locationId } : {}),
          ...(s.departmentId ? { departmentId: s.departmentId } : {}),
        }));
        const assets = await tx.asset.findMany({
          where: { status: { notIn: [...NOT_COUNTED] }, OR: scopeWhere },
          select: { id: true, locationId: true, departmentId: true, responsibleEmployeeId: true, responsibleExternalId: true, status: true },
        });
        if (!assets.length) throw AppError.validation({ scopes: ['لا توجد أصول ضمن النطاق المحدد.'] });

        const number = await this.numbering.allocateOperationNumber(tx, OperationSequence.INVENTORY);
        const inv = await tx.inventory.create({
          data: {
            number,
            notes: dto.notes ?? null,
            createdById: actor.id!,
            scopes: { create: scopes.map((s) => ({ locationId: s.locationId ?? null, departmentId: s.departmentId ?? null })) },
          },
        });
        // Expected data is frozen now (spec §33).
        await tx.inventoryItem.createMany({
          data: assets.map((a) => ({
            inventoryId: inv.id,
            assetId: a.id,
            expectedLocationId: a.locationId,
            expectedDepartmentId: a.departmentId,
            expectedResponsibleEmployeeId: a.responsibleEmployeeId,
            expectedResponsibleExternalId: a.responsibleExternalId,
            expectedStatus: a.status,
          })),
        });
        await this.audit.record({ actor, operation: 'INVENTORY_CREATED', entityType: 'Inventory', entityId: inv.id, newData: { number, scopes, assetCount: assets.length } }, tx);
        await this.notifications.notify({ typeKey: 'inventory.created', title: `جرد جديد ${number}`, body: `${assets.length} أصل ضمن النطاق.`, entityType: 'Inventory', entityId: inv.id }, tx);
        return { id: inv.id, number, assetCount: assets.length };
      },
      { timeoutMs: 60_000 },
    );
  }

  // ── Checking (spec §33) ───────────────────────────────────────────────

  /**
   * Finds what a scanned code refers to: an expected item, a registered asset
   * outside the expected list, or nothing (a candidate unregistered asset).
   * Accepts the QR URL, a bare QR token, an asset number (current or old) or
   * a serial number.
   */
  async scan(id: string, code: string) {
    await this.assertInProgress(this.prisma, id);
    const token = code.includes('/qr/') ? code.slice(code.lastIndexOf('/qr/') + 4).split(/[?#/]/)[0] : code;
    const asset = await this.prisma.asset.findFirst({
      where: {
        OR: [
          { qrToken: token },
          { assetNumber: { equals: code, mode: 'insensitive' } },
          { numberHistory: { some: { assetNumber: { equals: code, mode: 'insensitive' } } } },
          { serialNumber: { equals: code, mode: 'insensitive' } },
        ],
      },
      select: { id: true, assetNumber: true, name: true, status: true, qrToken: true },
    });
    if (!asset) return { kind: 'UNKNOWN' as const, code };
    const item = await this.prisma.inventoryItem.findUnique({ where: { inventoryId_assetId: { inventoryId: id, assetId: asset.id } }, include: ITEM_INCLUDE });
    if (item) return { kind: 'ITEM' as const, item: toJsonSafe(item), viaQr: asset.qrToken === token };
    return { kind: 'OUT_OF_SCOPE' as const, asset: { id: asset.id, assetNumber: asset.assetNumber, name: asset.name, status: asset.status } };
  }

  /** Adds a registered asset found here although it was not expected (e.g. misplaced). */
  async addItem(id: string, dto: AddItemDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      await this.lockInProgress(tx, id);
      const a = await tx.asset.findUnique({ where: { id: dto.assetId } });
      if (!a) throw new AppError('ASSET_NOT_FOUND');
      if ((NOT_COUNTED as readonly string[]).includes(a.status)) throw AppError.invalidState(`الأصل ${a.assetNumber} خارج الجرد (${statusAr(a.status)}).`);
      const item = await tx.inventoryItem.create({
        data: {
          inventoryId: id,
          assetId: a.id,
          expectedLocationId: a.locationId,
          expectedDepartmentId: a.departmentId,
          expectedResponsibleEmployeeId: a.responsibleEmployeeId,
          expectedResponsibleExternalId: a.responsibleExternalId,
          expectedStatus: a.status,
        },
        include: ITEM_INCLUDE,
      });
      await this.audit.record({ actor, operation: 'INVENTORY_ITEM_ADDED', entityType: 'Inventory', entityId: id, newData: { assetNumber: a.assetNumber } }, tx);
      return toJsonSafe(item);
    });
  }

  /** Records the result of checking one asset. May be repeated while the inventory is in progress. */
  async check(id: string, itemId: string, dto: CheckItemDto, photo: UploadedFile | undefined, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      await this.lockInProgress(tx, id);
      const item = await tx.inventoryItem.findFirst({ where: { id: itemId, inventoryId: id } });
      if (!item) throw AppError.notFound('الأصل غير موجود في هذا الجرد.');
      const photoId = photo ? (await this.storage.store(photo, actor.id!, tx, { imagesOnly: true })).id : (item.photoId ?? null);
      const common = { checkedAt: new Date(), checkedById: actor.id, notes: dto.notes ?? null, photoId, confirmedByQr: !!dto.confirmedByQr };

      if (!dto.exists) {
        // Not found (spec §35): recorded only; the asset's status is not changed.
        await tx.inventoryItem.update({
          where: { id: itemId },
          data: {
            ...common,
            exists: false,
            actualLocationId: null,
            actualDepartmentId: null,
            actualResponsibleEmployeeId: null,
            actualResponsibleExternalId: null,
            actualStatus: null,
            hasDiscrepancy: false,
          },
        });
      } else {
        const actualLocationId = dto.actualLocationId ?? item.expectedLocationId;
        const actualDepartmentId = dto.actualDepartmentId ?? item.expectedDepartmentId;
        if (actualLocationId !== item.expectedLocationId || actualDepartmentId !== item.expectedDepartmentId) {
          const link = await tx.locationDepartment.findUnique({
            where: { locationId_departmentId: { locationId: actualLocationId, departmentId: actualDepartmentId } },
            include: { location: true, department: true },
          });
          if (!link || link.status !== 'ACTIVE' || link.location.status !== 'ACTIVE' || link.department.status !== 'ACTIVE') {
            throw AppError.validation({ actualDepartmentId: ['تركيبة الموقع والقسم الفعلية غير مسجلة أو معطّلة.'] });
          }
        }
        const responsible = await this.actualResponsible(tx, dto, item);
        const actualStatus = dto.actualStatus ?? item.expectedStatus;
        const hasDiscrepancy =
          actualLocationId !== item.expectedLocationId ||
          actualDepartmentId !== item.expectedDepartmentId ||
          responsible.actualResponsibleEmployeeId !== item.expectedResponsibleEmployeeId ||
          responsible.actualResponsibleExternalId !== item.expectedResponsibleExternalId ||
          actualStatus !== item.expectedStatus;
        await tx.inventoryItem.update({
          where: { id: itemId },
          data: { ...common, exists: true, actualLocationId, actualDepartmentId, ...responsible, actualStatus, hasDiscrepancy },
        });
      }
      await this.audit.record(
        { actor, operation: 'INVENTORY_ITEM_CHECKED', entityType: 'Inventory', entityId: id, newData: { itemId, exists: dto.exists, viaQr: !!dto.confirmedByQr } },
        tx,
      );
      return toJsonSafe(await tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId }, include: ITEM_INCLUDE }));
    });
  }

  /** "أصل غير مسجل" (spec §35): recorded only — no asset is created. */
  async addUnregistered(id: string, dto: UnregisteredDto, photo: UploadedFile | undefined, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      await this.lockInProgress(tx, id);
      const photoId = photo ? (await this.storage.store(photo, actor.id!, tx, { imagesOnly: true })).id : null;
      const row = await tx.inventoryUnregisteredAsset.create({
        data: {
          inventoryId: id,
          description: dto.description,
          scannedCode: dto.scannedCode ?? null,
          locationId: dto.locationId ?? null,
          departmentId: dto.departmentId ?? null,
          notes: dto.notes ?? null,
          photoId,
          recordedById: actor.id!,
        },
      });
      await this.audit.record({ actor, operation: 'INVENTORY_UNREGISTERED_RECORDED', entityType: 'Inventory', entityId: id, newData: { description: dto.description } }, tx);
      return row;
    });
  }

  // ── Close with reconciliation (spec §34–35) ───────────────────────────

  async close(id: string, actor: AuditActor) {
    return this.prisma.transaction(
      async (tx) => {
        const inv = await this.lockInProgress(tx, id);
        const unchecked = await tx.inventoryItem.count({ where: { inventoryId: id, checkedAt: null } });
        if (unchecked > 0) throw AppError.invalidState(`لا يمكن إغلاق الجرد قبل فحص جميع الأصول المتوقعة؛ بقي ${unchecked} أصل.`);

        // Only items checked since the last reconciliation (all of them on first close).
        const pending = await tx.inventoryItem.findMany({
          where: { inventoryId: id, OR: [{ reconciledAt: null }, { checkedAt: { gt: tx.inventoryItem.fields.reconciledAt } }] },
          include: ITEM_INCLUDE,
        });
        const applied: Array<{ item: ItemRow; changes: string[]; skipped: string[] }> = [];
        for (const item of pending) applied.push(await this.reconcile(tx, inv.number, id, item, actor));
        await tx.inventoryItem.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { reconciledAt: new Date() } });

        const closedAt = new Date();
        await tx.inventory.update({ where: { id }, data: { status: 'CLOSED', closedAt, closedById: actor.id, version: { increment: 1 } } });
        await this.archivePdf(tx, id, inv.number, closedAt, actor);
        await this.audit.record(
          {
            actor,
            operation: 'INVENTORY_CLOSED',
            entityType: 'Inventory',
            entityId: id,
            newData: {
              number: inv.number,
              reconciled: applied.length,
              changed: applied.filter((a) => a.changes.length).length,
              skipped: applied.filter((a) => a.skipped.length).map((a) => ({ asset: a.item.asset.assetNumber, reasons: a.skipped })),
            },
          },
          tx,
        );
        await this.notifications.notify({ typeKey: 'inventory.closed', title: `أُغلق الجرد ${inv.number}`, entityType: 'Inventory', entityId: id }, tx);
        return { id, status: 'CLOSED' as const };
      },
      { timeoutMs: 120_000 },
    );
  }

  /**
   * Applies one checked item to its asset (spec §35): location, department,
   * responsible and status discrepancies update the asset; "not found"
   * changes nothing. Updates that would conflict with another operation are
   * skipped and reported.
   */
  private async reconcile(tx: Tx, number: string, inventoryId: string, item: ItemRow, actor: AuditActor) {
    const changes: string[] = [];
    const skipped: string[] = [];
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM assets WHERE id = ${item.assetId}::uuid FOR UPDATE`;
    if (!locked.length) return { item, changes, skipped };
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: item.assetId } });
    const ref = { type: 'Inventory', id: inventoryId };

    if (!item.exists) {
      await this.assets.event(tx, asset.id, 'INVENTORY_CHECKED', actor, { number, result: 'NOT_FOUND', notes: item.notes }, undefined, ref);
      return { item, changes, skipped };
    }
    if (asset.status === 'SOLD') {
      skipped.push('الأصل بيع أثناء الجرد');
      await this.assets.event(tx, asset.id, 'INVENTORY_CHECKED', actor, { number, result: 'FOUND', skipped }, undefined, ref);
      return { item, changes, skipped };
    }

    const data: Prisma.AssetUncheckedUpdateInput = {};
    if (item.actualLocationId && item.actualDepartmentId && (item.actualLocationId !== asset.locationId || item.actualDepartmentId !== asset.departmentId)) {
      data.locationId = item.actualLocationId;
      data.departmentId = item.actualDepartmentId;
      changes.push(`الموقع/القسم: ${item.actualLocation?.name} / ${item.actualDepartment?.name}`);
    }
    const responsibleChanged =
      item.actualResponsibleEmployeeId !== asset.responsibleEmployeeId || item.actualResponsibleExternalId !== asset.responsibleExternalId;
    if (responsibleChanged && (item.actualResponsibleEmployeeId || item.actualResponsibleExternalId)) {
      const pendingCustody = await tx.custodyItem.count({ where: { assetId: asset.id, isPending: true } });
      if (pendingCustody) skipped.push('المسؤول: يوجد محضر عهدة بانتظار التأكيد');
      else {
        data.responsibleEmployeeId = item.actualResponsibleEmployeeId;
        data.responsibleExternalId = item.actualResponsibleExternalId;
        changes.push(`المسؤول: ${respName(item.actualResponsibleEmployee, item.actualResponsibleExternal)}`);
      }
    }
    if (item.actualStatus && item.actualStatus !== asset.status) {
      const openMaintenance = await tx.maintenance.count({ where: { assetId: asset.id, status: { not: 'CLOSED' } } });
      if (openMaintenance) skipped.push('الحالة: يوجد طلب صيانة مفتوح');
      else {
        data.status = item.actualStatus;
        changes.push(`الحالة: ${statusAr(item.actualStatus)}`);
      }
    }
    if (Object.keys(data).length) await tx.asset.update({ where: { id: asset.id }, data: { ...data, version: { increment: 1 } } });
    await this.assets.event(tx, asset.id, 'INVENTORY_CHECKED', actor, { number, result: 'FOUND', changes, skipped, viaQr: item.confirmedByQr }, undefined, ref);
    return { item, changes, skipped };
  }

  private async archivePdf(tx: Tx, id: string, number: string, closedAt: Date, actor: AuditActor) {
    const inv = await tx.inventory.findUniqueOrThrow({
      where: { id },
      include: {
        scopes: { include: { location: { select: { name: true } }, department: { select: { name: true } } } },
        unregistered: true,
        reopenings: true,
      },
    });
    const items = await tx.inventoryItem.findMany({ where: { inventoryId: id }, include: ITEM_INCLUDE, orderBy: { asset: { assetNumber: 'asc' } } });
    const found = items.filter((i) => i.exists);
    const notFound = items.filter((i) => i.exists === false);
    const diffs = items.filter((i) => i.hasDiscrepancy);
    const scope = inv.scopes.map((s) => [s.location?.name ?? 'كل المواقع', s.department?.name ?? 'كل الأقسام'].join(' / ')).join('، ');
    const cell = (expected: string, actual: string) => (expected === actual ? escapeHtml(actual) : `${escapeHtml(expected)} ← <b>${escapeHtml(actual)}</b>`);

    const rows: string[][] = [
      ...diffs.map((i) => [
        ltr(i.asset.assetNumber),
        escapeHtml(i.asset.name),
        cell(`${i.expectedLocation.name} / ${i.expectedDepartment.name}`, `${i.actualLocation?.name} / ${i.actualDepartment?.name}`),
        cell(respName(i.expectedResponsibleEmployee, i.expectedResponsibleExternal), respName(i.actualResponsibleEmployee, i.actualResponsibleExternal)),
        cell(statusAr(i.expectedStatus), statusAr(i.actualStatus ?? i.expectedStatus)),
      ]),
      ...notFound.map((i) => [ltr(i.asset.assetNumber), escapeHtml(i.asset.name), '<b>غير موجود أثناء الجرد</b>', '—', escapeHtml(statusAr(i.expectedStatus))]),
      ...inv.unregistered.map((u) => ['—', escapeHtml(u.description), '<b>أصل غير مسجل</b>', escapeHtml(u.scannedCode ?? ''), escapeHtml(u.notes ?? '')]),
    ];

    await this.official.archive(
      tx,
      { inventoryId: id },
      {
        title: 'محضر جرد',
        number,
        date: closedAt,
        fields: [
          { label: 'النطاق', value: escapeHtml(scope) },
          { label: 'تاريخ البدء', value: escapeHtml(formatOfficialDate(inv.createdAt)) },
          { label: 'تاريخ الإغلاق', value: escapeHtml(formatOfficialDate(closedAt)) },
          { label: 'الأصول المتوقعة', value: String(items.length) },
          { label: 'موجودة', value: String(found.length) },
          { label: 'غير موجودة', value: String(notFound.length) },
          { label: 'فروقات', value: String(diffs.length) },
          { label: 'أصول غير مسجلة', value: String(inv.unregistered.length) },
          ...(inv.reopenings.length ? [{ label: 'مرات إعادة الفتح', value: String(inv.reopenings.length) }] : []),
        ],
        table: rows.length
          ? { columns: ['رقم الأصل', 'الأصل', 'الموقع / القسم (المتوقع ← الفعلي)', 'المسؤول', 'الحالة'], rows }
          : undefined,
        notes: inv.notes,
        footer: [
          rows.length ? 'الجدول يبيّن الفروقات والأصول غير الموجودة وغير المسجلة فقط.' : 'لم تُسجَّل أي فروقات.',
          `أغلق الجرد ${escapeHtml(actor.name ?? '')} بتاريخ ${escapeHtml(formatOfficialDate(closedAt))}.`,
        ],
      },
      actor.id,
    );
  }

  // ── Exceptional reopening (spec §34) ──────────────────────────────────

  async reopen(id: string, reason: string, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ status: string; number: string }>>`SELECT status, number FROM inventories WHERE id = ${id}::uuid FOR UPDATE`;
      if (!rows.length) throw AppError.notFound('الجرد غير موجود.');
      if (rows[0].status !== 'CLOSED') throw AppError.invalidState('الجرد ليس مغلقًا.');
      // The reopening row must exist before the status change (enforced by a DB trigger).
      await tx.inventoryReopening.create({ data: { inventoryId: id, reason, actorId: actor.id! } });
      await tx.inventory.update({ where: { id }, data: { status: 'IN_PROGRESS', closedAt: null, closedById: null, version: { increment: 1 } } });
      await this.audit.record({ actor, operation: 'INVENTORY_REOPENED', entityType: 'Inventory', entityId: id, oldData: { status: 'CLOSED' }, newData: { status: 'IN_PROGRESS', reason } }, tx);
      await this.notifications.notify(
        { typeKey: 'inventory.reopened', title: `أُعيد فتح الجرد ${rows[0].number}`, body: `السبب: ${reason}`, entityType: 'Inventory', entityId: id },
        tx,
      );
      return { id, status: 'IN_PROGRESS' as const };
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async lockInProgress(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM inventories WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw AppError.notFound('الجرد غير موجود.');
    if (rows[0].status !== 'IN_PROGRESS') throw AppError.invalidState('الجرد مغلق ولا يمكن تعديله.');
    return tx.inventory.findUniqueOrThrow({ where: { id } });
  }

  private async assertInProgress(db: Tx | PrismaService, id: string) {
    const inv = await db.inventory.findUnique({ where: { id }, select: { status: true } });
    if (!inv) throw AppError.notFound('الجرد غير موجود.');
    if (inv.status !== 'IN_PROGRESS') throw AppError.invalidState('الجرد مغلق ولا يمكن تعديله.');
  }

  /** Actual responsible; defaults to the expected one. A changed responsible must be active (spec §46). */
  private async actualResponsible(tx: Tx, dto: CheckItemDto, item: { expectedResponsibleEmployeeId: string | null; expectedResponsibleExternalId: string | null }) {
    if (!dto.actualResponsibleType) {
      return { actualResponsibleEmployeeId: item.expectedResponsibleEmployeeId, actualResponsibleExternalId: item.expectedResponsibleExternalId };
    }
    if (dto.actualResponsibleType === 'EMPLOYEE') {
      if (!dto.actualResponsibleEapEmployeeId) throw AppError.validation({ actualResponsibleEapEmployeeId: ['اختر الموظف.'] });
      const e = await this.employees.ensureCached(dto.actualResponsibleEapEmployeeId, tx);
      if (!e.isActive && e.id !== item.expectedResponsibleEmployeeId) {
        throw AppError.validation({ actualResponsibleEapEmployeeId: ['الموظف غير فعّال في EAP ولا يمكن تعيينه مسؤولًا.'] });
      }
      return { actualResponsibleEmployeeId: e.id, actualResponsibleExternalId: null };
    }
    if (!dto.actualResponsibleExternalId) throw AppError.validation({ actualResponsibleExternalId: ['اختر الشخص الخارجي.'] });
    const p = await tx.externalPerson.findUnique({ where: { id: dto.actualResponsibleExternalId } });
    if (!p || (p.status !== 'ACTIVE' && p.id !== item.expectedResponsibleExternalId)) {
      throw AppError.validation({ actualResponsibleExternalId: ['الشخص الخارجي غير موجود أو معطّل.'] });
    }
    return { actualResponsibleEmployeeId: null, actualResponsibleExternalId: p.id };
  }
}
