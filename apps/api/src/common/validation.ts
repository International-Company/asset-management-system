import { ValidationError, ValidationPipe } from '@nestjs/common';
import { AppError } from './errors/app-error';

const ARABIC_CONSTRAINT_MESSAGES: Record<string, string> = {
  isNotEmpty: 'هذا الحقل مطلوب.',
  isDefined: 'هذا الحقل مطلوب.',
  isString: 'يجب أن تكون القيمة نصًا.',
  isBoolean: 'يجب أن تكون القيمة نعم/لا.',
  isInt: 'يجب أن تكون القيمة رقمًا صحيحًا.',
  isNumber: 'يجب أن تكون القيمة رقمًا.',
  isNumberString: 'يجب أن تكون القيمة رقمًا.',
  isDecimal: 'يجب أن تكون القيمة رقمًا عشريًا صالحًا.',
  isPositive: 'يجب أن تكون القيمة أكبر من صفر.',
  min: 'القيمة أقل من الحد المسموح.',
  max: 'القيمة أكبر من الحد المسموح.',
  minLength: 'النص أقصر من المسموح.',
  maxLength: 'النص أطول من المسموح.',
  isUUID: 'المعرّف غير صالح.',
  isEnum: 'القيمة غير مسموحة.',
  isIn: 'القيمة غير مسموحة.',
  isDateString: 'التاريخ غير صالح.',
  isISO8601: 'التاريخ غير صالح.',
  isArray: 'يجب أن تكون القيمة قائمة.',
  arrayNotEmpty: 'يجب اختيار عنصر واحد على الأقل.',
  arrayMinSize: 'يجب اختيار عنصر واحد على الأقل.',
  arrayMaxSize: 'عدد العناصر أكبر من المسموح.',
  arrayUnique: 'القائمة تحتوي عناصر مكررة.',
  isIP: 'عنوان IP غير صالح.',
  isMACAddress: 'عنوان MAC غير صالح.',
  isCurrency: 'العملة غير صالحة.',
  matches: 'الصيغة غير صحيحة.',
  whitelistValidation: 'حقل غير معروف.',
};

function collect(errors: ValidationError[], prefix: string, out: Record<string, string[]>): void {
  for (const e of errors) {
    const path = prefix ? `${prefix}.${e.property}` : e.property;
    if (e.constraints) {
      out[path] = Object.keys(e.constraints).map(
        (k) => ARABIC_CONSTRAINT_MESSAGES[k] ?? 'القيمة غير صالحة.',
      );
    }
    if (e.children?.length) collect(e.children, path, out);
  }
}

export function flattenValidationErrors(errors: ValidationError[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  collect(errors, '', out);
  return out;
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) => AppError.validation(flattenValidationErrors(errors)),
  });
}
