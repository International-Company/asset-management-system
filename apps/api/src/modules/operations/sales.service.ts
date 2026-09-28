import { Injectable } from '@nestjs/common';
import { OperationSequence } from '@osooli/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { paging } from '../../common/pagination';
import { toJsonSafe } from '../../common/redact';
import { AuditActor, AuditService } from '../audit/audit.service';
import { AssetsService, snapshotOf } from '../assets/assets.service';
import { QrService } from '../assets/qr.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { escapeHtml } from '../pdf/pdf.service';
import { formatOfficialDate, ltr, OfficialDocumentService } from '../pdf/official-document.service';
import { StorageService, UploadedFile } from '../storage/storage.service';
import { CreateSaleDto, OperationListQueryDto } from './operations.dto';
import { ASSET_COLUMNS, assertNoOpenMaintenance, assertNoPendingCustody, assertNotSold, assetCells, lockAsset, statusAr } from './operations.shared';

const SALE_INCLUDE = {
  asset: { select: { id: true, assetNumber: true, name: true, qrToken: true } },
  documents: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, isOfficial: true, versions: { where: { isCurrent: true }, select: { fileId: true, file: { select: { originalName: true, mimeType: true } } } } },
  },
} satisfies Prisma.SaleInclude;

/**
 * Sale (spec §30). Allowed whatever the asset's current status; the asset
 * becomes SOLD and every later operation is blocked. The sale is final
 * (immutable row, archived PDF); its QR stays resolvable for history.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly assets: AssetsService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly official: OfficialDocumentService,
    private readonly qr: QrService,
  ) {}

  async list(q: OperationListQueryDto) {
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.SaleWhereInput = {
      ...(q.assetId ? { assetId: q.assetId } : {}),
      ...(q.q
        ? {
            OR: [
              { number: { contains: q.q, mode: 'insensitive' } },
              { buyerName: { contains: q.q, mode: 'insensitive' } },
              { referenceNumber: { contains: q.q, mode: 'insensitive' } },
              { asset: { assetNumber: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.sale.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: q.order === 'asc' ? 'asc' : 'desc' },
        include: { asset: { select: { id: true, assetNumber: true, name: true } } },
      }),
      this.prisma.sale.count({ where }),
    ]);
    return { items: toJsonSafe(items), total, page, pageSize };
  }

  async get(id: string) {
    const s = await this.prisma.sale.findUnique({ where: { id }, include: SALE_INCLUDE });
    if (!s) throw AppError.notFound('عملية البيع غير موجودة.');
    const actor = await this.prisma.user.findUnique({ where: { id: s.actorId }, select: { employee: { select: { fullName: true } } } });
    return toJsonSafe({ ...s, actorName: actor?.employee.fullName ?? null });
  }

  async create(dto: CreateSaleDto, files: UploadedFile[], actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const asset = await lockAsset(tx, dto.assetId);
      assertNotSold(asset);
      await assertNoPendingCustody(tx, asset);
      await assertNoOpenMaintenance(tx, asset);
      const currency = await tx.currency.findUnique({ where: { code: dto.currency } });
      if (!currency || currency.status !== 'ACTIVE') throw AppError.validation({ currency: ['العملة غير متاحة.'] });

      const number = await this.numbering.allocateOperationNumber(tx, OperationSequence.SALE);
      const snapshot = snapshotOf(asset);
      const sale = await tx.sale.create({
        data: {
          number,
          assetId: asset.id,
          saleDate: new Date(`${dto.saleDate}T00:00:00Z`),
          saleValue: dto.saleValue,
          currency: dto.currency,
          buyerName: dto.buyerName,
          buyerType: dto.buyerType,
          referenceNumber: dto.referenceNumber ?? null,
          notes: dto.notes ?? null,
          statusBeforeSale: asset.status,
          assetSnapshot: snapshot,
          actorId: actor.id!,
        },
      });
      // Sale documents and photos belong to the sale operation, not the asset.
      for (const file of files) {
        const stored = await this.storage.store(file, actor.id!, tx);
        await tx.document.create({
          data: {
            name: stored.originalName.replace(/\.[^.]+$/, ''),
            saleId: sale.id,
            createdById: actor.id,
            versions: { create: { version: 1, fileId: stored.id, uploadedById: actor.id } },
          },
        });
      }
      await tx.asset.update({ where: { id: asset.id }, data: { status: 'SOLD', version: { increment: 1 } } });

      await this.official.archive(
        tx,
        { saleId: sale.id },
        {
          title: 'محضر بيع أصل',
          number,
          date: sale.createdAt,
          fields: [
            { label: 'تاريخ البيع', value: escapeHtml(formatOfficialDate(sale.saleDate)) },
            { label: 'قيمة البيع', value: ltr(`${dto.saleValue} ${dto.currency}`) },
            { label: 'المشتري', value: escapeHtml(dto.buyerName) },
            { label: 'نوع المشتري', value: escapeHtml(dto.buyerType) },
            { label: 'الرقم المرجعي', value: ltr(dto.referenceNumber ?? null) },
            { label: 'حالة الأصل قبل البيع', value: escapeHtml(statusAr(asset.status)) },
            { label: 'المرفقات', value: files.length ? String(files.length) : 'لا يوجد' },
          ],
          table: { columns: ASSET_COLUMNS, rows: [assetCells(asset)], qrs: [await this.official.assetQr(this.qr.url(asset.qrToken))] },
          notes: dto.notes,
          footer: [`سُجّل البيع بواسطة ${escapeHtml(actor.name ?? '')}. عملية البيع نهائية ولا يمكن تعديلها.`],
        },
        actor.id,
      );
      await this.assets.event(tx, asset.id, 'SOLD', actor, { number, buyerName: dto.buyerName, saleValue: dto.saleValue, currency: dto.currency }, snapshot, {
        type: 'Sale',
        id: sale.id,
      });
      await this.audit.record(
        {
          actor,
          operation: 'SALE_CREATED',
          entityType: 'Sale',
          entityId: sale.id,
          oldData: { assetStatus: asset.status },
          newData: { number, assetNumber: asset.assetNumber, saleValue: dto.saleValue, currency: dto.currency, buyerName: dto.buyerName },
        },
        tx,
      );
      await this.notifications.notify(
        { typeKey: 'sale.created', title: `بيع الأصل ${asset.assetNumber} (${number})`, body: `المشتري: ${dto.buyerName}`, entityType: 'Sale', entityId: sale.id },
        tx,
      );
      return { id: sale.id, number };
    });
  }
}
