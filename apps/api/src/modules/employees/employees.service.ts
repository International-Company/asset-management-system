import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { AuditService, SYSTEM_ACTOR, type AuditActor } from '../audit/audit.service';
import { EAP_PROVIDER, EapEmployee, EapProvider } from '../eap/eap.types';
import { NotificationsService } from '../notifications/notifications.service';

export interface SyncSummary {
  checked: number;
  updated: number;
  deactivated: number;
  reactivated: number;
  missing: number;
  failed: number;
}

/**
 * Employee data comes from EAP (spec §46). Only the employees the Asset
 * System actually uses are cached (users, responsible people, technicians);
 * the full EAP directory is never copied.
 */
@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);
  private syncing = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(EAP_PROVIDER) private readonly eap: EapProvider,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Searches the EAP directory and marks which employees already have an Asset System account. */
  async searchDirectory(query: string, limit = 20) {
    const results = await this.eap.searchEmployees(query, limit);
    const cached = await this.prisma.employee.findMany({
      where: { eapEmployeeId: { in: results.map((r) => r.eapEmployeeId) } },
      select: { id: true, eapEmployeeId: true, user: { select: { id: true, username: true } } },
    });
    return results.map((r) => {
      const c = cached.find((x) => x.eapEmployeeId === r.eapEmployeeId);
      return { ...r, employeeId: c?.id ?? null, user: c?.user ?? null };
    });
  }

  /**
   * Returns the cached employee for an EAP id, fetching it from EAP when
   * missing. Used whenever an employee is linked to a record.
   */
  async ensureCached(eapEmployeeId: string, tx?: Tx) {
    const db = tx ?? this.prisma;
    const existing = await db.employee.findUnique({ where: { eapEmployeeId } });
    if (existing) return existing;
    const fresh = await this.eap.getEmployee(eapEmployeeId);
    if (!fresh) throw AppError.notFound('الموظف غير موجود في EAP.');
    return db.employee.create({ data: this.fields(fresh) });
  }

  /** Employees who are inactive in EAP but still responsible for assets (spec §46). */
  async inactiveResponsibles() {
    const rows = await this.prisma.employee.findMany({
      where: { isActive: false, responsibleFor: { some: {} } },
      select: {
        id: true,
        eapEmployeeId: true,
        fullName: true,
        jobTitle: true,
        lastSyncedAt: true,
        _count: { select: { responsibleFor: true } },
      },
      orderBy: { fullName: 'asc' },
    });
    return rows.map(({ _count, ...e }) => ({ ...e, assetCount: _count.responsibleFor }));
  }

  /** Daily refresh of cached employees from EAP (02:00 company time). */
  @Cron('0 2 * * *', { name: 'eap-employee-sync', timeZone: 'Asia/Hebron' })
  async scheduledSync(): Promise<void> {
    if (this.env.APP_ENV === 'test') return;
    try {
      const summary = await this.syncAll(SYSTEM_ACTOR);
      this.logger.log({ summary }, 'EAP employee sync finished');
    } catch (e) {
      this.logger.error({ err: e }, 'EAP employee sync failed');
    }
  }

  /**
   * Refreshes every cached employee. An employee who became inactive while
   * still responsible for assets triggers the inactive-responsible alert.
   * History is never modified.
   */
  async syncAll(actor: AuditActor): Promise<SyncSummary> {
    if (this.syncing) throw AppError.invalidState('المزامنة قيد التنفيذ حاليًا.');
    this.syncing = true;
    const summary: SyncSummary = { checked: 0, updated: 0, deactivated: 0, reactivated: 0, missing: 0, failed: 0 };
    try {
      const employees = await this.prisma.employee.findMany();
      for (const employee of employees) {
        summary.checked++;
        let fresh: EapEmployee | null;
        try {
          fresh = await this.eap.getEmployee(employee.eapEmployeeId);
        } catch {
          summary.failed++;
          continue;
        }
        // Not returned by EAP: keep the cached record untouched (history must not change).
        if (!fresh) {
          summary.missing++;
          continue;
        }
        const data = this.fields(fresh);
        const changed =
          data.fullName !== employee.fullName ||
          data.jobTitle !== employee.jobTitle ||
          data.email !== employee.email ||
          data.phone !== employee.phone ||
          data.isActive !== employee.isActive;

        await this.prisma.transaction(async (tx) => {
          await tx.employee.update({ where: { id: employee.id }, data: { ...data, lastSyncedAt: new Date() } });
          if (!changed) return;
          summary.updated++;
          await this.audit.record(
            {
              actor,
              operation: 'EMPLOYEE_SYNCED',
              entityType: 'Employee',
              entityId: employee.id,
              oldData: { fullName: employee.fullName, jobTitle: employee.jobTitle, isActive: employee.isActive },
              newData: { fullName: data.fullName, jobTitle: data.jobTitle, isActive: data.isActive },
            },
            tx,
          );
          if (employee.isActive && !data.isActive) {
            summary.deactivated++;
            const assetCount = await tx.asset.count({ where: { responsibleEmployeeId: employee.id } });
            if (assetCount > 0) {
              await this.notifications.notify(
                {
                  typeKey: 'employee.inactive_responsible',
                  title: `الموظف ${data.fullName} أصبح غير فعّال في EAP`,
                  body: `لا يزال مسؤولًا عن ${assetCount} أصل. يرجى نقل العهدة إلى مسؤول آخر.`,
                  entityType: 'Employee',
                  entityId: employee.id,
                },
                tx,
              );
            }
          } else if (!employee.isActive && data.isActive) {
            summary.reactivated++;
          }
        });
      }
      return summary;
    } finally {
      this.syncing = false;
    }
  }

  private fields(e: EapEmployee) {
    return {
      eapEmployeeId: e.eapEmployeeId,
      fullName: e.fullName,
      jobTitle: e.jobTitle,
      email: e.email,
      phone: e.phone,
      isActive: e.isActive,
    };
  }
}
