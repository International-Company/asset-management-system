import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiErrorBody, ERROR_MESSAGES, ErrorCode } from '@osooli/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppError, httpStatusFor } from './app-error';

/** Arabic messages for unique-constraint violations, keyed by a column/index name fragment. */
const DUPLICATE_MESSAGES: Array<[fragment: string, field: string, message: string]> = [
  ['serial_number', 'serialNumber', 'الرقم التسلسلي مستخدم لأصل آخر.'],
  ['asset_number', 'assetNumber', 'رقم الأصل مستخدم مسبقًا.'],
  ['qr_token', 'qrToken', 'رمز QR مستخدم مسبقًا.'],
  ['custody_items_one_pending', 'assetIds', 'أحد الأصول مدرج في محضر عهدة آخر بانتظار التأكيد.'],
  ['maintenances_one_open', 'assetId', 'يوجد طلب صيانة مفتوح لهذا الأصل.'],
  ['sales_asset_id', 'assetId', 'تم بيع هذا الأصل مسبقًا.'],
  ['username', 'username', 'اسم المستخدم مستخدم مسبقًا.'],
  ['name', 'name', 'الاسم مستخدم مسبقًا.'],
];

interface Mapped {
  code: ErrorCode;
  message?: string;
  fields?: Record<string, string[]>;
}

/** Collects every piece of text a Prisma/driver error carries (message, meta, cause). */
function errorText(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof Error) parts.push(current.message);
    const meta = (current as { meta?: unknown }).meta;
    if (meta) parts.push(JSON.stringify(meta));
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' | ');
}

export function mapDatabaseError(err: unknown): Mapped | null {
  const isPrisma =
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientUnknownRequestError ||
    (err instanceof Error && err.name.startsWith('DriverAdapter'));
  if (!isPrisma) return null;

  const text = errorText(err);
  const code = (err as { code?: string }).code;

  // Messages raised by our triggers (see migrations/*_integrity).
  if (text.includes('ASSET_SOLD:')) return { code: 'ASSET_SOLD' };
  if (text.includes('IMMUTABLE:') || text.includes('INVALID_STATE:')) return { code: 'INVALID_STATE' };

  if (code === 'P2002' || text.includes('23505') || /unique constraint/i.test(text)) {
    const hit = DUPLICATE_MESSAGES.find(([fragment]) => text.includes(fragment));
    return hit
      ? { code: 'DUPLICATE', message: hit[2], fields: { [hit[1]]: [hit[2]] } }
      : { code: 'DUPLICATE' };
  }
  if (code === 'P2025') return { code: 'NOT_FOUND' };
  if (code === 'P2034' || /40001|40P01|could not serialize|deadlock/i.test(text)) {
    return { code: 'CONFLICT' };
  }
  if (code === 'P2003' || text.includes('23503')) return { code: 'INVALID_STATE' };
  if (text.includes('23514') || /check constraint/i.test(text)) return { code: 'VALIDATION_ERROR' };
  return null;
}

function mapHttpException(err: HttpException): Mapped {
  switch (err.getStatus()) {
    case HttpStatus.NOT_FOUND:
      return { code: 'NOT_FOUND' };
    case HttpStatus.UNAUTHORIZED:
      return { code: 'UNAUTHENTICATED' };
    case HttpStatus.FORBIDDEN:
      return { code: 'FORBIDDEN' };
    case HttpStatus.TOO_MANY_REQUESTS:
      return { code: 'RATE_LIMITED' };
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return { code: 'FILE_REJECTED', message: 'حجم البيانات المرسلة أكبر من المسموح.' };
    case HttpStatus.BAD_REQUEST:
      return { code: 'VALIDATION_ERROR' };
    default:
      return { code: err.getStatus() >= 500 ? 'SERVER_ERROR' : 'VALIDATION_ERROR' };
  }
}

/**
 * Converts every error into the ApiErrorBody shape with an Arabic message.
 * Stack traces and internal details go to technical logs only (spec §69).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(err: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();

    let mapped: Mapped;
    if (err instanceof AppError) {
      mapped = { code: err.code, message: err.message, fields: err.options.fields };
      if (err.options.internal) this.logger.warn({ code: err.code, detail: err.options.internal });
    } else if (err instanceof HttpException) {
      mapped = mapHttpException(err);
    } else {
      mapped = mapDatabaseError(err) ?? { code: 'SERVER_ERROR' };
    }

    const status = httpStatusFor(mapped.code);
    if (status >= 500) {
      this.logger.error({ err, path: req.url, requestId: req.id }, 'Unhandled error');
    } else if (!(err instanceof AppError) && !(err instanceof HttpException)) {
      this.logger.warn({ code: mapped.code, detail: errorText(err), path: req.url, requestId: req.id });
    }

    const body: ApiErrorBody = {
      error: {
        code: mapped.code,
        message: mapped.message ?? ERROR_MESSAGES[mapped.code],
        ...(mapped.fields ? { fields: mapped.fields } : {}),
        ...(req.id ? { requestId: String(req.id) } : {}),
      },
    };
    res.status(status).json(body);
  }
}
