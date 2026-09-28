import { Injectable } from '@nestjs/common';
import { OperationSequence, PERMISSIONS } from '@osooli/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { paging } from '../../common/pagination';
import { toJsonSafe } from '../../common/redact';
import type { RequestUser } from '../../common/request-user';
import { AuditActor, AuditService } from '../audit/audit.service';
import { AssetsService, snapshotOf } from '../assets/assets.service';
import { QrService } from '../assets/qr.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { escapeHtml } from '../pdf/pdf.service';
import { formatOfficialDate, OfficialDocumentService } from '../pdf/official-document.service';
import { CreateReturnDto, OperationListQueryDto } from './operations.dto';
import {
  ASSET_COLUMNS,
  assertNoPendingCustody,
  assertNotSold,
  assetCells,
  lockAssets,
  type ResponsibleRef,
  responsibleName,
  sameResponsible,
  statusAr,
  usersOfEmployees,
} from './operations.shared';

const RETURN_INCLUDE = {
  items: {
    include: {
      asset: { select: { id: true, assetNumber: true, name: true } },
      previousResponsibleEmployee: { select: { fullName: true } },
      previousResponsibleExternal: { select: { name: true } },
      newResponsibleEmployee: { select: { id: true, fullName: true } },
      newResponsibleExternal: { select: { id: true, name: true } },
    },
    orderBy: { asset: { assetNumber: 'asc' } },
  },
  documents: { where: { isOfficial: true }, select: { versions: { where: { isCurrent: true }, select: { fileId: true } } } },
} satisfies Prisma.CustodyReturnInclude;

