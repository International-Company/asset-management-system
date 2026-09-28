/**
 * Permission catalogue. The backend is the source of truth for enforcement;
 * the web app only uses these keys to hide actions the user cannot perform.
 */
export const PERMISSIONS = {
  // Assets
  ASSETS_VIEW: 'assets.view',
  ASSETS_CREATE: 'assets.create',
  ASSETS_EDIT: 'assets.edit',
  ASSETS_CHANGE_CATEGORY: 'assets.change_category',
  ASSETS_EDIT_SERIAL: 'assets.edit_serial',
  ASSETS_DELETE: 'assets.delete',
  ASSETS_PHOTOS_DELETE: 'assets.photos.delete',

  // Reference data
  CATEGORIES_MANAGE: 'categories.manage',
  LOCATIONS_MANAGE: 'locations.manage',
  DEPARTMENTS_MANAGE: 'departments.manage',
  EXTERNAL_PEOPLE_VIEW: 'external_people.view',
  EXTERNAL_PEOPLE_MANAGE: 'external_people.manage',

  // Operations
  TRANSFERS_VIEW: 'transfers.view',
  TRANSFERS_CREATE: 'transfers.create',
  CUSTODY_VIEW: 'custody.view',
  CUSTODY_CREATE: 'custody.create',
  CUSTODY_CANCEL: 'custody.cancel',
  CUSTODY_CONFIRM_EXTERNAL: 'custody.confirm_external',
  CUSTODY_RETURNS_CREATE: 'custody_returns.create',
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_MANAGE: 'inventory.manage',
  INVENTORY_REOPEN: 'inventory.reopen',
  MAINTENANCE_VIEW: 'maintenance.view',
  MAINTENANCE_MANAGE: 'maintenance.manage',
  MAINTENANCE_CLOSE: 'maintenance.close',
  SALES_VIEW: 'sales.view',
  SALES_CREATE: 'sales.create',

  // Documents & QR
  DOCUMENTS_VIEW: 'documents.view',
  DOCUMENTS_UPLOAD: 'documents.upload',
  QR_PRINT: 'qr.print',

  // Reports, logs, notifications
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
  AUDIT_VIEW: 'audit.view',
  SECURITY_VIEW: 'security.view',
  SECURITY_MANAGE: 'security.manage',
  NOTIFICATIONS_VIEW_ALL: 'notifications.view_all',
  SAVED_SEARCHES_SHARE: 'saved_searches.share',

  // Administration
  USERS_VIEW: 'users.view',
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',
  SETTINGS_MANAGE: 'settings.manage',
  DASHBOARD_VIEW: 'dashboard.view',
  HEALTH_VIEW: 'health.view',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS);

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  'assets.view': 'عرض الأصول',
  'assets.create': 'إنشاء أصل',
  'assets.edit': 'تعديل أصل',
  'assets.change_category': 'تغيير فئة الأصل',
  'assets.edit_serial': 'تعديل الرقم التسلسلي',
  'assets.delete': 'حذف أصل بلا تاريخ',
  'assets.photos.delete': 'حذف صور الأصل',
  'categories.manage': 'إدارة الفئات الفرعية',
  'locations.manage': 'إدارة المواقع',
  'departments.manage': 'إدارة الأقسام',
  'external_people.view': 'عرض المسؤولين الخارجيين',
  'external_people.manage': 'إدارة المسؤولين الخارجيين',
  'transfers.view': 'عرض عمليات النقل',
  'transfers.create': 'تنفيذ نقل',
  'custody.view': 'عرض محاضر العهدة',
  'custody.create': 'إنشاء محضر عهدة',
  'custody.cancel': 'إلغاء محضر عهدة',
  'custody.confirm_external': 'تأكيد استلام نيابة عن شخص خارجي',
  'custody_returns.create': 'إنشاء محضر إرجاع',
  'inventory.view': 'عرض الجرد',
  'inventory.manage': 'إدارة الجرد',
  'inventory.reopen': 'إعادة فتح جرد مغلق',
  'maintenance.view': 'عرض الصيانة',
  'maintenance.manage': 'إدارة الصيانة',
  'maintenance.close': 'إنهاء الصيانة نهائيًا',
  'sales.view': 'عرض المبيعات',
  'sales.create': 'تنفيذ بيع',
  'documents.view': 'عرض المستندات',
  'documents.upload': 'رفع واستبدال المستندات',
  'qr.print': 'طباعة ملصقات QR',
  'reports.view': 'عرض التقارير',
  'reports.export': 'تصدير التقارير',
  'audit.view': 'عرض سجل التدقيق',
  'security.view': 'عرض السجل الأمني',
  'security.manage': 'إدارة الجلسات والإعدادات الأمنية',
  'notifications.view_all': 'عرض جميع إشعارات النظام',
  'saved_searches.share': 'مشاركة عمليات البحث المحفوظة',
  'users.view': 'عرض المستخدمين',
  'users.manage': 'إدارة المستخدمين',
  'roles.manage': 'إدارة الأدوار والصلاحيات',
  'settings.manage': 'إدارة إعدادات النظام',
  'dashboard.view': 'لوحة التحكم',
  'health.view': 'حالة النظام',
};

/** Built-in roles created by the initial seed/migration. */
export const SYSTEM_ROLES = {
  SYSTEM_ADMINISTRATOR: 'SYSTEM_ADMINISTRATOR',
  ASSET_MANAGER: 'ASSET_MANAGER',
} as const;

const P = PERMISSIONS;

export const ASSET_MANAGER_PERMISSIONS: PermissionKey[] = [
  P.ASSETS_VIEW,
  P.ASSETS_CREATE,
  P.ASSETS_EDIT,
  P.ASSETS_CHANGE_CATEGORY,
  P.ASSETS_EDIT_SERIAL,
  P.EXTERNAL_PEOPLE_VIEW,
  P.EXTERNAL_PEOPLE_MANAGE,
  P.TRANSFERS_VIEW,
  P.TRANSFERS_CREATE,
  P.CUSTODY_VIEW,
  P.CUSTODY_CREATE,
  P.CUSTODY_CANCEL,
  P.CUSTODY_CONFIRM_EXTERNAL,
  P.CUSTODY_RETURNS_CREATE,
  P.INVENTORY_VIEW,
  P.INVENTORY_MANAGE,
  P.MAINTENANCE_VIEW,
  P.MAINTENANCE_MANAGE,
  P.MAINTENANCE_CLOSE,
  P.SALES_VIEW,
  P.SALES_CREATE,
  P.DOCUMENTS_VIEW,
  P.DOCUMENTS_UPLOAD,
  P.QR_PRINT,
  P.REPORTS_VIEW,
  P.REPORTS_EXPORT,
];
