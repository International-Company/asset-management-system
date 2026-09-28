/**
 * Stable machine-readable error codes returned by the API in `error.code`.
 * The web app maps them to the Arabic messages below.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  ASSET_SOLD: 'ASSET_SOLD',
  CONFLICT: 'CONFLICT',
  STALE_VERSION: 'STALE_VERSION',
  INVALID_STATE: 'INVALID_STATE',
  DUPLICATE: 'DUPLICATE',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  FINGERPRINT_FAILED: 'FINGERPRINT_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  FILE_REJECTED: 'FILE_REJECTED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  SERVER_ERROR: 'SERVER_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'البيانات المدخلة غير صحيحة. يرجى مراجعة الحقول المحددة.',
  UNAUTHENTICATED: 'يرجى تسجيل الدخول للمتابعة.',
  SESSION_EXPIRED: 'انتهت الجلسة. يرجى تسجيل الدخول من جديد.',
  FORBIDDEN: 'ليست لديك صلاحية لتنفيذ هذا الإجراء.',
  NOT_FOUND: 'العنصر المطلوب غير موجود.',
  ASSET_NOT_FOUND: 'الأصل غير موجود.',
  ASSET_SOLD: 'هذا الأصل مباع، ولا يمكن تنفيذ عمليات تشغيلية عليه.',
  CONFLICT: 'تعارض مع عملية أخرى. يرجى تحديث الصفحة والمحاولة مجددًا.',
  STALE_VERSION: 'تم تعديل هذا السجل من مستخدم آخر. يرجى تحديث البيانات قبل الحفظ.',
  INVALID_STATE: 'لا يمكن تنفيذ هذا الإجراء في الحالة الحالية.',
  DUPLICATE: 'القيمة مستخدمة مسبقًا.',
  ACCOUNT_LOCKED: 'تم قفل الحساب مؤقتًا بسبب محاولات دخول فاشلة متكررة.',
  INVALID_CREDENTIALS: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
  FINGERPRINT_FAILED: 'فشل التحقق من البصمة.',
  RATE_LIMITED: 'عدد كبير من الطلبات. يرجى الانتظار قليلًا.',
  FILE_REJECTED: 'الملف غير مسموح به.',
  SERVICE_UNAVAILABLE: 'الخدمة غير متاحة حاليًا. يرجى المحاولة لاحقًا.',
  SERVER_ERROR: 'حدث خطأ غير متوقع. يرجى المحاولة لاحقًا.',
};

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Field-level validation messages, keyed by field path. */
    fields?: Record<string, string[]>;
    requestId?: string;
  };
}
