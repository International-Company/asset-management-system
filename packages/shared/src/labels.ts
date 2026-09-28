/** Arabic labels for log codes, shared by the web app and server-side reports. Unknown codes fall back to the raw code. */

export const SECURITY_EVENT_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'تسجيل دخول',
  LOGIN_FAILED: 'محاولة دخول فاشلة',
  LOGOUT: 'تسجيل خروج',
  ACCOUNT_LOCKED: 'قفل الحساب',
  SESSION_EXPIRED: 'انتهاء جلسة',
  SESSION_TERMINATED: 'إنهاء جلسة',
  ROLE_CHANGED: 'تغيير أدوار مستخدم',
  PERMISSION_CHANGED: 'تغيير صلاحيات دور',
  SECURITY_SETTING_CHANGED: 'تغيير إعداد أمني',
  USER_CREATED: 'إنشاء مستخدم',
  USER_ACTIVATED: 'تفعيل مستخدم',
  USER_DEACTIVATED: 'تعطيل مستخدم',
  USER_UNLOCKED: 'فك قفل مستخدم',
};

export const LOGIN_FAILURE_REASONS: Record<string, string> = {
  invalid_password: 'كلمة مرور خاطئة',
  fingerprint_failed: 'فشل التحقق من البصمة',
  account_locked: 'الحساب مقفل',
  no_system_access: 'لا يملك حسابًا في النظام',
};

export const ENTITY_LABELS: Record<string, string> = {
  Location: 'موقع',
  Department: 'قسم',
  LocationDepartment: 'ربط موقع بقسم',
  Subcategory: 'فئة فرعية',
  ExternalPerson: 'مسؤول خارجي',
  MaintenanceProvider: 'مزود صيانة',
  User: 'مستخدم',
  Role: 'دور',
  Setting: 'إعداد',
  NumberSequence: 'تسلسل ترقيم',
  Currency: 'عملة',
  Employee: 'موظف',
  Asset: 'أصل',
};

const OPERATION_VERBS: Record<string, string> = {
  CREATED: 'إنشاء',
  UPDATED: 'تعديل',
  DELETED: 'حذف',
  LINKED: 'ربط',
  UNLINKED: 'إلغاء ربط',
  CHANGED: 'تغيير',
  ACTIVATED: 'تفعيل',
  DEACTIVATED: 'تعطيل',
  UNLOCKED: 'فك قفل',
  SYNCED: 'مزامنة',
};

const OPERATION_OVERRIDES: Record<string, string> = {
  USER_ROLES_CHANGED: 'تغيير أدوار مستخدم',
  SETTING_CHANGED: 'تغيير إعداد',
  NUMBER_SEQUENCE_CHANGED: 'تغيير إعدادات الترقيم',
  EMPLOYEE_SYNCED: 'مزامنة موظف من EAP',
  LOCATION_DEPARTMENT_LINKED: 'ربط قسم بموقع',
  LOCATION_DEPARTMENT_UNLINKED: 'إلغاء ربط قسم بموقع',
  LOCATION_DEPARTMENT_UPDATED: 'تعديل ربط قسم بموقع',
};

const ENTITY_BY_PREFIX: Record<string, string> = {
  LOCATION: 'موقع',
  DEPARTMENT: 'قسم',
  SUBCATEGORY: 'فئة فرعية',
  EXTERNAL_PERSON: 'مسؤول خارجي',
  MAINTENANCE_PROVIDER: 'مزود صيانة',
  USER: 'مستخدم',
  ROLE: 'دور',
  CURRENCY: 'عملة',
};

/** "LOCATION_CREATED" → "إنشاء موقع". */
export function operationLabel(op: string): string {
  if (OPERATION_OVERRIDES[op]) return OPERATION_OVERRIDES[op];
  const idx = op.lastIndexOf('_');
  const verb = OPERATION_VERBS[op.slice(idx + 1)];
  const entity = ENTITY_BY_PREFIX[op.slice(0, idx)];
  return verb && entity ? `${verb} ${entity}` : op;
}
