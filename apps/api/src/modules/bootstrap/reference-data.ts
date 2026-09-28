import {
  MAIN_CATEGORY_LABELS,
  MainCategoryCode,
  OperationSequence,
  SYSTEM_ROLES,
} from '@osooli/shared';
import { assetSequenceKey, operationSequenceKey } from '../numbering/numbering.service';

/**
 * Reference data required in every environment (including production).
 * This is NOT seed data: it contains no company records.
 */
export const MAIN_CATEGORIES = (Object.keys(MAIN_CATEGORY_LABELS) as MainCategoryCode[]).map(
  (code) => ({ code, nameAr: MAIN_CATEGORY_LABELS[code], sequenceKey: assetSequenceKey(code) }),
);

export const NUMBER_SEQUENCES: Array<{ key: string; prefix: string; nextValue: number; digits: number }> = [
  ...MAIN_CATEGORIES.map((c) => ({ key: c.sequenceKey, prefix: c.code, nextValue: 1, digits: 6 })),
  ...Object.values(OperationSequence).map((op) => ({
    key: operationSequenceKey(op),
    prefix: op,
    nextValue: 1,
    digits: 6,
  })),
];

export const CURRENCIES = [
  { code: 'USD', nameAr: 'دولار أمريكي', symbol: '$' },
  { code: 'ILS', nameAr: 'شيكل', symbol: '₪' },
];

/**
 * Notification types. `defaultRoles` / `defaultResponsible` are applied only
 * when a type is first created; afterwards recipients are whatever the
 * administrator configures. "Responsible" means the person the operation
 * concerns (e.g. the new custodian who must confirm receipt).
 */
export const NOTIFICATION_TYPES: Array<{ key: string; label: string; defaultRoles?: string[]; defaultResponsible?: boolean }> = [
  { key: 'custody.created', label: 'إنشاء محضر عهدة', defaultResponsible: true },
  { key: 'custody.confirmed', label: 'تأكيد استلام عهدة', defaultRoles: [SYSTEM_ROLES.ASSET_MANAGER] },
  { key: 'custody.rejected', label: 'رفض استلام عهدة', defaultRoles: [SYSTEM_ROLES.ASSET_MANAGER] },
  { key: 'custody.cancelled', label: 'إلغاء محضر عهدة', defaultResponsible: true },
  { key: 'custody.returned', label: 'إرجاع عهدة', defaultResponsible: true },
  { key: 'transfer.created', label: 'نقل أصل' },
  { key: 'maintenance.opened', label: 'فتح طلب صيانة' },
  { key: 'maintenance.completed', label: 'اكتمال الصيانة' },
  { key: 'maintenance.closed', label: 'انتهاء الصيانة' },
  { key: 'sale.created', label: 'بيع أصل', defaultRoles: [SYSTEM_ROLES.SYSTEM_ADMINISTRATOR] },
  { key: 'inventory.created', label: 'إنشاء جرد' },
  { key: 'inventory.closed', label: 'إغلاق جرد' },
  { key: 'inventory.reopened', label: 'إعادة فتح جرد' },
  { key: 'employee.inactive_responsible', label: 'مسؤول أصبح غير فعّال في EAP', defaultRoles: [SYSTEM_ROLES.SYSTEM_ADMINISTRATOR] },
];
