import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { SYSTEM_ROLES } from '@osooli/shared';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { ADMIN_GUARD_LOCK } from '../access/roles.service';
import { AuditService } from '../audit/audit.service';
import { EAP_PROVIDER, EapProvider } from '../eap/eap.types';
import { EmployeesService } from '../employees/employees.service';
import { SecurityLogService } from '../security/security-log.service';
import { BootstrapService } from './bootstrap.service';

export type InitialAdminResult = 'disabled' | 'already-configured' | 'created';

/**
 * Creates the first System Administrator on a fresh deployment, where the
 * seed never runs (spec §85). INITIAL_ADMIN_EAP_EMPLOYEE_ID and
 * INITIAL_ADMIN_USERNAME name an active EAP employee. They are used only while
 * no System Administrator exists; after that they are ignored and can be
 * removed. The account signs in through EAP like everyone else.
 */
@Injectable()
export class InitialAdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InitialAdminService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly bootstrap: BootstrapService,
    private readonly audit: AuditService,
    private readonly securityLog: SecurityLogService,
    private readonly employees: EmployeesService,
    @Inject(EAP_PROVIDER) private readonly eap: EapProvider,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensure();
    } catch (e) {
      // Never block start-up (e.g. EAP briefly unreachable); the next start retries.
      this.logger.error({ err: e instanceof Error ? e.message : String(e) }, 'Initial administrator could not be created');
    }
  }

  async ensure(): Promise<InitialAdminResult> {
    const eapEmployeeId = this.env.INITIAL_ADMIN_EAP_EMPLOYEE_ID;
    const username = this.env.INITIAL_ADMIN_USERNAME;
    if (!eapEmployeeId || !username) return 'disabled';
    await this.bootstrap.ensure();
    if (await this.adminExists()) return 'already-configured';

    const fresh = await this.eap.getEmployee(eapEmployeeId);
    if (!fresh) throw new Error('INITIAL_ADMIN_EAP_EMPLOYEE_ID was not found in EAP');
    if (!fresh.isActive) throw new Error('INITIAL_ADMIN_EAP_EMPLOYEE_ID is not an active EAP employee');

    return this.prisma.transaction(async (tx) => {
      // Same lock as role and account changes, so two replicas cannot both create it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_GUARD_LOCK})`;
      if (await this.adminExists(tx)) return 'already-configured';
      const role = await tx.role.findUniqueOrThrow({ where: { key: SYSTEM_ROLES.SYSTEM_ADMINISTRATOR } });
      const employee = await this.employees.ensureCached(eapEmployeeId, tx);
      const existing = await tx.user.findUnique({ where: { employeeId: employee.id } });
      if (existing && existing.username !== username) throw new Error('This employee already has an account with a different username');
      const user = existing
        ? await tx.user.update({ where: { id: existing.id }, data: { isActive: true } })
        : await tx.user.create({ data: { username, employeeId: employee.id } });
      const assigned = await tx.userRole.findFirst({ where: { userId: user.id, roleId: role.id, scopeLocationId: null, scopeDepartmentId: null } });
      if (!assigned) await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });

      const actor = { id: null, name: 'تهيئة النظام' };
      await this.audit.record(
        { actor, operation: 'USER_CREATED', entityType: 'User', entityId: user.id, newData: { username, employee: employee.fullName, roles: [role.key], initialAdministrator: true } },
        tx,
      );
      await this.securityLog.record({ type: 'USER_CREATED', userId: user.id, username, details: { roles: [role.key], initialAdministrator: true } }, tx);
      this.logger.log({ username }, 'Initial System Administrator created');
      return 'created';
    });
  }

  private async adminExists(tx: Pick<PrismaService, 'userRole'> = this.prisma): Promise<boolean> {
    const count = await tx.userRole.count({ where: { role: { key: SYSTEM_ROLES.SYSTEM_ADMINISTRATOR }, user: { isActive: true } } });
    return count > 0;
  }
}
