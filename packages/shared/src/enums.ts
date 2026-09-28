/**
 * Domain enums shared by API and web.
 * Values must match the Prisma enums in apps/api/prisma/schema.prisma.
 */

export const MainCategoryCode = {
  OFF: 'OFF',
  OPR: 'OPR',
  TEC: 'TEC',
  REA: 'REA',
} as const;
export type MainCategoryCode = (typeof MainCategoryCode)[keyof typeof MainCategoryCode];

export const MAIN_CATEGORY_LABELS: Record<MainCategoryCode, string> = {
  OFF: 'الأصول المكتبية',
  OPR: 'الأصول التشغيلية',
  TEC: 'الأصول التقنية',
  REA: 'الأصول العقارية',
};

export const AssetStatus = {
  NEW: 'NEW',
  IN_USE: 'IN_USE',
  UNUSED: 'UNUSED',
  UNDER_MAINTENANCE: 'UNDER_MAINTENANCE',
  DAMAGED: 'DAMAGED',
  LOST: 'LOST',
  DISPOSED: 'DISPOSED',
  SOLD: 'SOLD',
} as const;
export type AssetStatus = (typeof AssetStatus)[keyof typeof AssetStatus];

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  NEW: 'جديد',
  IN_USE: 'قيد الاستخدام',
  UNUSED: 'غير مستخدم',
  UNDER_MAINTENANCE: 'قيد الصيانة',
  DAMAGED: 'تالف',
  LOST: 'مفقود',
  DISPOSED: 'مستبعد',
  SOLD: 'تم البيع',
};

export const RecordStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type RecordStatus = (typeof RecordStatus)[keyof typeof RecordStatus];

export const RECORD_STATUS_LABELS: Record<RecordStatus, string> = {
  ACTIVE: 'فعّال',
  INACTIVE: 'معطّل',
};

export const CustodyStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type CustodyStatus = (typeof CustodyStatus)[keyof typeof CustodyStatus];

export const CUSTODY_STATUS_LABELS: Record<CustodyStatus, string> = {
  PENDING: 'بانتظار التأكيد',
  CONFIRMED: 'مؤكد',
  REJECTED: 'مرفوض',
  CANCELLED: 'ملغى',
};

export const MaintenanceStatus = {
  NEW: 'NEW',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CLOSED: 'CLOSED',
} as const;
export type MaintenanceStatus = (typeof MaintenanceStatus)[keyof typeof MaintenanceStatus];

export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  NEW: 'جديدة',
  IN_PROGRESS: 'قيد الصيانة',
  COMPLETED: 'مكتملة',
  CLOSED: 'انتهاء الصيانة',
};

export const TechnicianType = {
  EMPLOYEE: 'EMPLOYEE',
  EXTERNAL: 'EXTERNAL',
  COMPANY: 'COMPANY',
} as const;
export type TechnicianType = (typeof TechnicianType)[keyof typeof TechnicianType];

export const TECHNICIAN_TYPE_LABELS: Record<TechnicianType, string> = {
  EMPLOYEE: 'موظف',
  EXTERNAL: 'فني خارجي',
  COMPANY: 'شركة',
};

export const InventoryStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  CLOSED: 'CLOSED',
} as const;
export type InventoryStatus = (typeof InventoryStatus)[keyof typeof InventoryStatus];

export const INVENTORY_STATUS_LABELS: Record<InventoryStatus, string> = {
  IN_PROGRESS: 'قيد التنفيذ',
  CLOSED: 'مغلق',
};

export const ResponsibleType = {
  EMPLOYEE: 'EMPLOYEE',
  EXTERNAL: 'EXTERNAL',
} as const;
export type ResponsibleType = (typeof ResponsibleType)[keyof typeof ResponsibleType];

export const RESPONSIBLE_TYPE_LABELS: Record<ResponsibleType, string> = {
  EMPLOYEE: 'موظف',
  EXTERNAL: 'شخص خارجي',
};

/** Numbered operation sequences. Asset-number counters are per main category. */
export const OperationSequence = {
  TRANSFER: 'TRF',
  CUSTODY: 'CUS',
  CUSTODY_RETURN: 'RET',
  SALE: 'SAL',
  MAINTENANCE: 'MNT',
  INVENTORY: 'INV',
  INTERNAL_SERIAL: 'INT-SN',
} as const;
export type OperationSequence = (typeof OperationSequence)[keyof typeof OperationSequence];

export const SyncOperationStatus = {
  PENDING: 'PENDING',
  SYNCING: 'SYNCING',
  SYNCED: 'SYNCED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
} as const;
export type SyncOperationStatus = (typeof SyncOperationStatus)[keyof typeof SyncOperationStatus];

export const SYNC_STATUS_LABELS: Record<SyncOperationStatus, string> = {
  PENDING: 'بانتظار المزامنة',
  SYNCING: 'جارٍ المزامنة',
  SYNCED: 'تمت المزامنة',
  NEEDS_REVIEW: 'فشلت / تحتاج مراجعة',
};

export const PAGE_SIZES = [25, 50, 100, 250] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
