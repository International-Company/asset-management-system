import type { INestApplication } from '@nestjs/common';
import { SYSTEM_ROLES } from '@osooli/shared';
import { ENV } from '../src/config/config.module';
import { type Env, validateEnv } from '../src/config/env';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { BootstrapService } from '../src/modules/bootstrap/bootstrap.service';
import { InitialAdminService } from '../src/modules/bootstrap/initial-admin.service';
import { EAP_PROVIDER } from '../src/modules/eap/eap.types';
import { EmployeesService } from '../src/modules/employees/employees.service';
import { SecurityLogService } from '../src/modules/security/security-log.service';
import { createApp, login } from './helpers';

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  ({ app, prisma } = await createApp());
});

afterAll(async () => {
  await app.close();
});

function service(overrides: Partial<Env>) {
  const env = { ...app.get<Env>(ENV), ...overrides };
  return new InitialAdminService(env, prisma, app.get(BootstrapService), app.get(AuditService), app.get(SecurityLogService), app.get(EmployeesService), app.get(EAP_PROVIDER));
}

describe('Initial System Administrator (fresh production deployment)', () => {
  it('does nothing unless both variables are set, and never once an administrator exists', async () => {
    expect(await service({ INITIAL_ADMIN_EAP_EMPLOYEE_ID: undefined, INITIAL_ADMIN_USERNAME: undefined }).ensure()).toBe('disabled');
    expect(await service({ INITIAL_ADMIN_EAP_EMPLOYEE_ID: 'EMP-1006', INITIAL_ADMIN_USERNAME: 'staff2' }).ensure()).toBe('already-configured');
  });

  it('creates the account with the System Administrator role when none exists, audited, and it can sign in', async () => {
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: SYSTEM_ROLES.SYSTEM_ADMINISTRATOR } });
    const admins = await prisma.userRole.findMany({ where: { roleId: adminRole.id, user: { isActive: true } }, select: { userId: true } });
    const ids = admins.map((a) => a.userId);
    const staff2 = await prisma.user.findUnique({ where: { username: 'staff2' } });
    const hadRole = !!staff2 && ids.includes(staff2.id);
    // Simulate a fresh system: no active administrator.
    await prisma.user.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
    try {
      expect(await service({ INITIAL_ADMIN_EAP_EMPLOYEE_ID: 'EMP-1006', INITIAL_ADMIN_USERNAME: 'staff2' }).ensure()).toBe('created');

      const user = await prisma.user.findUniqueOrThrow({ where: { username: 'staff2' }, include: { roles: { include: { role: true } } } });
      expect(user.roles.map((r) => r.role.key)).toContain(SYSTEM_ROLES.SYSTEM_ADMINISTRATOR);
      expect(await prisma.auditLog.count({ where: { entityId: user.id, operation: 'USER_CREATED', actorId: null } })).toBeGreaterThan(0);
      expect(await prisma.securityLog.count({ where: { userId: user.id, type: 'USER_CREATED' } })).toBeGreaterThan(0);
      await login(app, 'staff2');

      // A second start is a no-op.
      expect(await service({ INITIAL_ADMIN_EAP_EMPLOYEE_ID: 'EMP-1006', INITIAL_ADMIN_USERNAME: 'staff2' }).ensure()).toBe('already-configured');
      if (!hadRole) await prisma.userRole.deleteMany({ where: { userId: user.id, roleId: adminRole.id } });
    } finally {
      await prisma.user.updateMany({ where: { id: { in: ids } }, data: { isActive: true } });
    }
  });

  it('the two variables must be set together', () => {
    const base = { APP_ENV: 'test', DATABASE_URL: 'postgres://x', AUTH_PROVIDER: 'mock', MOCK_AUTH_PASSWORD: 'p', MOCK_AUTH_FINGERPRINT: '0', ENCRYPTION_KEY: 'k'.repeat(40) };
    expect(() => validateEnv({ ...base, INITIAL_ADMIN_EAP_EMPLOYEE_ID: 'EMP-1' })).toThrow(/INITIAL_ADMIN_USERNAME/);
    expect(validateEnv({ ...base, INITIAL_ADMIN_EAP_EMPLOYEE_ID: 'EMP-1', INITIAL_ADMIN_USERNAME: 'Sami.A' }).INITIAL_ADMIN_USERNAME).toBe('sami.a');
  });
});
