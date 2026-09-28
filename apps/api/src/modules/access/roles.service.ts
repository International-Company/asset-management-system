import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ALL_PERMISSIONS, PERMISSION_LABELS, type PermissionKey, SYSTEM_ROLES } from '@osooli/shared';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { AuditActor, AuditService } from '../audit/audit.service';
import { SecurityLogService } from '../security/security-log.service';
import { CreateRoleDto, UpdateRoleDto } from './access.dto';

/** Serializes changes that could remove the last System Administrator. */
export const ADMIN_GUARD_LOCK = 727002;

/**
 * Roles and permissions (spec §43–44). Roles are disabled, never deleted.
 * Effective permissions are re-read on every request, so changes apply
 * immediately to signed-in users.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly securityLog: SecurityLogService,
  ) {}

  catalogue() {
    return ALL_PERMISSIONS.map((key) => ({ key, label: PERMISSION_LABELS[key], group: key.split('.')[0] }));
  }

  async list() {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: {
        permissions: { select: { permissionKey: true } },
        _count: { select: { users: { where: { user: { isActive: true } } } } },
      },
    });
    return roles.map(({ permissions, _count, ...r }) => ({
      ...r,
      permissionKeys: permissions.map((p) => p.permissionKey).sort(),
      activeUserCount: _count.users,
    }));
  }

  async create(dto: CreateRoleDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          key: `CUSTOM_${randomUUID().slice(0, 8).toUpperCase()}`,
          name: dto.name,
          description: dto.description ?? null,
          permissions: { create: dto.permissionKeys.map((permissionKey) => ({ permissionKey })) },
        },
      });
      await this.audit.record(
        { actor, operation: 'ROLE_CREATED', entityType: 'Role', entityId: role.id, newData: { ...role, permissionKeys: dto.permissionKeys } },
        tx,
      );
      await this.securityLog.record(
        { type: 'PERMISSION_CHANGED', actorId: actor.id, details: { roleId: role.id, role: role.name, created: true, added: dto.permissionKeys } },
        tx,
      );
      return role;
    });
  }

  async update(id: string, dto: UpdateRoleDto, actor: AuditActor) {
    return this.prisma.transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_GUARD_LOCK})`;
      const role = await tx.role.findUnique({ where: { id }, include: { permissions: true } });
      if (!role) throw AppError.notFound('الدور غير موجود.');

      const isAdminRole = role.key === SYSTEM_ROLES.SYSTEM_ADMINISTRATOR;
      if (isAdminRole && (dto.permissionKeys !== undefined || dto.status === 'INACTIVE')) {
        throw AppError.invalidState('دور مدير النظام يملك جميع الصلاحيات دائمًا ولا يمكن تعطيله أو تقليص صلاحياته.');
      }

      const before = { name: role.name, description: role.description, status: role.status };
      const oldKeys = role.permissions.map((p) => p.permissionKey as PermissionKey);
      const updated = await tx.role.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.status ? { status: dto.status } : {}),
        },
      });

      let added: PermissionKey[] = [];
      let removed: PermissionKey[] = [];
      if (dto.permissionKeys) {
        added = dto.permissionKeys.filter((k) => !oldKeys.includes(k));
        removed = oldKeys.filter((k) => !dto.permissionKeys!.includes(k));
        if (removed.length) await tx.rolePermission.deleteMany({ where: { roleId: id, permissionKey: { in: removed } } });
        if (added.length) await tx.rolePermission.createMany({ data: added.map((permissionKey) => ({ roleId: id, permissionKey })) });
      }

      await this.audit.record(
        {
          actor,
          operation: 'ROLE_UPDATED',
          entityType: 'Role',
          entityId: id,
          oldData: { ...before, permissionKeys: oldKeys },
          newData: {
            name: updated.name,
            description: updated.description,
            status: updated.status,
            permissionKeys: dto.permissionKeys ?? oldKeys,
          },
        },
        tx,
      );
      if (added.length || removed.length || (dto.status && dto.status !== role.status)) {
        await this.securityLog.record(
          {
            type: 'PERMISSION_CHANGED',
            actorId: actor.id,
            details: { roleId: id, role: updated.name, added, removed, status: dto.status && dto.status !== role.status ? dto.status : undefined },
          },
          tx,
        );
      }
      return updated;
    });
  }
}

/** Throws unless at least one active user still holds an active System Administrator role. */
export async function assertAdminRemains(tx: Tx): Promise<void> {
  const count = await tx.userRole.count({
    where: {
      role: { key: SYSTEM_ROLES.SYSTEM_ADMINISTRATOR, status: 'ACTIVE' },
      user: { isActive: true },
    },
  });
  if (count === 0) {
    throw AppError.invalidState('يجب أن يبقى مستخدم فعّال واحد على الأقل بدور مدير النظام.');
  }
}
