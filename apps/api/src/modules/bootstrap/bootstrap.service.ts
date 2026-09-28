import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  ALL_PERMISSIONS,
  ASSET_MANAGER_PERMISSIONS,
  PERMISSION_LABELS,
  SYSTEM_ROLES,
} from '@osooli/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SETTINGS_DEFAULTS } from '../settings/settings.defaults';
import { CURRENCIES, MAIN_CATEGORIES, NOTIFICATION_TYPES, NUMBER_SEQUENCES } from './reference-data';

/**
 * Idempotently ensures reference data exists. Existing values edited by the
 * administrator (sequences, settings, Asset Manager permissions) are never
 * overwritten. The System Administrator role always holds every permission.
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  private pending: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensure();
  }

  /** Runs once per process; later callers wait for the same run. */
  ensure(): Promise<void> {
    this.pending ??= this.run();
    return this.pending;
  }

  async run(): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      // Serialize concurrent boots (e.g. several replicas starting together).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(727001)`;

      for (const key of ALL_PERMISSIONS) {
        await tx.permission.upsert({
          where: { key },
          create: { key, label: PERMISSION_LABELS[key] },
          update: { label: PERMISSION_LABELS[key] },
        });
      }

      const admin = await tx.role.upsert({
        where: { key: SYSTEM_ROLES.SYSTEM_ADMINISTRATOR },
        create: { key: SYSTEM_ROLES.SYSTEM_ADMINISTRATOR, name: 'مدير النظام', isSystem: true },
        update: {},
      });
      await tx.rolePermission.createMany({
        data: ALL_PERMISSIONS.map((permissionKey) => ({ roleId: admin.id, permissionKey })),
        skipDuplicates: true,
      });

      const existingManager = await tx.role.findUnique({ where: { key: SYSTEM_ROLES.ASSET_MANAGER } });
      if (!existingManager) {
        const manager = await tx.role.create({
          data: { key: SYSTEM_ROLES.ASSET_MANAGER, name: 'مدير الأصول', isSystem: true },
        });
        await tx.rolePermission.createMany({
          data: ASSET_MANAGER_PERMISSIONS.map((permissionKey) => ({ roleId: manager.id, permissionKey })),
        });
      }

      for (const c of MAIN_CATEGORIES) {
        await tx.mainCategory.upsert({ where: { code: c.code }, create: c, update: { nameAr: c.nameAr } });
      }
      await tx.numberSequence.createMany({
        data: NUMBER_SEQUENCES.map((s) => ({ ...s, nextValue: BigInt(s.nextValue) })),
        skipDuplicates: true,
      });
      await tx.currency.createMany({ data: CURRENCIES, skipDuplicates: true });
      const existingTypes = new Set((await tx.notificationType.findMany({ select: { key: true } })).map((t) => t.key));
      for (const { defaultRoles, defaultResponsible, ...type } of NOTIFICATION_TYPES) {
        if (existingTypes.has(type.key)) continue;
        await tx.notificationType.create({ data: type });
        for (const roleKey of defaultRoles ?? []) {
          const role = await tx.role.findUniqueOrThrow({ where: { key: roleKey } });
          await tx.notificationRecipient.create({ data: { typeKey: type.key, roleId: role.id } });
        }
        if (defaultResponsible) {
          await tx.notificationRecipient.create({ data: { typeKey: type.key, targetResponsible: true } });
        }
      }
      await tx.setting.createMany({
        data: Object.entries(SETTINGS_DEFAULTS).map(([key, value]) => ({
          key,
          value: value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue),
          isSensitive: key.startsWith('security.'),
        })),
        skipDuplicates: true,
      });
    });
    this.logger.log('Reference data verified');
  }
}
