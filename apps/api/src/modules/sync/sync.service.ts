import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ErrorCode, PERMISSIONS, type PermissionKey } from '@osooli/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { redact } from '../../common/redact';
import { actorOf, type RequestUser } from '../../common/request-user';
import { flattenValidationErrors } from '../../common/validation';
import { AssetMediaService } from '../assets/asset-media.service';
import { AssetsService } from '../assets/assets.service';
import { CheckItemDto, UnregisteredDto } from '../inventory/inventory.dto';
import { InventoryService } from '../inventory/inventory.service';
import type { UploadedFile } from '../storage/storage.service';

/** Operations allowed offline (spec §52). Everything sensitive stays online-only. */
export const OFFLINE_OPERATIONS = ['inventory.check', 'inventory.unregistered', 'asset.photo', 'asset.notes'] as const;
export type OfflineOperation = (typeof OFFLINE_OPERATIONS)[number];

/** How many assets the offline cache may hold (spec §53: not the full database). */
const SNAPSHOT_ASSET_LIMIT = 20_000;
/** A submission stuck in SYNCING longer than this (e.g. a crash) may be processed again. */
const STALE_SYNCING_MS = 2 * 60_000;

/** Business outcomes that make an operation "Needs Review" instead of retrying it. */
const REVIEW_CODES = new Set<ErrorCode>([
  'CONFLICT',
  'STALE_VERSION',
  'INVALID_STATE',
  'ASSET_SOLD',
  'ASSET_NOT_FOUND',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'FILE_REJECTED',
  'FORBIDDEN',
  'DUPLICATE',
]);

export interface SyncOutcome {
  clientOperationId: string;
  status: 'SYNCED' | 'NEEDS_REVIEW';
  errorCode?: string;
  message?: string;
  result?: unknown;
}

