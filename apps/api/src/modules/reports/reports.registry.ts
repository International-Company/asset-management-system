import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ASSET_STATUS_LABELS,
  AssetStatus,
  CUSTODY_STATUS_LABELS,
  CustodyStatus,
  ENTITY_LABELS,
  INVENTORY_STATUS_LABELS,
  InventoryStatus,
  MAIN_CATEGORY_LABELS,
  type MainCategoryCode,
  MAINTENANCE_STATUS_LABELS,
  MaintenanceStatus,
  operationLabel,
  PERMISSIONS,
  type PermissionKey,
  SECURITY_EVENT_LABELS,
  TECHNICIAN_TYPE_LABELS,
} from '@osooli/shared';
import { Prisma, SecurityEventType } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { flattenValidationErrors } from '../../common/validation';
import { AssetListQueryDto } from '../assets/assets.dto';
import { assetWhere } from '../assets/assets.service';

export type Cell = string | number | null;

export interface ReportColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'money';
}

export type FilterType = 'text' | 'date' | 'select' | 'location' | 'department' | 'category';

export interface ReportFilter {
  key: string;
  label: string;
  type: FilterType;
  options?: Array<[value: string, label: string]>;
}

export interface ReportResult {
  rows: Array<Record<string, Cell>>;
  total: number;
  summary?: Array<{ label: string; value: string }>;
}

export interface ReportDef {
  key: string;
  title: string;
  description: string;
  /** Required in addition to reports.view. */
  permissions: PermissionKey[];
  filters: ReportFilter[];
  columns: ReportColumn[];
  landscape?: boolean;
  run(prisma: PrismaService, filters: Record<string, string>, limit: number): Promise<ReportResult>;
}

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Hebron',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
/** "2026-09-27 14:05" in company time (spec: Asia/Hebron). */
export function fmtDateTime(d: Date | null | undefined): string | null {
  return d ? dateFmt.format(d).replace(',', '') : null;
}
const fmtDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const money = (v: Prisma.Decimal | null | undefined) => (v === null || v === undefined ? null : Number(v.toString()));

const day = (d: string, end = false) => new Date(`${d.slice(0, 10)}T${end ? '23:59:59.999' : '00:00:00'}Z`);
function range(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: day(from) } : {}), ...(to ? { lte: day(to, true) } : {}) };
}
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const statusOptions = Object.values(AssetStatus).map((s) => [s, ASSET_STATUS_LABELS[s]] as [string, string]);
const DATE_RANGE: ReportFilter[] = [
  { key: 'from', label: 'من تاريخ', type: 'date' },
  { key: 'to', label: 'إلى تاريخ', type: 'date' },
];

/** Totals per currency, e.g. "1,200.00 USD · 3,400.00 ILS". */
function totalsByCurrency(rows: Array<{ value: number | null; currency: string | null }>): string {
  const sums = new Map<string, number>();
  for (const r of rows) if (r.value !== null && r.currency) sums.set(r.currency, (sums.get(r.currency) ?? 0) + r.value);
  return [...sums].map(([c, v]) => `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`).join(' · ') || '—';
}

type GroupKey = 'locationId' | 'departmentId' | 'subcategoryId';
type StatusGroup = { status: AssetStatus; _count: number } & Partial<Record<GroupKey, string>>;

/** Counts assets per group key and status, for the location/department/category/status reports. */
async function statusBreakdown(prisma: PrismaService, by: GroupKey | 'status', filters: Record<string, string>): Promise<StatusGroup[]> {
  const where: Prisma.AssetWhereInput = {
    ...(filters.mainCategory ? { mainCategory: filters.mainCategory as MainCategoryCode } : {}),
    ...(filters.locationId ? { locationId: filters.locationId } : {}),
  };
  const groups = await prisma.asset.groupBy({ by: by === 'status' ? ['status'] : [by, 'status'], where, _count: true });
  return groups;
}

const BREAKDOWN_COLUMNS: ReportColumn[] = [
  { key: 'total', label: 'الإجمالي', type: 'number' },
  ...Object.values(AssetStatus).map((s) => ({ key: s, label: ASSET_STATUS_LABELS[s], type: 'number' as const })),
];

