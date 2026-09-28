import { Injectable } from '@nestjs/common';
import { OperationSequence, PERMISSIONS } from '@osooli/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { paging } from '../../common/pagination';
import { toJsonSafe } from '../../common/redact';
import type { RequestUser } from '../../common/request-user';
import { actorOf } from '../../common/request-user';
import { AuditActor, AuditService } from '../audit/audit.service';
import { AssetsService, snapshotOf } from '../assets/assets.service';
import { QrService } from '../assets/qr.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { escapeHtml } from '../pdf/pdf.service';
import { formatOfficialDate, ltr, OfficialDocumentService } from '../pdf/official-document.service';
import { CreateCustodyDto, CustodyListQueryDto } from './operations.dto';
import {
  ASSET_COLUMNS,
  assertNoOpenMaintenance,
  assertNotSold,
  assetCells,
  lockAssets,
  responsibleName,
  sameResponsible,
  statusAr,
  usersOfEmployees,
} from './operations.shared';

const CUSTODY_INCLUDE = {
  newResponsibleEmployee: { select: { id: true, eapEmployeeId: true, fullName: true, isActive: true } },
  newResponsibleExternal: { select: { id: true, name: true, organization: true } },
  items: {
    include: {
      asset: { select: { id: true, assetNumber: true, name: true, status: true } },
      previousResponsibleEmployee: { select: { id: true, fullName: true } },
      previousResponsibleExternal: { select: { id: true, name: true } },
    },
    orderBy: { asset: { assetNumber: 'asc' } },
  },
  documents: {
    where: { isOfficial: true },
    select: { id: true, name: true, versions: { where: { isCurrent: true }, select: { fileId: true } } },
  },
} satisfies Prisma.CustodyInclude;

type CustodyRow = Prisma.CustodyGetPayload<{ include: typeof CUSTODY_INCLUDE }>;

/** Assets in these states cannot be handed over. */
const NOT_HANDABLE = new Set(['SOLD', 'LOST', 'DISPOSED', 'UNDER_MAINTENANCE']);

/**
 * Custody records (spec §24–29). A record may hold several assets; the new
 * responsible person confirms or rejects receipt; an Asset Manager may
 * cancel it while pending. Final records are immutable (DB triggers).
 */
