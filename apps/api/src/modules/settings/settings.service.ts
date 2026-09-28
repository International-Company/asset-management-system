import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { AuditActor, AuditService } from '../audit/audit.service';
import { SecurityLogService } from '../security/security-log.service';
import { SECURITY_SETTING_KEYS, SETTINGS_DEFAULTS, SettingKey, SettingsShape } from './settings.defaults';
import { SETTING_RULES_AR, SETTING_VALIDATORS } from './settings.validation';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly securityLog: SecurityLogService,
  ) {}

  async get<K extends SettingKey>(key: K, tx?: Tx): Promise<SettingsShape[K]> {
    const row = await (tx ?? this.prisma).setting.findUnique({ where: { key } });
    return (row?.value as SettingsShape[K] | undefined) ?? SETTINGS_DEFAULTS[key];
  }

  async getMany<K extends SettingKey>(keys: K[]): Promise<Pick<SettingsShape, K>> {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: keys } } });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const out = {} as Pick<SettingsShape, K>;
    for (const k of keys) {
      out[k] = (byKey.get(k) as SettingsShape[K] | undefined) ?? SETTINGS_DEFAULTS[k];
    }
    return out;
  }

  /** Every known setting with its current value. */
  all(): Promise<SettingsShape> {
    return this.getMany(Object.keys(SETTINGS_DEFAULTS) as SettingKey[]);
  }

  /**
   * Validates and saves several settings atomically. Each change is audited
   * as old → new; security settings also go to the Security Log (spec §64).
   */
  async setMany(values: Record<string, unknown>, actor: AuditActor): Promise<SettingsShape> {
    const fields: Record<string, string[]> = {};
    const parsed: Array<[SettingKey, unknown]> = [];
    for (const [key, value] of Object.entries(values)) {
      const validator = SETTING_VALIDATORS[key as SettingKey];
      if (!validator) {
        fields[key] = ['إعداد غير معروف أو غير قابل للتعديل من هنا.'];
        continue;
      }
      const result = validator.safeParse(value);
      if (!result.success) fields[key] = [SETTING_RULES_AR[key as SettingKey] ?? 'القيمة غير صالحة.'];
      else parsed.push([key as SettingKey, result.data]);
    }
    if (Object.keys(fields).length) throw AppError.validation(fields);

    await this.prisma.transaction(async (tx) => {
      for (const [key, value] of parsed) {
        if (key === 'currency.default') {
          const currency = await tx.currency.findUnique({ where: { code: value as string } });
          if (!currency || currency.status !== 'ACTIVE') {
            throw AppError.validation({ [key]: [SETTING_RULES_AR[key]!] });
          }
        }
        await this.setIn(tx, key, value as SettingsShape[typeof key], actor);
      }
    });
    return this.all();
  }

  async set<K extends SettingKey>(key: K, value: SettingsShape[K], actor: AuditActor): Promise<void> {
    await this.prisma.transaction((tx) => this.setIn(tx, key, value, actor));
  }

  private async setIn<K extends SettingKey>(tx: Tx, key: K, value: SettingsShape[K], actor: AuditActor): Promise<void> {
    const old = await this.get(key, tx);
    if (JSON.stringify(old) === JSON.stringify(value)) return;
    const json = value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
    await tx.setting.upsert({
      where: { key },
      create: { key, value: json, updatedById: actor.id },
      update: { value: json, updatedById: actor.id },
    });
    await this.audit.record(
      { actor, operation: 'SETTING_CHANGED', entityType: 'Setting', entityId: key, oldData: { value: old }, newData: { value } },
      tx,
    );
    if (SECURITY_SETTING_KEYS.has(key)) {
      await this.securityLog.record(
        { type: 'SECURITY_SETTING_CHANGED', actorId: actor.id, details: { key, old, new: value } },
        tx,
      );
    }
  }
}