function pivot(groups: StatusGroup[], key: GroupKey, names: Map<string, string>) {
  const rows = new Map<string, Record<string, Cell>>();
  for (const g of groups) {
    const id = g[key] ?? '';
    const row = rows.get(id) ?? { name: names.get(id) ?? '—', total: 0, ...Object.fromEntries(Object.values(AssetStatus).map((s) => [s, 0])) };
    row[g.status] = (row[g.status] as number) + g._count;
    row.total = (row.total as number) + g._count;
    rows.set(id, row);
  }
  return [...rows.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
}

export const REPORTS: ReportDef[] = [
  {
    key: 'assets',
    title: 'تقرير الأصول',
    description: 'قائمة الأصول مع بيانات الفئة والموقع والمسؤول والشراء.',
    permissions: [PERMISSIONS.ASSETS_VIEW],
    landscape: true,
    filters: [
      { key: 'q', label: 'بحث', type: 'text' },
      { key: 'mainCategory', label: 'الفئة', type: 'category' },
      { key: 'status', label: 'الحالة', type: 'select', options: statusOptions },
      { key: 'locationId', label: 'الموقع', type: 'location' },
      { key: 'departmentId', label: 'القسم', type: 'department' },
      { key: 'createdFrom', label: 'أُنشئ من', type: 'date' },
      { key: 'createdTo', label: 'أُنشئ إلى', type: 'date' },
      { key: 'warrantyUntil', label: 'ضمان ينتهي قبل', type: 'date' },
    ],
    columns: [
      { key: 'assetNumber', label: 'رقم الأصل' },
      { key: 'name', label: 'اسم الأصل' },
      { key: 'category', label: 'الفئة' },
      { key: 'subcategory', label: 'الفئة الفرعية' },
      { key: 'serialNumber', label: 'الرقم التسلسلي' },
      { key: 'status', label: 'الحالة' },
      { key: 'location', label: 'الموقع' },
      { key: 'department', label: 'القسم' },
      { key: 'responsible', label: 'المسؤول' },
      { key: 'purchaseDate', label: 'تاريخ الشراء' },
      { key: 'purchaseValue', label: 'قيمة الشراء', type: 'money' },
      { key: 'currency', label: 'العملة' },
      { key: 'createdAt', label: 'تاريخ الإنشاء' },
    ],
    async run(prisma, filters, limit) {
      const q = plainToInstance(AssetListQueryDto, filters);
      const errors = validateSync(q, { whitelist: true, forbidNonWhitelisted: false });
      if (errors.length) throw AppError.validation(flattenValidationErrors(errors));
      const where = assetWhere(q);
      const [assets, total] = await Promise.all([
        prisma.asset.findMany({
          where,
          take: limit,
          orderBy: { assetNumber: 'asc' },
          include: {
            subcategory: { select: { name: true } },
            locationDepartment: { select: { location: { select: { name: true } }, department: { select: { name: true } } } },
            responsibleEmployee: { select: { fullName: true } },
            responsibleExternal: { select: { name: true } },
          },
        }),
        prisma.asset.count({ where }),
      ]);
      return {
        total,
        rows: assets.map((a) => ({
          assetNumber: a.assetNumber,
          name: a.name,
          category: MAIN_CATEGORY_LABELS[a.mainCategory],
          subcategory: a.subcategory.name,
          serialNumber: a.serialNumber,
          status: ASSET_STATUS_LABELS[a.status],
          location: a.locationDepartment.location.name,
          department: a.locationDepartment.department.name,
          responsible: a.responsibleEmployee?.fullName ?? a.responsibleExternal?.name ?? null,
          purchaseDate: fmtDate(a.purchaseDate),
          purchaseValue: money(a.purchaseValue),
          currency: a.purchaseCurrency,
          createdAt: fmtDateTime(a.createdAt),
        })),
      };
    },
  },
  {
    key: 'custody',
    title: 'تقرير محاضر العهدة',
    description: 'محاضر العهدة وحالاتها ومستلميها.',
    permissions: [PERMISSIONS.CUSTODY_VIEW],
    filters: [{ key: 'status', label: 'الحالة', type: 'select', options: Object.values(CustodyStatus).map((s) => [s, CUSTODY_STATUS_LABELS[s]]) }, ...DATE_RANGE],
    columns: [
      { key: 'number', label: 'رقم المحضر' },
      { key: 'status', label: 'الحالة' },
      { key: 'to', label: 'المسؤول الجديد' },
      { key: 'assets', label: 'عدد الأصول', type: 'number' },
      { key: 'createdAt', label: 'تاريخ الإنشاء' },
      { key: 'confirmedAt', label: 'تاريخ التأكيد' },
      { key: 'reason', label: 'سبب الرفض / الإلغاء' },
    ],
    async run(prisma, f, limit) {
      const where: Prisma.CustodyWhereInput = { ...(f.status ? { status: f.status as CustodyStatus } : {}), ...(range(f.from, f.to) ? { createdAt: range(f.from, f.to) } : {}) };
      const [rows, total] = await Promise.all([
        prisma.custody.findMany({
          where,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: { newResponsibleEmployee: { select: { fullName: true } }, newResponsibleExternal: { select: { name: true } }, _count: { select: { items: true } } },
        }),
        prisma.custody.count({ where }),
      ]);
      return {
        total,
        rows: rows.map((c) => ({
          number: c.number,
          status: CUSTODY_STATUS_LABELS[c.status],
          to: c.newResponsibleEmployee?.fullName ?? c.newResponsibleExternal?.name ?? null,
          assets: c._count.items,
          createdAt: fmtDateTime(c.createdAt),
          confirmedAt: fmtDateTime(c.confirmedAt),
          reason: c.rejectionReason ?? c.cancellationReason,
        })),
      };
    },
  },
  {
    key: 'transfers',
    title: 'تقرير عمليات النقل',
    description: 'عمليات نقل الأصول بين المواقع والأقسام.',
    permissions: [PERMISSIONS.TRANSFERS_VIEW],
    landscape: true,
    filters: [{ key: 'locationId', label: 'الموقع (من أو إلى)', type: 'location' }, ...DATE_RANGE],
    columns: [
      { key: 'number', label: 'رقم العملية' },
      { key: 'assetNumber', label: 'رقم الأصل' },
      { key: 'assetName', label: 'اسم الأصل' },
      { key: 'from', label: 'من' },
      { key: 'to', label: 'إلى' },
      { key: 'occurredAt', label: 'التاريخ' },
      { key: 'notes', label: 'ملاحظات' },
    ],
    async run(prisma, f, limit) {
      const where: Prisma.TransferWhereInput = {
        ...(f.locationId ? { OR: [{ fromLocationId: f.locationId }, { toLocationId: f.locationId }] } : {}),
        ...(range(f.from, f.to) ? { occurredAt: range(f.from, f.to) } : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.transfer.findMany({
          where,
          take: limit,
          orderBy: { occurredAt: 'desc' },
          include: {
            asset: { select: { assetNumber: true, name: true } },
            fromLocation: { select: { name: true } },
            fromDepartment: { select: { name: true } },
            toLocation: { select: { name: true } },
            toDepartment: { select: { name: true } },
          },
        }),
        prisma.transfer.count({ where }),
      ]);
      return {
        total,
        rows: rows.map((t) => ({
          number: t.number,
          assetNumber: t.asset.assetNumber,
          assetName: t.asset.name,
          from: `${t.fromLocation.name} / ${t.fromDepartment.name}`,
          to: `${t.toLocation.name} / ${t.toDepartment.name}`,
          occurredAt: fmtDateTime(t.occurredAt),
          notes: t.notes,
        })),
      };
    },
  },
  {
    key: 'inventory',
    title: 'تقرير الجرد',
    description: 'عمليات الجرد ونتائجها.',
    permissions: [PERMISSIONS.INVENTORY_VIEW],
    filters: [{ key: 'status', label: 'الحالة', type: 'select', options: Object.values(InventoryStatus).map((s) => [s, INVENTORY_STATUS_LABELS[s]]) }, ...DATE_RANGE],
    columns: [
      { key: 'number', label: 'رقم الجرد' },
      { key: 'status', label: 'الحالة' },
      { key: 'total', label: 'المتوقعة', type: 'number' },
      { key: 'found', label: 'موجودة', type: 'number' },
      { key: 'notFound', label: 'غير موجودة', type: 'number' },
      { key: 'discrepancies', label: 'فروقات', type: 'number' },
      { key: 'unregistered', label: 'غير مسجلة', type: 'number' },
      { key: 'createdAt', label: 'البدء' },
      { key: 'closedAt', label: 'الإغلاق' },
    ],
    async run(prisma, f, limit) {
      const where: Prisma.InventoryWhereInput = { ...(f.status ? { status: f.status as InventoryStatus } : {}), ...(range(f.from, f.to) ? { createdAt: range(f.from, f.to) } : {}) };
      const [rows, total] = await Promise.all([
        prisma.inventory.findMany({ where, take: limit, orderBy: { createdAt: 'desc' }, include: { _count: { select: { items: true, unregistered: true } } } }),
        prisma.inventory.count({ where }),
      ]);
      const ids = rows.map((r) => r.id);
      const [found, notFound, diffs] = await Promise.all(
        [{ exists: true }, { exists: false }, { hasDiscrepancy: true }].map((w) =>
          prisma.inventoryItem.groupBy({ by: ['inventoryId'], where: { inventoryId: { in: ids }, ...w }, _count: true }),
        ),
      );
      const count = (list: Array<{ inventoryId: string; _count: number }>, id: string) => list.find((x) => x.inventoryId === id)?._count ?? 0;
      return {
        total,
        rows: rows.map((i) => ({
          number: i.number,
          status: INVENTORY_STATUS_LABELS[i.status],
          total: i._count.items,
          found: count(found, i.id),
          notFound: count(notFound, i.id),
          discrepancies: count(diffs, i.id),
          unregistered: i._count.unregistered,
          createdAt: fmtDateTime(i.createdAt),
          closedAt: fmtDateTime(i.closedAt),
        })),
      };
    },
  },
  {
    key: 'maintenance',
    title: 'تقرير الصيانة',
    description: 'طلبات الصيانة وتكاليفها.',
    permissions: [PERMISSIONS.MAINTENANCE_VIEW],
    landscape: true,
    filters: [{ key: 'status', label: 'الحالة', type: 'select', options: Object.values(MaintenanceStatus).map((s) => [s, MAINTENANCE_STATUS_LABELS[s]]) }, ...DATE_RANGE],
    columns: [
      { key: 'number', label: 'رقم الطلب' },
      { key: 'assetNumber', label: 'رقم الأصل' },
      { key: 'assetName', label: 'اسم الأصل' },
      { key: 'technician', label: 'الفني' },
      { key: 'status', label: 'الحالة' },
      { key: 'startDate', label: 'البدء' },
      { key: 'endDate', label: 'الانتهاء' },
      { key: 'cost', label: 'التكلفة', type: 'money' },
      { key: 'currency', label: 'العملة' },
    ],
    async run(prisma, f, limit) {
      const where: Prisma.MaintenanceWhereInput = { ...(f.status ? { status: f.status as MaintenanceStatus } : {}), ...(range(f.from, f.to) ? { createdAt: range(f.from, f.to) } : {}) };
      const [rows, total, all] = await Promise.all([
        prisma.maintenance.findMany({
          where,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: { asset: { select: { assetNumber: true, name: true } }, technicianEmployee: { select: { fullName: true } }, provider: { select: { name: true } } },
        }),
        prisma.maintenance.count({ where }),
        prisma.maintenance.findMany({ where, select: { cost: true, currency: true } }),
      ]);
      return {
        total,
        summary: [{ label: 'إجمالي التكلفة', value: totalsByCurrency(all.map((m) => ({ value: money(m.cost), currency: m.currency }))) }],
        rows: rows.map((m) => ({
          number: m.number,
          assetNumber: m.asset.assetNumber,
          assetName: m.asset.name,
          technician: `${m.technicianEmployee?.fullName ?? m.provider?.name ?? '—'} (${TECHNICIAN_TYPE_LABELS[m.technicianType]})`,
          status: MAINTENANCE_STATUS_LABELS[m.status],
          startDate: fmtDateTime(m.startDate),
          endDate: fmtDateTime(m.endDate),
          cost: money(m.cost),
          currency: m.currency,
        })),
      };
    },
  },
  {
    key: 'sales',
    title: 'تقرير المبيعات',
    description: 'الأصول المباعة وقيم البيع.',
    permissions: [PERMISSIONS.SALES_VIEW],
    landscape: true,
    filters: DATE_RANGE,
    columns: [
      { key: 'number', label: 'رقم العملية' },
      { key: 'assetNumber', label: 'رقم الأصل' },
      { key: 'assetName', label: 'اسم الأصل' },
      { key: 'saleDate', label: 'تاريخ البيع' },
      { key: 'buyer', label: 'المشتري' },
      { key: 'buyerType', label: 'نوع المشتري' },
      { key: 'value', label: 'القيمة', type: 'money' },
      { key: 'currency', label: 'العملة' },
      { key: 'reference', label: 'الرقم المرجعي' },
    ],
    async run(prisma, f, limit) {
      const where: Prisma.SaleWhereInput = range(f.from, f.to) ? { saleDate: range(f.from, f.to) } : {};
      const [rows, total, all] = await Promise.all([
        prisma.sale.findMany({ where, take: limit, orderBy: { saleDate: 'desc' }, include: { asset: { select: { assetNumber: true, name: true } } } }),
        prisma.sale.count({ where }),
        prisma.sale.findMany({ where, select: { saleValue: true, currency: true } }),
      ]);
      return {
        total,
        summary: [{ label: 'إجمالي المبيعات', value: totalsByCurrency(all.map((s) => ({ value: money(s.saleValue), currency: s.currency }))) }],
        rows: rows.map((s) => ({
          number: s.number,
          assetNumber: s.asset.assetNumber,
          assetName: s.asset.name,
          saleDate: fmtDate(s.saleDate),
          buyer: s.buyerName,
          buyerType: s.buyerType,
          value: money(s.saleValue),
          currency: s.currency,
          reference: s.referenceNumber,
        })),
      };
    },
  },
  {
    key: 'by-location',
    title: 'الأصول حسب الموقع',
    description: 'عدد الأصول في كل موقع موزعة على الحالات.',
    permissions: [PERMISSIONS.ASSETS_VIEW],
    landscape: true,
    filters: [{ key: 'mainCategory', label: 'الفئة', type: 'category' }],
    columns: [{ key: 'name', label: 'الموقع' }, ...BREAKDOWN_COLUMNS],
    async run(prisma, f) {
      const groups = await statusBreakdown(prisma, 'locationId', f);
      const names = new Map((await prisma.location.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l.name]));
      const rows = pivot(groups, 'locationId', names);
      return { rows, total: rows.length };
    },
  },
  {
    key: 'by-department',
    title: 'الأصول حسب القسم',
    description: 'عدد الأصول في كل قسم موزعة على الحالات.',
    permissions: [PERMISSIONS.ASSETS_VIEW],
    landscape: true,
    filters: [
      { key: 'mainCategory', label: 'الفئة', type: 'category' },
      { key: 'locationId', label: 'الموقع', type: 'location' },
    ],
    columns: [{ key: 'name', label: 'القسم' }, ...BREAKDOWN_COLUMNS],
    async run(prisma, f) {
      const groups = await statusBreakdown(prisma, 'departmentId', f);
      const names = new Map((await prisma.department.findMany({ select: { id: true, name: true } })).map((d) => [d.id, d.name]));
      const rows = pivot(groups, 'departmentId', names);
      return { rows, total: rows.length };
    },
  },
  {
    key: 'by-category',
    title: 'الأصول حسب الفئة',
    description: 'عدد الأصول في كل فئة فرعية موزعة على الحالات.',
    permissions: [PERMISSIONS.ASSETS_VIEW],
    landscape: true,
    filters: [
      { key: 'mainCategory', label: 'الفئة', type: 'category' },
      { key: 'locationId', label: 'الموقع', type: 'location' },
    ],
    columns: [{ key: 'name', label: 'الفئة / الفئة الفرعية' }, ...BREAKDOWN_COLUMNS],
    async run(prisma, f) {
      const groups = await statusBreakdown(prisma, 'subcategoryId', f);
      const subs = await prisma.subcategory.findMany({ select: { id: true, name: true, mainCategory: true } });
      const names = new Map(subs.map((s) => [s.id, `${MAIN_CATEGORY_LABELS[s.mainCategory]} / ${s.name}`]));
      const rows = pivot(groups, 'subcategoryId', names);
      return { rows, total: rows.length };
    },
  },
  {
    key: 'by-status',
    title: 'الأصول حسب الحالة',
    description: 'عدد الأصول في كل حالة.',
    permissions: [PERMISSIONS.ASSETS_VIEW],
    filters: [
      { key: 'mainCategory', label: 'الفئة', type: 'category' },
      { key: 'locationId', label: 'الموقع', type: 'location' },
    ],
    columns: [
      { key: 'name', label: 'الحالة' },
      { key: 'count', label: 'العدد', type: 'number' },
    ],
    async run(prisma, f) {
      const groups = await statusBreakdown(prisma, 'status', f);
      const rows = Object.values(AssetStatus).map((s) => ({ name: ASSET_STATUS_LABELS[s], count: groups.find((g) => g.status === s)?._count ?? 0 }));
      return { rows, total: rows.length, summary: [{ label: 'إجمالي الأصول', value: String(rows.reduce((n, r) => n + r.count, 0)) }] };
    },
  },
  {
    key: 'audit',
    title: 'تقرير سجل التدقيق',
    description: 'التغييرات على البيانات: من، ماذا، ومتى.',
    permissions: [PERMISSIONS.AUDIT_VIEW],
    landscape: true,
    filters: [{ key: 'q', label: 'المستخدم أو المعرّف', type: 'text' }, { key: 'entityType', label: 'الكيان', type: 'text' }, ...DATE_RANGE],
    columns: [
      { key: 'createdAt', label: 'الوقت' },
      { key: 'actor', label: 'المستخدم' },
      { key: 'operation', label: 'العملية' },
      { key: 'entity', label: 'الكيان' },
      { key: 'entityId', label: 'المعرّف' },
    ],
    async run(prisma, f, limit) {
      const where: Prisma.AuditLogWhereInput = {
        ...(f.entityType ? { entityType: f.entityType } : {}),
        ...(range(f.from, f.to) ? { createdAt: range(f.from, f.to) } : {}),
        ...(f.q ? { OR: [{ actorName: { contains: f.q, mode: 'insensitive' } }, { entityId: { contains: f.q } }] } : {}),
      };
      const [rows, total] = await Promise.all([prisma.auditLog.findMany({ where, take: limit, orderBy: { id: 'desc' } }), prisma.auditLog.count({ where })]);
      return {
        total,
        rows: rows.map((r) => ({
          createdAt: fmtDateTime(r.createdAt),
          actor: r.actorName,
          operation: operationLabel(r.operation),
          entity: ENTITY_LABELS[r.entityType] ?? r.entityType,
          entityId: r.entityId,
        })),
      };
    },
  },
  {
    key: 'security',
    title: 'تقرير السجل الأمني',
    description: 'الدخول والخروج والجلسات وتغييرات الأدوار والصلاحيات.',
    permissions: [PERMISSIONS.SECURITY_VIEW],
    landscape: true,
    filters: [
      { key: 'type', label: 'نوع الحدث', type: 'select', options: Object.entries(SECURITY_EVENT_LABELS) },
      { key: 'q', label: 'المستخدم أو IP', type: 'text' },
      ...DATE_RANGE,
    ],
    columns: [
      { key: 'createdAt', label: 'الوقت' },
      { key: 'type', label: 'الحدث' },
      { key: 'username', label: 'المستخدم' },
      { key: 'ip', label: 'عنوان IP' },
      { key: 'device', label: 'الجهاز' },
      { key: 'browser', label: 'المتصفح' },
    ],
    async run(prisma, f, limit) {
      const where: Prisma.SecurityLogWhereInput = {
        ...(f.type ? { type: f.type as SecurityEventType } : {}),
        ...(range(f.from, f.to) ? { createdAt: range(f.from, f.to) } : {}),
        ...(f.q ? { OR: [{ username: { contains: f.q, mode: 'insensitive' } }, { ip: { contains: f.q } }] } : {}),
      };
      const [rows, total] = await Promise.all([prisma.securityLog.findMany({ where, take: limit, orderBy: { id: 'desc' } }), prisma.securityLog.count({ where })]);
      return {
        total,
        rows: rows.map((r) => ({
          createdAt: fmtDateTime(r.createdAt),
          type: SECURITY_EVENT_LABELS[r.type] ?? r.type,
          username: r.username,
          ip: r.ip,
          device: r.device,
          browser: r.browser,
        })),
      };
    },
  },
];

/** Validates submitted filter values against the report's filter definitions. */
export function checkFilters(def: ReportDef, raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const fields: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (value === '' || value === null || value === undefined) continue;
    const filter = def.filters.find((x) => x.key === key);
    const v = String(value);
    if (!filter) {
      fields[key] = ['فلتر غير معروف لهذا التقرير.'];
      continue;
    }
    const ok =
      v.length <= 200 &&
      (filter.type === 'date'
        ? isDate(v)
        : filter.type === 'select'
          ? filter.options!.some(([o]) => o === v)
          : filter.type === 'location' || filter.type === 'department'
            ? isUuid(v)
            : filter.type === 'category'
              ? v in MAIN_CATEGORY_LABELS
              : true);
    if (!ok) fields[key] = ['القيمة غير صالحة.'];
    else out[key] = v;
  }
  if (Object.keys(fields).length) throw AppError.validation(fields);
  return out;
}
