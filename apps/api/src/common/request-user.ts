import type { Request } from 'express';
import type { PermissionKey } from '@osooli/shared';

export interface RequestUser {
  id: string;
  username: string;
  employeeId: string;
  fullName: string;
  sessionId: string;
  roleKeys: string[];
  permissions: ReadonlySet<PermissionKey>;
}

export interface AuthenticatedRequest extends Request {
  user: RequestUser;
}

/** The audit actor for a signed-in user. */
export function actorOf(user: RequestUser): { id: string; name: string } {
  return { id: user.id, name: user.fullName };
}

/** Client metadata recorded for sessions and security logs. */
export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
  device: string | null;
  browser: string | null;
}

export function clientInfo(req: Request): ClientInfo {
  const ua = req.headers['user-agent'] ?? null;
  return {
    ip: req.ip ?? null,
    userAgent: ua ? ua.slice(0, 500) : null,
    device: ua ? detectDevice(ua) : null,
    browser: ua ? detectBrowser(ua) : null,
  };
}

function detectDevice(ua: string): string {
  if (/iPad|Tablet/i.test(ua)) return 'جهاز لوحي';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'هاتف';
  return 'حاسوب';
}

function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'غير معروف';
}