/**
 * Custody return (spec §28): immediate, one record for several assets, each
 * with its own condition, notes and new responsible person. The condition at
 * return becomes the asset's status. Final at creation, with an archived PDF.
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly assets: AssetsService,
    private readonly notifications: NotificationsService,
    private readonly official: OfficialDocumentService,
    private readonly qr: QrService,
  ) {}

  async list(q: OperationListQueryDto) {
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.CustodyReturnWhereInput = {
      ...(q.assetId ? { items: { some: { assetId: q.assetId } } } : {}),
      ...(q.q
        ? {
            OR: [
              { number: { contains: q.q, mode: 'insensitive' } },
              { items: { some: { asset: { assetNumber: { contains: q.q, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.custodyReturn.findMany({
        where,
        skip,
        take,
        orderBy: { occurredAt: q.order === 'asc' ? 'asc' : 'desc' },
        include: { _count: { select: { items: true } } },
      }),
      this.prisma.custodyReturn.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(id: string, user: RequestUser) {
    const r = await this.prisma.custodyReturn.findUnique({ where: { id }, include: RETURN_INCLUDE });
    if (!r) throw AppError.notFound('محضر الإرجاع غير موجود.');
    const isParty = r.items.some((i) => i.newResponsibleEmployee?.id === user.employeeId);
    if (!user.permissions.has(PERMISSIONS.CUSTODY_VIEW) && !isParty) throw AppError.notFound('محضر الإرجاع غير موجود.');
    const actor = await this.prisma.user.findUnique({ where: { id: r.actorId }, select: { employee: { select: { fullName: true } } } });
    return toJsonSafe({ ...r, actorName: actor?.employee.fullName ?? null, officialFileId: r.documents[0]?.versions[0]?.fileId ?? null });
  }

  async create(dto: CreateReturnDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const assets = await lockAssets(tx, dto.items.map((i) => i.assetId));
      const targets: ResponsibleRef[] = [];
      for (const [i, item] of dto.items.entries()) {
        const a = assets[i];
        assertNotSold(a);
        await assertNoPendingCustody(tx, a);
        if (a.status === 'UNDER_MAINTENANCE') throw AppError.invalidState(`الأصل ${a.assetNumber} قيد الصيانة.`);
        const target = await this.assets.resolveResponsible(tx, item.newResponsible);
        if (sameResponsible(a, target)) {
          throw AppError.validation({ [`items.${i}.newResponsible`]: [`المسؤول الجديد هو المسؤول الحالي للأصل ${a.assetNumber}.`] });
        }
        targets.push(target);
      }

      const number = await this.numbering.allocateOperationNumber(tx, OperationSequence.CUSTODY_RETURN);
      const occurredAt = new Date();
      const ret = await tx.custodyReturn.create({
        data: {
          number,
          notes: dto.notes ?? null,
          actorId: actor.id!,
          occurredAt,
          items: {
            create: dto.items.map((item, i) => ({
              assetId: item.assetId,
              conditionAtReturn: item.condition,
              notes: item.notes ?? null,
              previousResponsibleEmployeeId: assets[i].responsibleEmployeeId,
              previousResponsibleExternalId: assets[i].responsibleExternalId,
              newResponsibleEmployeeId: targets[i].responsibleEmployeeId,
              newResponsibleExternalId: targets[i].responsibleExternalId,
              assetSnapshot: snapshotOf(assets[i]),
            })),
          },
        },
        include: RETURN_INCLUDE,
      });

      for (const [i, item] of dto.items.entries()) {
        await tx.asset.update({ where: { id: item.assetId }, data: { ...targets[i], status: item.condition, version: { increment: 1 } } });
      }
      const after = await lockAssets(tx, dto.items.map((i) => i.assetId));
      for (const [i, a] of after.entries()) {
        const row = ret.items.find((x) => x.assetId === a.id)!;
        await this.assets.event(
          tx,
          a.id,
          'CUSTODY_RETURNED',
          actor,
          { number, from: responsibleName(assets[i]), to: row.newResponsibleEmployee?.fullName ?? row.newResponsibleExternal?.name, condition: row.conditionAtReturn },
          snapshotOf(a),
          { type: 'CustodyReturn', id: ret.id },
        );
      }

      await this.official.archive(
        tx,
        { custodyReturnId: ret.id },
        {
          title: 'محضر إرجاع عهدة',
          number,
          date: occurredAt,
          fields: [
            { label: 'تاريخ الإرجاع', value: escapeHtml(formatOfficialDate(occurredAt)) },
            { label: 'نفّذه', value: escapeHtml(actor.name ?? '') },
            { label: 'عدد الأصول', value: String(assets.length) },
          ],
          table: {
            columns: [...ASSET_COLUMNS, 'المسؤول السابق', 'المسؤول الجديد', 'الحالة عند الإرجاع', 'ملاحظات'],
            rows: dto.items.map((item, i) => {
              const row = ret.items.find((x) => x.assetId === item.assetId)!;
              return [
                ...assetCells(assets[i]),
                escapeHtml(responsibleName(assets[i])),
                escapeHtml(row.newResponsibleEmployee?.fullName ?? row.newResponsibleExternal?.name ?? '—'),
                escapeHtml(statusAr(item.condition)),
                escapeHtml(item.notes ?? ''),
              ];
            }),
            qrs: await Promise.all(assets.map((a) => this.official.assetQr(this.qr.url(a.qrToken)))),
          },
          notes: dto.notes,
        },
        actor.id,
      );

      await this.audit.record(
        { actor, operation: 'CUSTODY_RETURN_CREATED', entityType: 'CustodyReturn', entityId: ret.id, newData: { number, assets: assets.map((a) => a.assetNumber) } },
        tx,
      );
      await this.notifications.notify(
        {
          typeKey: 'custody.returned',
          title: `محضر إرجاع ${number}`,
          body: `تم تسجيلك مسؤولًا عن أصل أو أكثر في محضر الإرجاع ${number}.`,
          entityType: 'CustodyReturn',
          entityId: ret.id,
          responsibleUserIds: await usersOfEmployees(tx, targets.map((t) => t.responsibleEmployeeId)),
        },
        tx,
      );
      return { id: ret.id, number };
    });
  }
}