/**
 * Offline support (spec §52–54): a limited snapshot for offline use, and
 * idempotent processing of queued offline operations. Each operation
 * carries the server state it was based on; if the server changed since,
 * the operation is rejected as "Needs Review" and nothing is overwritten.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetsService,
    private readonly media: AssetMediaService,
    private readonly inventory: InventoryService,
  ) {}

  // ── Snapshot (spec §52–53) ────────────────────────────────────────────

  /**
   * Minimal data for offline lookup and counting: no purchase values,
   * documents, people's contact details or audit data (spec §10, §53).
   */
  async snapshot(user: RequestUser) {
    const [assets, total, locations, inventories] = await Promise.all([
      this.prisma.asset.findMany({
        where: { status: { not: 'SOLD' } },
        take: SNAPSHOT_ASSET_LIMIT,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          assetNumber: true,
          name: true,
          qrToken: true,
          serialNumber: true,
          status: true,
          version: true,
          notes: true,
          locationDepartment: { select: { location: { select: { id: true, name: true } }, department: { select: { id: true, name: true } } } },
          responsibleEmployee: { select: { fullName: true } },
          responsibleExternal: { select: { name: true } },
        },
      }),
      this.prisma.asset.count({ where: { status: { not: 'SOLD' } } }),
      this.prisma.location.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          departments: {
            where: { status: 'ACTIVE', department: { status: 'ACTIVE' } },
            select: { department: { select: { id: true, name: true } } },
          },
        },
      }),
      user.permissions.has(PERMISSIONS.INVENTORY_MANAGE) ? this.openInventories() : Promise.resolve([]),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      userId: user.id,
      truncated: total > assets.length,
      assets: assets.map((a) => ({
        id: a.id,
        assetNumber: a.assetNumber,
        name: a.name,
        qrToken: a.qrToken,
        serialNumber: a.serialNumber,
        status: a.status,
        version: a.version,
        notes: a.notes,
        locationId: a.locationDepartment.location.id,
        location: a.locationDepartment.location.name,
        departmentId: a.locationDepartment.department.id,
        department: a.locationDepartment.department.name,
        responsible: a.responsibleEmployee?.fullName ?? a.responsibleExternal?.name ?? null,
      })),
      locations: locations.map((l) => ({ id: l.id, name: l.name, departments: l.departments.map((d) => d.department) })),
      inventories,
    };
  }

  private async openInventories() {
    const rows = await this.prisma.inventory.findMany({
      where: { status: 'IN_PROGRESS' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        number: true,
        scopes: { select: { location: { select: { name: true } }, department: { select: { name: true } } } },
        items: {
          select: {
            id: true,
            assetId: true,
            checkedAt: true,
            exists: true,
            expectedStatus: true,
            expectedLocationId: true,
            expectedDepartmentId: true,
            asset: { select: { assetNumber: true, name: true, qrToken: true, serialNumber: true } },
            expectedLocation: { select: { name: true } },
            expectedDepartment: { select: { name: true } },
          },
        },
      },
    });
    return rows.map((inv) => ({
      id: inv.id,
      number: inv.number,
      scope: inv.scopes.map((s) => `${s.location?.name ?? 'كل المواقع'} / ${s.department?.name ?? 'كل الأقسام'}`).join('، '),
      items: inv.items.map((i) => ({
        id: i.id,
        assetId: i.assetId,
        assetNumber: i.asset.assetNumber,
        name: i.asset.name,
        qrToken: i.asset.qrToken,
        serialNumber: i.asset.serialNumber,
        expectedStatus: i.expectedStatus,
        expectedLocationId: i.expectedLocationId,
        expectedDepartmentId: i.expectedDepartmentId,
        expectedPlace: `${i.expectedLocation.name} / ${i.expectedDepartment.name}`,
        checkedAt: i.checkedAt?.toISOString() ?? null,
        exists: i.exists,
      })),
    }));
  }

  // ── Operations (spec §54) ─────────────────────────────────────────────

  /** The user's recent offline operations as the server recorded them. */
  recent(user: RequestUser) {
    return this.prisma.syncOperation.findMany({
      where: { userId: user.id },
      orderBy: { receivedAt: 'desc' },
      take: 100,
      select: { clientOperationId: true, type: true, status: true, errorCode: true, result: true, clientCreatedAt: true, receivedAt: true, processedAt: true },
    });
  }

  async submit(
    user: RequestUser,
    type: OfflineOperation,
    clientOperationId: string,
    clientCreatedAt: Date,
    fields: Record<string, unknown>,
    file: UploadedFile | undefined,
  ): Promise<SyncOutcome> {
    const claimed = await this.claim(user, type, clientOperationId, clientCreatedAt, fields);
    if ('outcome' in claimed) return claimed.outcome;

    try {
      const result = await this.apply(user, type, fields, file, claimed.receivedAt);
      return this.finish(clientOperationId, { clientOperationId, status: 'SYNCED', result });
    } catch (e) {
      if (e instanceof AppError && REVIEW_CODES.has(e.code)) {
        return this.finish(clientOperationId, { clientOperationId, status: 'NEEDS_REVIEW', errorCode: e.code, message: e.message });
      }
      // Transient failure: release the claim so the client can retry the same operation.
      await this.prisma.syncOperation.update({ where: { clientOperationId }, data: { status: 'PENDING' } });
      throw e;
    }
  }

  /**
   * Records (or re-claims) the operation. A finished operation returns its
   * stored outcome, which makes retries idempotent.
   */
  private async claim(
    user: RequestUser,
    type: OfflineOperation,
    clientOperationId: string,
    clientCreatedAt: Date,
    fields: Record<string, unknown>,
  ): Promise<{ outcome: SyncOutcome } | { receivedAt: Date }> {
    const payload = redact(fields) as Prisma.InputJsonValue;
    try {
      const row = await this.prisma.syncOperation.create({
        data: { clientOperationId, userId: user.id, type, payload, clientCreatedAt, status: 'SYNCING', baseVersion: numberOrNull(fields.baseVersion) },
      });
      return { receivedAt: row.receivedAt };
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    const existing = await this.prisma.syncOperation.findUniqueOrThrow({ where: { clientOperationId } });
    if (existing.userId !== user.id) throw new AppError('CONFLICT', 'معرّف العملية مستخدم مسبقًا.');
    if (existing.status === 'SYNCED' || existing.status === 'NEEDS_REVIEW') {
      const stored = (existing.result ?? {}) as { message?: string; result?: unknown };
      return {
        outcome: {
          clientOperationId,
          status: existing.status,
          ...(existing.errorCode ? { errorCode: existing.errorCode } : {}),
          ...(stored.message ? { message: stored.message } : {}),
          ...(stored.result !== undefined ? { result: stored.result } : {}),
        },
      };
    }
    const stale = new Date(Date.now() - STALE_SYNCING_MS);
    const reclaimed = await this.prisma.syncOperation.updateMany({
      where: { clientOperationId, OR: [{ status: 'PENDING' }, { status: 'SYNCING', receivedAt: { lt: stale } }] },
      data: { status: 'SYNCING' },
    });
    if (reclaimed.count === 0) throw new AppError('CONFLICT', 'العملية قيد المعالجة حاليًا.');
    return { receivedAt: existing.receivedAt };
  }

  private async finish(clientOperationId: string, outcome: SyncOutcome): Promise<SyncOutcome> {
    if (outcome.status === 'NEEDS_REVIEW') this.logger.log({ clientOperationId, errorCode: outcome.errorCode }, 'Offline operation needs review');
    await this.prisma.syncOperation.update({
      where: { clientOperationId },
      data: {
        status: outcome.status,
        errorCode: outcome.errorCode ?? null,
        result: { message: outcome.message ?? null, result: (outcome.result ?? null) as Prisma.InputJsonValue },
        processedAt: new Date(),
      },
    });
    return outcome;
  }

  private async apply(user: RequestUser, type: OfflineOperation, fields: Record<string, unknown>, file: UploadedFile | undefined, receivedAt: Date) {
    const need = (p: PermissionKey) => {
      if (!user.permissions.has(p)) throw new AppError('FORBIDDEN');
    };
    const actor = actorOf(user);
    switch (type) {
      case 'inventory.check': {
        need(PERMISSIONS.INVENTORY_MANAGE);
        const inventoryId = uuidField(fields.inventoryId, 'inventoryId');
        const itemId = uuidField(fields.itemId, 'itemId');
        // Responsible changes are sensitive and online-only (spec §52).
        if (fields.actualResponsibleType) throw AppError.validation({ actualResponsibleType: ['تغيير المسؤول غير متاح بدون اتصال.'] });
        const dto = validated(CheckItemDto, fields);
        const item = await this.prisma.inventoryItem.findFirst({ where: { id: itemId, inventoryId }, include: { inventory: { select: { status: true } } } });
        if (!item) throw AppError.notFound('الأصل غير موجود في هذا الجرد.');
        if (item.inventory.status !== 'IN_PROGRESS') throw AppError.invalidState('أُغلق الجرد قبل مزامنة هذه العملية.');
        const base = typeof fields.baseCheckedAt === 'string' && fields.baseCheckedAt ? new Date(fields.baseCheckedAt).getTime() : null;
        const current = item.checkedAt?.getTime() ?? null;
        if (current !== base) {
          // Our own earlier attempt may have been applied before a lost response.
          const ours = item.checkedById === user.id && item.checkedAt && item.checkedAt >= receivedAt;
          if (!ours) throw new AppError('CONFLICT', 'فُحص هذا الأصل من مستخدم آخر أثناء عملك بدون اتصال. راجع النتيجة الحالية.');
          return { itemId, alreadyApplied: true };
        }
        const checked = (await this.inventory.check(inventoryId, itemId, dto, file, actor)) as { checkedAt: string };
        return { itemId, checkedAt: checked.checkedAt };
      }
      case 'inventory.unregistered': {
        need(PERMISSIONS.INVENTORY_MANAGE);
        const inventoryId = uuidField(fields.inventoryId, 'inventoryId');
        const row = await this.inventory.addUnregistered(inventoryId, validated(UnregisteredDto, fields), file, actor);
        return { id: row.id };
      }
      case 'asset.photo': {
        need(PERMISSIONS.ASSETS_EDIT);
        const photo = await this.media.addPhoto(uuidField(fields.assetId, 'assetId'), file, false, actor);
        return { photoId: photo.id };
      }
      case 'asset.notes': {
        need(PERMISSIONS.ASSETS_EDIT);
        const version = numberOrNull(fields.baseVersion);
        if (version === null) throw AppError.validation({ baseVersion: ['رقم النسخة مطلوب.'] });
        const notes = typeof fields.notes === 'string' ? fields.notes.slice(0, 2000) : '';
        const updated = await this.assets.update(uuidField(fields.assetId, 'assetId'), plainToInstance(UpdateNotes, { version, notes }), actor);
        return { version: updated.version };
      }
    }
  }
}

class UpdateNotes {
  version: number;
  notes: string;
}

function validated<T extends object>(cls: new () => T, fields: Record<string, unknown>): T {
  const dto = plainToInstance(cls, fields);
  const errors = validateSync(dto, { whitelist: true });
  if (errors.length) throw AppError.validation(flattenValidationErrors(errors));
  return dto;
}

function uuidField(v: unknown, name: string): string {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw AppError.validation({ [name]: ['المعرّف غير صالح.'] });
  return v;
}

function numberOrNull(v: unknown): number | null {
  const n = typeof v === 'string' && v !== '' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isInteger(n) ? n : null;
}
