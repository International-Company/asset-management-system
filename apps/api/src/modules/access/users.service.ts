import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { orderBy, paging } from '../../common/pagination';
import { AuditActor, AuditService } from '../audit/audit.service';
import { EAP_PROVIDER, EapProvider } from '../eap/eap.types';
import { EmployeesService } from '../employees/employees.service';
import { SecurityLogService } from '../security/security-log.service';
import { CreateUserDto, UserListQueryDto } from './access.dto';
import { ADMIN_GUARD_LOCK, assertAdminRemains } from './roles.service';

const USER_INCLUDE = {
  employee: { select: { id: true, eapEmployeeId: true, fullName: true, jobTitle: true, email: true, isActive: true } },
  roles: {
    where: { scopeLocationId: null, scopeDepartmentId: null },
    include: { role: { select: { id: true, key: true, name: true, status: true } } },
  },
  _count: { select: { passkeys: { where: { revokedAt: null } } } },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

function present(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    isActive: u.isActive,
    lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil : null,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    employee: u.employee,
    roles: u.roles.map((r) => r.role),
    /** Active fingerprints (passkeys) registered in the Asset System. */
    passkeys: u._count.passkeys,
  };
}

/**
 * Asset System accounts (spec §43–44, §46). A user is always linked to an
 * EAP employee; authentication itself stays with EAP. Users are
 * deactivated, never deleted.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly securityLog: SecurityLogService,
    private readonly employees: EmployeesService,
    @Inject(EAP_PROVIDER) private readonly eap: EapProvider,
  ) {}

  async list(query: UserListQueryDto) {
    const { skip, take, page, pageSize } = paging(query);
    const now = new Date();
    const where: Prisma.UserWhereInput = {
      ...(query.q
        ? {
            OR: [
              { username: { contains: query.q, mode: 'insensitive' } },
              { employee: { fullName: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(query.state === 'active' ? { isActive: true } : {}),
      ...(query.state === 'inactive' ? { isActive: false } : {}),
      ...(query.state === 'locked' ? { lockedUntil: { gt: now } } : {}),
      ...(query.roleId ? { roles: { some: { roleId: query.roleId } } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        include: USER_INCLUDE,
        orderBy: orderBy<Prisma.UserOrderByWithRelationInput>(
          query,
          {
            username: (d) => ({ username: d }),
            fullName: (d) => ({ employee: { fullName: d } }),
            lastLoginAt: (d) => ({ lastLoginAt: { sort: d, nulls: 'last' } }),
            createdAt: (d) => ({ createdAt: d }),
          },
          'fullName',
        ),
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map(present), total, page, pageSize };
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
    if (!user) throw AppError.notFound('المستخدم غير موجود.');
    return present(user);
  }

  async create(dto: CreateUserDto, actor: AuditActor) {
    const fresh = await this.eap.getEmployee(dto.eapEmployeeId);
    if (!fresh) throw AppError.notFound('الموظف غير موجود في EAP.');
    if (!fresh.isActive) throw AppError.invalidState('لا يمكن إنشاء حساب لموظف غير فعّال في EAP.');

    return this.prisma.transaction(async (tx) => {
      const employee = await this.employees.ensureCached(dto.eapEmployeeId, tx);
      const existing = await tx.user.findUnique({ where: { employeeId: employee.id } });
      if (existing) throw new AppError('DUPLICATE', 'لهذا الموظف حساب مسبقًا في النظام.');
      await this.assertRolesUsable(tx, dto.roleIds);

      const user = await tx.user.create({
        data: {
          username: dto.username,
          employeeId: employee.id,
          roles: { create: dto.roleIds.map((roleId) => ({ roleId, assignedById: actor.id })) },
        },
        include: USER_INCLUDE,
      });
      const roleKeys = user.roles.map((r) => r.role.key);
      await this.audit.record(
        { actor, operation: 'USER_CREATED', entityType: 'User', entityId: user.id, newData: { username: user.username, employee: employee.fullName, roles: roleKeys } },
        tx,
      );
      await this.securityLog.record(
        { type: 'USER_CREATED', userId: user.id, username: user.username, actorId: actor.id, details: { roles: roleKeys } },
        tx,
      );
      return present(user);
    });
  }

  /** Activates/deactivates an account. Deactivation ends all of the user's sessions. */
  async setActive(id: string, isActive: boolean, actor: AuditActor) {
    if (!isActive && id === actor.id) throw AppError.invalidState('لا يمكنك تعطيل حسابك.');
    return this.prisma.transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_GUARD_LOCK})`;
      const before = await tx.user.findUnique({ where: { id } });
      if (!before) throw AppError.notFound('المستخدم غير موجود.');
      if (before.isActive === isActive) return this.getIn(tx, id);

      if (isActive) {
        const employee = await tx.employee.findUniqueOrThrow({ where: { id: before.employeeId } });
        if (!employee.isActive) throw AppError.invalidState('الموظف غير فعّال في EAP، ولا يمكن تفعيل حسابه.');
      }

      await tx.user.update({ where: { id }, data: { isActive } });
      if (!isActive) {
        await assertAdminRemains(tx);
        await tx.session.updateMany({
          where: { userId: id, status: 'ACTIVE' },
          data: { status: 'TERMINATED', endedAt: new Date(), terminatedById: actor.id },
        });
      }
      await this.audit.record(
        { actor, operation: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', entityType: 'User', entityId: id, oldData: { isActive: before.isActive }, newData: { isActive } },
        tx,
      );
      await this.securityLog.record(
        { type: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', userId: id, username: before.username, actorId: actor.id },
        tx,
      );
      return this.getIn(tx, id);
    });
  }

  async unlock(id: string, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id } });
      if (!before) throw AppError.notFound('المستخدم غير موجود.');
      await tx.user.update({ where: { id }, data: { lockedUntil: null, failedLoginCount: 0 } });
      await this.audit.record({ actor, operation: 'USER_UNLOCKED', entityType: 'User', entityId: id, oldData: { lockedUntil: before.lockedUntil } }, tx);
      await this.securityLog.record({ type: 'USER_UNLOCKED', userId: id, username: before.username, actorId: actor.id }, tx);
      return this.getIn(tx, id);
    });
  }

  /**
   * Lost or replaced device: revokes every passkey of the user. They register a
   * new one at their next sign-in, right after the password (spec §47).
   */
  async resetPasskeys(id: string, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id } });
      if (!before) throw AppError.notFound('المستخدم غير موجود.');
      const res = await tx.userPasskey.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedById: actor.id } });
      await this.audit.record({ actor, operation: 'USER_PASSKEYS_RESET', entityType: 'User', entityId: id, newData: { revoked: res.count } }, tx);
      await this.securityLog.record({ type: 'PASSKEY_REVOKED', userId: id, username: before.username, actorId: actor.id, details: { all: true, revoked: res.count } }, tx);
      // Quick PIN sign-in rides on the same trust: a lost phone loses both.
      const quick = await tx.quickLoginDevice.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'admin_reset' } });
      if (quick.count) await this.securityLog.record({ type: 'QUICK_LOGIN_REVOKED', userId: id, username: before.username, actorId: actor.id, details: { all: true, revoked: quick.count, reason: 'admin_reset' } }, tx);
      return this.getIn(tx, id);
    });
  }

  /**
   * Replaces the user's global role assignments. Scoped assignments are
   * reserved for the future scope feature (spec §45) and are not exposed.
   */
  async setRoles(id: string, roleIds: string[], actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_GUARD_LOCK})`;
      const user = await tx.user.findUnique({ where: { id }, include: USER_INCLUDE });
      if (!user) throw AppError.notFound('المستخدم غير موجود.');

      const current = user.roles.map((r) => r.role.id);
      const toAdd = roleIds.filter((r) => !current.includes(r));
      const toRemove = current.filter((r) => !roleIds.includes(r));
      if (!toAdd.length && !toRemove.length) return present(user);
      await this.assertRolesUsable(tx, toAdd);

      if (toRemove.length) {
        await tx.userRole.deleteMany({ where: { userId: id, roleId: { in: toRemove }, scopeLocationId: null, scopeDepartmentId: null } });
      }
      if (toAdd.length) {
        await tx.userRole.createMany({ data: toAdd.map((roleId) => ({ userId: id, roleId, assignedById: actor.id })) });
      }
      await assertAdminRemains(tx);

      const after = await tx.user.findUniqueOrThrow({ where: { id }, include: USER_INCLUDE });
      const oldKeys = user.roles.map((r) => r.role.key);
      const newKeys = after.roles.map((r) => r.role.key);
      await this.audit.record(
        { actor, operation: 'USER_ROLES_CHANGED', entityType: 'User', entityId: id, oldData: { roles: oldKeys }, newData: { roles: newKeys } },
        tx,
      );
      await this.securityLog.record(
        { type: 'ROLE_CHANGED', userId: id, username: user.username, actorId: actor.id, details: { from: oldKeys, to: newKeys } },
        tx,
      );
      return present(after);
    });
  }

  private async getIn(tx: Prisma.TransactionClient, id: string) {
    return present(await tx.user.findUniqueOrThrow({ where: { id }, include: USER_INCLUDE }));
  }

  private async assertRolesUsable(tx: Prisma.TransactionClient, roleIds: string[]): Promise<void> {
    if (!roleIds.length) return;
    const roles = await tx.role.findMany({ where: { id: { in: roleIds } } });
    if (roles.length !== roleIds.length) throw AppError.validation({ roleIds: ['أحد الأدوار غير موجود.'] });
    if (roles.some((r) => r.status !== 'ACTIVE')) {
      throw AppError.validation({ roleIds: ['لا يمكن إسناد دور معطّل.'] });
    }
  }
}
