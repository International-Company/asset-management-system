import { formatNumber } from '@osooli/shared';
import { validateEnv } from '../config/env';
import { AuditService } from '../modules/audit/audit.service';
import { redact } from './redact';
import { mapDatabaseError } from './errors/all-exceptions.filter';
import { Prisma } from '../generated/prisma/client';

const baseEnv = {
  APP_ENV: 'development',
  DATABASE_URL: 'postgresql://x',
  AUTH_PROVIDER: 'mock',
  MOCK_AUTH_PASSWORD: 'p',
  MOCK_AUTH_FINGERPRINT: 'f',
  ENCRYPTION_KEY: 'k'.repeat(32),
};

describe('formatNumber', () => {
  it('pads to the configured digit count', () => {
    expect(formatNumber('TEC', 12, 6)).toBe('TEC-000012');
    expect(formatNumber('INT-SN', 1, 6)).toBe('INT-SN-000001');
  });
  it('does not truncate numbers longer than the digit count', () => {
    expect(formatNumber('OFF', 1234567, 6)).toBe('OFF-1234567');
  });
  it('rejects invalid values', () => {
    expect(() => formatNumber('OFF', -1, 6)).toThrow(RangeError);
    expect(() => formatNumber('OFF', 1.5, 6)).toThrow(RangeError);
  });
});

describe('validateEnv', () => {
  it('accepts a valid development configuration', () => {
    expect(validateEnv(baseEnv).AUTH_PROVIDER).toBe('mock');
  });
  it('refuses the mock auth provider in production', () => {
    expect(() => validateEnv({ ...baseEnv, APP_ENV: 'production', STORAGE_DRIVER: 's3', STORAGE_BUCKET: 'b', STORAGE_ACCESS_KEY: 'a', STORAGE_SECRET_KEY: 's' })).toThrow(/AUTH_PROVIDER/);
  });
  it('refuses local storage in staging', () => {
    expect(() => validateEnv({ ...baseEnv, APP_ENV: 'staging' })).toThrow(/STORAGE_DRIVER/);
  });
  it('never echoes secret values in the error', () => {
    try {
      validateEnv({ ...baseEnv, ENCRYPTION_KEY: 'short-secret-value' });
      expect.unreachable('expected error');
    } catch (e) {
      expect((e as Error).message).toContain('ENCRYPTION_KEY');
      expect((e as Error).message).not.toContain('short-secret-value');
    }
  });
});

describe('redact', () => {
  it('removes credentials at any depth but keeps QR tokens', () => {
    const out = redact({
      password: 'x',
      nested: { clientSecret: 'y', list: [{ sessionToken: 'z' }] },
      qrToken: 'keep-me',
      name: 'Laptop',
    });
    expect(out).toEqual({
      password: '[REDACTED]',
      nested: { clientSecret: '[REDACTED]', list: [{ sessionToken: '[REDACTED]' }] },
      qrToken: 'keep-me',
      name: 'Laptop',
    });
  });
});

describe('AuditService.diff', () => {
  it('returns only changed fields as old → new', () => {
    expect(AuditService.diff({ a: 1, b: 'x', c: null }, { a: 1, b: 'y', d: 2 })).toEqual({
      b: { old: 'x', new: 'y' },
      d: { old: null, new: 2 },
    });
  });
});

describe('mapDatabaseError', () => {
  const known = (code: string, message: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test', meta });

  it('maps unique violations on serial number to an Arabic duplicate message', () => {
    const mapped = mapDatabaseError(known('P2002', 'Unique constraint failed', { target: ['serial_number'] }));
    expect(mapped?.code).toBe('DUPLICATE');
    expect(mapped?.fields?.serialNumber?.[0]).toContain('الرقم التسلسلي');
  });
  it('maps trigger messages to domain codes', () => {
    expect(mapDatabaseError(known('P2010', 'ASSET_SOLD: operational fields frozen'))?.code).toBe('ASSET_SOLD');
    expect(mapDatabaseError(known('P2010', 'IMMUTABLE: UPDATE on audit_logs'))?.code).toBe('INVALID_STATE');
  });
  it('maps serialization failures to CONFLICT', () => {
    expect(mapDatabaseError(known('P2034', 'Transaction failed due to a write conflict'))?.code).toBe('CONFLICT');
  });
  it('ignores non-database errors', () => {
    expect(mapDatabaseError(new Error('boom'))).toBeNull();
  });
});
