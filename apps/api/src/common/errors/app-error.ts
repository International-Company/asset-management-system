import { HttpStatus } from '@nestjs/common';
import { ERROR_MESSAGES, ErrorCode } from '@osooli/shared';

const STATUS_BY_CODE: Record<ErrorCode, HttpStatus> = {
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  SESSION_EXPIRED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  ASSET_NOT_FOUND: HttpStatus.NOT_FOUND,
  ASSET_SOLD: HttpStatus.CONFLICT,
  CONFLICT: HttpStatus.CONFLICT,
  STALE_VERSION: HttpStatus.CONFLICT,
  INVALID_STATE: HttpStatus.CONFLICT,
  DUPLICATE: HttpStatus.CONFLICT,
  ACCOUNT_LOCKED: HttpStatus.LOCKED,
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  FINGERPRINT_FAILED: HttpStatus.UNAUTHORIZED,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  FILE_REJECTED: HttpStatus.UNPROCESSABLE_ENTITY,
  SERVICE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  SERVER_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * Domain error with a stable code. `message` is the Arabic user-facing text;
 * `internal` is for technical logs only and never sent to the client.
 */
export class AppError extends Error {
  readonly status: HttpStatus;

  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly options: { fields?: Record<string, string[]>; internal?: string } = {},
  ) {
    super(message ?? ERROR_MESSAGES[code]);
    this.status = STATUS_BY_CODE[code];
  }

  static notFound(message?: string) {
    return new AppError('NOT_FOUND', message);
  }
  static forbidden(message?: string) {
    return new AppError('FORBIDDEN', message);
  }
  static invalidState(message?: string) {
    return new AppError('INVALID_STATE', message);
  }
  static validation(fields: Record<string, string[]>, message?: string) {
    return new AppError('VALIDATION_ERROR', message, { fields });
  }
}

export function httpStatusFor(code: ErrorCode): HttpStatus {
  return STATUS_BY_CODE[code];
}
