import { ASSET_STATUS_LABELS, MAIN_CATEGORY_LABELS } from '@osooli/shared';
import { Prisma } from '../../generated/prisma/client';
import { Tx } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { escapeHtml } from '../pdf/pdf.service';
import { ltr } from '../pdf/official-document.service';
import { ASSET_DETAIL_INCLUDE } from '../assets/assets.service';

export type LockedAsset = Prisma.AssetGetPayload<{ include: typeof ASSET_DETAIL_INCLUDE }>;

/**
 * Row-locks assets for an operation (spec §59). Locks are taken in id order
 * so two operations on overlapping sets cannot deadlock; the loser waits,
 * then sees the winner's changes and fails its own checks cleanly.
 */
export async function lockAssets(tx: Tx, ids: string[]): Promise<LockedAsset[]> {
  const unique = [...new Set(ids)].sort();
  if (unique.length !== ids.length) throw AppError.validation({ items: ['أصل مكرر في نفس العملية.'] });
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM assets WHERE id = ANY(${unique}::uuid[]) ORDER BY id FOR UPDATE`;
  if (rows.length !== unique.length) throw new AppError('ASSET_NOT_FOUND', 'أحد الأصول المحددة غير موجود.');
  const assets = await tx.asset.findMany({ where: { id: { in: unique } }, include: ASSET_DETAIL_INCLUDE });
  const byId = new Map(assets.map((a) => [a.id, a]));
  return ids.map((id) => byId.get(id)!);
}

export async function lockAsset(tx: Tx, id: string): Promise<LockedAsset> {
  return (await lockAssets(tx, [id]))[0];
}

/** Sold assets allow no operations (spec §30). */
export function assertNotSold(a: LockedAsset): void {
  if (a.status === 'SOLD') throw new AppError('ASSET_SOLD', `الأصل ${a.assetNumber} مباع ولا يمكن تنفيذ عمليات عليه.`);
}

export async function assertNoPendingCustody(tx: Tx, a: LockedAsset): Promise<void> {
  const pending = await tx.custodyItem.findFirst({ where: { assetId: a.id, isPending: true }, include: { custody: { select: { number: true } } } });
  if (pending) {
    throw AppError.invalidState(`الأصل ${a.assetNumber} مدرج في محضر العهدة ${pending.custody.number} بانتظار التأكيد. يجب تأكيده أو إلغاؤه أولًا.`);
  }
}

export async function assertNoOpenMaintenance(tx: Tx, a: LockedAsset): Promise<void> {
  const open = await tx.maintenance.findFirst({ where: { assetId: a.id, status: { not: 'CLOSED' } }, select: { number: true } });
  if (open) throw AppError.invalidState(`للأصل ${a.assetNumber} طلب صيانة مفتوح (${open.number}). يجب إنهاؤه أولًا.`);
}

export interface ResponsibleRef {
  responsibleEmployeeId: string | null;
  responsibleExternalId: string | null;
}

export function sameResponsible(a: ResponsibleRef, b: ResponsibleRef): boolean {
  return a.responsibleEmployeeId === b.responsibleEmployeeId && a.responsibleExternalId === b.responsibleExternalId;
}

export function responsibleName(a: Pick<LockedAsset, 'responsibleEmployee' | 'responsibleExternal'>): string {
  return a.responsibleEmployee?.fullName ?? a.responsibleExternal?.name ?? '—';
}

/** Users who should hear about an operation concerning these employees (their own accounts). */
export async function usersOfEmployees(tx: Tx, employeeIds: Array<string | null | undefined>): Promise<string[]> {
  const ids = employeeIds.filter((x): x is string => !!x);
  if (!ids.length) return [];
  const users = await tx.user.findMany({ where: { employeeId: { in: ids }, isActive: true }, select: { id: true } });
  return users.map((u) => u.id);
}

/** Table cells describing an asset in official documents. */
export function assetCells(a: LockedAsset): string[] {
  return [
    ltr(a.assetNumber),
    escapeHtml(a.name),
    escapeHtml(`${MAIN_CATEGORY_LABELS[a.mainCategory]} / ${a.subcategory.name}`),
    ltr(a.serialNumber),
    escapeHtml(`${a.locationDepartment.location.name} / ${a.locationDepartment.department.name}`),
  ];
}

export const ASSET_COLUMNS = ['رقم الأصل', 'اسم الأصل', 'الفئة', 'الرقم التسلسلي', 'الموقع / القسم'];

export const statusAr = (s: keyof typeof ASSET_STATUS_LABELS | string) =>
  ASSET_STATUS_LABELS[s as keyof typeof ASSET_STATUS_LABELS] ?? s;