@Injectable()
export class CustodyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly assets: AssetsService,
    private readonly notifications: NotificationsService,
    private readonly official: OfficialDocumentService,
    private readonly qr: QrService,
  ) {}

  /**
   * Who may confirm or reject: the new responsible employee themself, or —
   * for an external person, who has no account — a user holding
   * custody.confirm_external, acting on their behalf (audited).
   */
  canAct(c: { newResponsibleEmployeeId: string | null; newResponsibleExternalId: string | null }, user: RequestUser): boolean {
    if (c.newResponsibleEmployeeId) return c.newResponsibleEmployeeId === user.employeeId;
    return user.permissions.has(PERMISSIONS.CUSTODY_CONFIRM_EXTERNAL);
  }

  // ── Read ──────────────────────────────────────────────────────────────

  async list(q: CustodyListQueryDto) {
    const { skip, take, page, pageSize } = paging(q);
    const where: Prisma.CustodyWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.assetId ? { items: { some: { assetId: q.assetId } } } : {}),
      ...(q.q
        ? {
            OR: [
              { number: { contains: q.q, mode: 'insensitive' } },
              { newResponsibleEmployee: { fullName: { contains: q.q, mode: 'insensitive' } } },
              { newResponsibleExternal: { name: { contains: q.q, mode: 'insensitive' } } },
              { items: { some: { asset: { assetNumber: { contains: q.q, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.custody.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: q.order === 'asc' ? 'asc' : 'desc' },
        include: {
          newResponsibleEmployee: { select: { fullName: true } },
          newResponsibleExternal: { select: { name: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.custody.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /** Pending records the signed-in user can confirm or reject. */
  async pendingFor(user: RequestUser) {
    const or: Prisma.CustodyWhereInput[] = [{ newResponsibleEmployeeId: user.employeeId }];
    if (user.permissions.has(PERMISSIONS.CUSTODY_CONFIRM_EXTERNAL)) or.push({ newResponsibleExternalId: { not: null } });
    return this.prisma.custody.findMany({
      where: { status: 'PENDING', OR: or },
      orderBy: { createdAt: 'asc' },
      include: {
        newResponsibleEmployee: { select: { fullName: true } },
        newResponsibleExternal: { select: { name: true } },
        items: { select: { asset: { select: { assetNumber: true, name: true } } } },
      },
    });
  }

  /** Readable by custody viewers and by the party who must confirm. */
  async get(id: string, user: RequestUser) {
    const c = await this.prisma.custody.findUnique({ where: { id }, include: CUSTODY_INCLUDE });
    if (!c) throw AppError.notFound('محضر العهدة غير موجود.');
    const canAct = this.canAct(c, user);
    if (!user.permissions.has(PERMISSIONS.CUSTODY_VIEW) && !canAct) throw AppError.notFound('محضر العهدة غير موجود.');
    return { ...toJsonSafe(await this.withNames(c)) as object, canAct: canAct && c.status === 'PENDING' };
  }

  // ── Create (spec §24) ─────────────────────────────────────────────────

  async create(dto: CreateCustodyDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const newResponsible = await this.assets.resolveResponsible(tx, dto.newResponsible);
      const assets = await lockAssets(tx, dto.items.map((i) => i.assetId));
      for (const a of assets) {
        assertNotSold(a);
        if (NOT_HANDABLE.has(a.status)) {
          throw AppError.invalidState(`لا يمكن تسليم الأصل ${a.assetNumber} كعهدة وحالته «${statusAr(a.status)}».`);
        }
        if (sameResponsible(a, newResponsible)) {
          throw AppError.validation({ newResponsible: [`المسؤول الجديد هو المسؤول الحالي للأصل ${a.assetNumber}.`] });
        }
        await assertNoOpenMaintenance(tx, a);
      }

      const number = await this.numbering.allocateOperationNumber(tx, OperationSequence.CUSTODY);
      const custody = await tx.custody.create({
        data: {
          number,
          ...(newResponsible.responsibleEmployeeId
            ? { newResponsibleEmployeeId: newResponsible.responsibleEmployeeId }
            : { newResponsibleExternalId: newResponsible.responsibleExternalId }),
          notes: dto.notes ?? null,
          createdById: actor.id!,
          items: {
            create: dto.items.map((item, i) => ({
              assetId: item.assetId,
              conditionAtHandover: item.condition,
              notes: item.notes ?? null,
              previousResponsibleEmployeeId: assets[i].responsibleEmployeeId,
              previousResponsibleExternalId: assets[i].responsibleExternalId,
              assetSnapshot: snapshotOf(assets[i]),
            })),
          },
        },
        include: CUSTODY_INCLUDE,
      });
      const to = custody.newResponsibleEmployee?.fullName ?? custody.newResponsibleExternal?.name;
      for (const a of assets) {
        await this.assets.event(tx, a.id, 'CUSTODY_CREATED', actor, { number, to, from: responsibleName(a) }, undefined, { type: 'Custody', id: custody.id });
      }
      await this.audit.record(
        { actor, operation: 'CUSTODY_CREATED', entityType: 'Custody', entityId: custody.id, newData: { number, to, assets: assets.map((a) => a.assetNumber) } },
        tx,
      );
      await this.notifications.notify(
        {
          typeKey: 'custody.created',
          title: `محضر عهدة ${number} بانتظار تأكيد استلامك`,
          body: `${assets.length} أصل. يرجى مراجعة المحضر وتأكيد الاستلام أو رفضه.`,
          entityType: 'Custody',
          entityId: custody.id,
          responsibleUserIds: await usersOfEmployees(tx, [newResponsible.responsibleEmployeeId]),
        },
        tx,
      );
      return { id: custody.id, number };
    });
  }

  // ── Confirm (spec §25) ────────────────────────────────────────────────

  async confirm(id: string, user: RequestUser) {
    const actor = actorOf(user);
    return this.prisma.transaction(async (tx) => {
      const c = await this.lockPending(tx, id);
      if (!this.canAct(c, user)) throw AppError.forbidden('تأكيد الاستلام متاح للمسؤول الجديد فقط.');
      if (c.newResponsibleEmployee && !c.newResponsibleEmployee.isActive) {
        throw AppError.invalidState('المسؤول الجديد غير فعّال في EAP؛ يجب إلغاء المحضر.');
      }

      const assets = await lockAssets(tx, c.items.map((i) => i.assetId));
      for (const a of assets) assertNotSold(a);
      const newResponsible = { responsibleEmployeeId: c.newResponsibleEmployeeId, responsibleExternalId: c.newResponsibleExternalId };
      for (const a of assets) {
        await tx.asset.update({ where: { id: a.id }, data: { ...newResponsible, status: 'IN_USE', version: { increment: 1 } } });
      }
      await tx.custodyItem.updateMany({ where: { custodyId: id, isPending: true }, data: { isPending: false } });
      const confirmedAt = new Date();
      await tx.custody.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt, confirmedById: user.id } });

      const after = await lockAssets(tx, assets.map((a) => a.id));
      const to = c.newResponsibleEmployee?.fullName ?? c.newResponsibleExternal?.name ?? '';
      for (const a of after) {
        await this.assets.event(tx, a.id, 'CUSTODY_CONFIRMED', actor, { number: c.number, to }, snapshotOf(a), { type: 'Custody', id });
      }

      const onBehalf = !c.newResponsibleEmployeeId;
      await this.official.archive(
        tx,
        { custodyId: id },
        {
          title: 'محضر تسليم عهدة',
          number: c.number,
          date: confirmedAt,
          fields: [
            { label: 'المسؤول الجديد (المستلم)', value: escapeHtml(to) + (onBehalf ? ' (شخص خارجي)' : '') },
            { label: 'تاريخ إنشاء المحضر', value: escapeHtml(formatOfficialDate(c.createdAt)) },
            { label: 'تاريخ تأكيد الاستلام', value: escapeHtml(formatOfficialDate(confirmedAt)) },
            { label: 'عدد الأصول', value: String(assets.length) },
          ],
          table: {
            columns: [...ASSET_COLUMNS, 'المسؤول السابق', 'الحالة عند التسليم', 'ملاحظات'],
            rows: c.items.map((item) => {
              const a = assets.find((x) => x.id === item.assetId)!;
              return [
                ...assetCells(a),
                escapeHtml(item.previousResponsibleEmployee?.fullName ?? item.previousResponsibleExternal?.name ?? '—'),
                escapeHtml(statusAr(item.conditionAtHandover)),
                escapeHtml(item.notes ?? ''),
              ];
            }),
            qrs: await Promise.all(assets.map((a) => this.official.assetQr(this.qr.url(a.qrToken)))),
          },
          notes: c.notes,
          footer: [
            onBehalf
              ? `تم تأكيد الاستلام إلكترونيًا بالنيابة عن الشخص الخارجي ${escapeHtml(to)} بواسطة ${escapeHtml(user.fullName)} بتاريخ ${escapeHtml(formatOfficialDate(confirmedAt))}.`
              : `تم تأكيد الاستلام إلكترونيًا بواسطة المستلم ${escapeHtml(user.fullName)} بتاريخ ${escapeHtml(formatOfficialDate(confirmedAt))}.`,
            `المحضر: ${ltr(c.number)}`,
          ],
        },
        user.id,
      );

      await this.audit.record(
        {
          actor,
          operation: 'CUSTODY_CONFIRMED',
          entityType: 'Custody',
          entityId: id,
          oldData: { status: 'PENDING' },
          newData: { status: 'CONFIRMED', number: c.number, onBehalfOfExternal: onBehalf },
        },
        tx,
      );
      await this.notifications.notify(
        { typeKey: 'custody.confirmed', title: `تم تأكيد استلام العهدة ${c.number}`, body: `المستلم: ${to}`, entityType: 'Custody', entityId: id },
        tx,
      );
      return { id, number: c.number, status: 'CONFIRMED' as const };
    });
  }

  // ── Reject (spec §26) & cancel (spec §27) ─────────────────────────────

  async reject(id: string, reason: string, user: RequestUser) {
    const actor = actorOf(user);
    return this.prisma.transaction(async (tx) => {
      const c = await this.lockPending(tx, id);
      if (!this.canAct(c, user)) throw AppError.forbidden('رفض الاستلام متاح للمسؤول الجديد فقط.');
      await tx.custodyItem.updateMany({ where: { custodyId: id, isPending: true }, data: { isPending: false } });
      await tx.custody.update({ where: { id }, data: { status: 'REJECTED', rejectedAt: new Date(), rejectedById: user.id, rejectionReason: reason } });
      for (const item of c.items) {
        await this.assets.event(tx, item.assetId, 'CUSTODY_REJECTED', actor, { number: c.number, reason }, undefined, { type: 'Custody', id });
      }
      await this.audit.record(
        { actor, operation: 'CUSTODY_REJECTED', entityType: 'Custody', entityId: id, oldData: { status: 'PENDING' }, newData: { status: 'REJECTED', reason } },
        tx,
      );
      await this.notifications.notify(
        { typeKey: 'custody.rejected', title: `رُفض استلام العهدة ${c.number}`, body: `السبب: ${reason}`, entityType: 'Custody', entityId: id },
        tx,
      );
      return { id, number: c.number, status: 'REJECTED' as const };
    });
  }

  /** Cancels a pending record. Nothing about the assets changes; the record stays in history. */
  async cancel(id: string, reason: string, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const c = await this.lockPending(tx, id);
      await tx.custodyItem.updateMany({ where: { custodyId: id, isPending: true }, data: { isPending: false } });
      await tx.custody.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: actor.id, cancellationReason: reason } });
      for (const item of c.items) {
        await this.assets.event(tx, item.assetId, 'CUSTODY_CANCELLED', actor, { number: c.number, reason }, undefined, { type: 'Custody', id });
      }
      await this.audit.record(
        { actor, operation: 'CUSTODY_CANCELLED', entityType: 'Custody', entityId: id, oldData: { status: 'PENDING' }, newData: { status: 'CANCELLED', reason } },
        tx,
      );
      await this.notifications.notify(
        {
          typeKey: 'custody.cancelled',
          title: `أُلغي محضر العهدة ${c.number}`,
          body: `السبب: ${reason}`,
          entityType: 'Custody',
          entityId: id,
          responsibleUserIds: await usersOfEmployees(tx, [c.newResponsibleEmployeeId]),
        },
        tx,
      );
      return { id, number: c.number, status: 'CANCELLED' as const };
    });
  }

  // ── Current custody view (spec §29) ───────────────────────────────────

  async currentForAsset(assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: {
        createdAt: true,
        responsibleEmployee: { select: { fullName: true, isActive: true } },
        responsibleExternal: { select: { name: true } },
      },
    });
    if (!asset) throw new AppError('ASSET_NOT_FOUND');
    const officialFile = { where: { isOfficial: true }, select: { versions: { where: { isCurrent: true }, select: { fileId: true } } } } as const;
    const [pending, lastHandover, lastReturn] = await Promise.all([
      this.prisma.custody.findFirst({ where: { status: 'PENDING', items: { some: { assetId } } }, select: { id: true, number: true, createdAt: true } }),
      this.prisma.custody.findFirst({
        where: { status: 'CONFIRMED', items: { some: { assetId } } },
        orderBy: { confirmedAt: 'desc' },
        select: { id: true, number: true, confirmedAt: true, documents: officialFile },
      }),
      this.prisma.custodyReturnItem.findFirst({
        where: { assetId },
        orderBy: { custodyReturn: { occurredAt: 'desc' } },
        select: { custodyReturn: { select: { id: true, number: true, occurredAt: true, documents: officialFile } } },
      }),
    ]);
    const handoverAt = lastHandover?.confirmedAt ?? null;
    const returnAt = lastReturn?.custodyReturn.occurredAt ?? null;
    // The current custody came from whichever happened last: a confirmed handover or a return.
    const current =
      handoverAt && (!returnAt || handoverAt > returnAt)
        ? { kind: 'CUSTODY', id: lastHandover!.id, number: lastHandover!.number, since: handoverAt, documentFileId: lastHandover!.documents[0]?.versions[0]?.fileId ?? null }
        : returnAt
          ? { kind: 'RETURN', id: lastReturn!.custodyReturn.id, number: lastReturn!.custodyReturn.number, since: returnAt, documentFileId: lastReturn!.custodyReturn.documents[0]?.versions[0]?.fileId ?? null }
          : null;
    return {
      responsible: asset.responsibleEmployee?.fullName ?? asset.responsibleExternal?.name ?? null,
      responsibleActive: asset.responsibleEmployee ? asset.responsibleEmployee.isActive : true,
      since: current?.since ?? asset.createdAt,
      current,
      pending,
      lastHandover: lastHandover ? { id: lastHandover.id, number: lastHandover.number, at: lastHandover.confirmedAt } : null,
      lastReturn: lastReturn ? { id: lastReturn.custodyReturn.id, number: lastReturn.custodyReturn.number, at: lastReturn.custodyReturn.occurredAt } : null,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async lockPending(tx: Tx, id: string): Promise<CustodyRow> {
    const rows = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM custodies WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw AppError.notFound('محضر العهدة غير موجود.');
    if (rows[0].status !== 'PENDING') throw AppError.invalidState('المحضر لم يعد بانتظار التأكيد.');
    return tx.custody.findUniqueOrThrow({ where: { id }, include: CUSTODY_INCLUDE });
  }

  private async withNames(c: CustodyRow) {
    const ids = [c.createdById, c.confirmedById, c.rejectedById, c.cancelledById].filter((x): x is string => !!x);
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, employee: { select: { fullName: true } } } });
    const name = (id: string | null) => (id ? (users.find((u) => u.id === id)?.employee.fullName ?? null) : null);
    return {
      ...c,
      createdByName: name(c.createdById),
      confirmedByName: name(c.confirmedById),
      rejectedByName: name(c.rejectedById),
      cancelledByName: name(c.cancelledById),
      officialFileId: c.documents[0]?.versions[0]?.fileId ?? null,
    };
  }
}
