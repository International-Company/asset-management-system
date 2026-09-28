import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { formatNumber, PERMISSIONS } from '@osooli/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import { actorOf, RequestUser } from '../../common/request-user';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCurrencyDto, UpdateCurrencyDto, UpdateSequenceDto, UpdateSettingsDto } from './settings.dto';
import { SettingsService } from './settings.service';
import { StorageService, type UploadedFile as Upload } from '../storage/storage.service';
import { ALLOWABLE_EXTENSIONS } from './settings.validation';

const SEQUENCE_LABELS: Record<string, string> = {
  'ASSET:OFF': 'أرقام الأصول المكتبية',
  'ASSET:OPR': 'أرقام الأصول التشغيلية',
  'ASSET:TEC': 'أرقام الأصول التقنية',
  'ASSET:REA': 'أرقام الأصول العقارية',
  'OP:TRF': 'عمليات النقل',
  'OP:CUS': 'محاضر العهدة',
  'OP:RET': 'محاضر الإرجاع',
  'OP:SAL': 'عمليات البيع',
  'OP:MNT': 'طلبات الصيانة',
  'OP:INV': 'عمليات الجرد',
  'OP:INT-SN': 'الأرقام التسلسلية الداخلية',
};

/** Global settings (spec §64). System Administrator only. */
@RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async all() {
    return { values: await this.settings.all(), allowableExtensions: ALLOWABLE_EXTENSIONS };
  }

  @Patch()
  update(@Body() dto: UpdateSettingsDto, @CurrentUser() user: RequestUser) {
    return this.settings.setMany(dto.values, actorOf(user));
  }

  // ── Company logo (spec §65) ────────────────────────────────────────────

  /** Uploads the logo used in the UI, PDFs and reports. PNG, JPEG or WebP. */
  @Post('logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async uploadLogo(@UploadedFile() file: Upload | undefined, @CurrentUser() user: RequestUser) {
    const stored = await this.prisma.transaction(async (tx) => {
      const f = await this.storage.store(file, user.id, tx, { imagesOnly: true });
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.mimeType)) {
        throw new AppError('FILE_REJECTED', 'الشعار يجب أن يكون بصيغة PNG أو JPEG أو WebP.');
      }
      return f;
    });
    await this.settings.set('company.logoFileId', stored.id, actorOf(user));
    return { fileId: stored.id };
  }

  @Delete('logo')
  @HttpCode(204)
  async removeLogo(@CurrentUser() user: RequestUser) {
    await this.settings.set('company.logoFileId', null, actorOf(user));
  }

  // ── Numbering (spec §7) ────────────────────────────────────────────────

  @Get('sequences')
  async sequences() {
    const rows = await this.prisma.numberSequence.findMany({ orderBy: { key: 'asc' } });
    return rows.map((s) => ({
      key: s.key,
      label: SEQUENCE_LABELS[s.key] ?? s.key,
      prefix: s.prefix,
      nextValue: Number(s.nextValue),
      digits: s.digits,
      preview: formatNumber(s.prefix, Number(s.nextValue), s.digits),
    }));
  }

  /**
   * Changes prefix / next number / digit count. The next number can only
   * move forward, so no number is ever issued twice (spec §7, §60).
   */
  @Patch('sequences/:key')
  async updateSequence(@Param('key') key: string, @Body() dto: UpdateSequenceDto, @CurrentUser() user: RequestUser) {
    return this.prisma.transaction(async (tx) => {
      // Lock the row so a concurrent allocation cannot slip in between check and update.
      const rows = await tx.$queryRaw<Array<{ prefix: string; next_value: bigint; digits: number }>>`
        SELECT prefix, next_value, digits FROM number_sequences WHERE key = ${key} FOR UPDATE`;
      const current = rows[0];
      if (!current) throw AppError.notFound('التسلسل غير موجود.');
      if (dto.nextValue !== undefined && BigInt(dto.nextValue) < current.next_value) {
        throw AppError.validation(
          { nextValue: [`لا يمكن الرجوع إلى رقم أقل من ${current.next_value}؛ الأرقام لا يعاد استخدامها.`] },
        );
      }
      const updated = await tx.numberSequence.update({
        where: { key },
        data: {
          ...(dto.prefix !== undefined ? { prefix: dto.prefix } : {}),
          ...(dto.nextValue !== undefined ? { nextValue: BigInt(dto.nextValue) } : {}),
          ...(dto.digits !== undefined ? { digits: dto.digits } : {}),
        },
      });
      await this.audit.record(
        {
          actor: actorOf(user),
          operation: 'NUMBER_SEQUENCE_CHANGED',
          entityType: 'NumberSequence',
          entityId: key,
          oldData: { prefix: current.prefix, nextValue: Number(current.next_value), digits: current.digits },
          newData: { prefix: updated.prefix, nextValue: Number(updated.nextValue), digits: updated.digits },
        },
        tx,
      );
      return {
        key,
        label: SEQUENCE_LABELS[key] ?? key,
        prefix: updated.prefix,
        nextValue: Number(updated.nextValue),
        digits: updated.digits,
        preview: formatNumber(updated.prefix, Number(updated.nextValue), updated.digits),
      };
    });
  }

  // ── Currencies (spec §16) ──────────────────────────────────────────────

  @Get('currencies')
  currencies() {
    return this.prisma.currency.findMany({ orderBy: { code: 'asc' } });
  }

  @Post('currencies')
  async createCurrency(@Body() dto: CreateCurrencyDto, @CurrentUser() user: RequestUser) {
    return this.prisma.transaction(async (tx) => {
      if (await tx.currency.findUnique({ where: { code: dto.code } })) {
        throw new AppError('DUPLICATE', 'رمز العملة مستخدم مسبقًا.', { fields: { code: ['رمز العملة مستخدم مسبقًا.'] } });
      }
      const row = await tx.currency.create({ data: { code: dto.code, nameAr: dto.nameAr, symbol: dto.symbol ?? null } });
      await this.audit.record({ actor: actorOf(user), operation: 'CURRENCY_CREATED', entityType: 'Currency', entityId: row.code, newData: row }, tx);
      return row;
    });
  }

  @Patch('currencies/:code')
  async updateCurrency(@Param('code') code: string, @Body() dto: UpdateCurrencyDto, @CurrentUser() user: RequestUser) {
    return this.prisma.transaction(async (tx) => {
      const before = await tx.currency.findUnique({ where: { code } });
      if (!before) throw AppError.notFound('العملة غير موجودة.');
      if (dto.status === 'INACTIVE' && (await this.settings.get('currency.default', tx)) === code) {
        throw AppError.invalidState('لا يمكن تعطيل العملة الافتراضية. اختر عملة افتراضية أخرى أولًا.');
      }
      const after = await tx.currency.update({ where: { code }, data: dto });
      await this.audit.record(
        { actor: actorOf(user), operation: 'CURRENCY_UPDATED', entityType: 'Currency', entityId: code, oldData: before, newData: after },
        tx,
      );
      return after;
    });
  }
}
