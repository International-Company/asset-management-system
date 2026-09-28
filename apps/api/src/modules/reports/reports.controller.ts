import { Body, Controller, Get, HttpCode, Module, Param, Post, Res, StreamableFile } from '@nestjs/common';
import { IsIn, IsObject } from 'class-validator';
import type { Response } from 'express';
import { PERMISSIONS } from '@osooli/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { RequestUser } from '../../common/request-user';
import { ReportsService } from './reports.service';

class PreviewDto {
  @IsObject()
  filters: Record<string, unknown>;
}

class ExportDto extends PreviewDto {
  @IsIn(['pdf', 'xlsx'])
  format: 'pdf' | 'xlsx';
}

/** Reports module (spec §40). Per-report permissions are checked in the service. */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  @Get()
  catalogue(@CurrentUser() user: RequestUser) {
    return this.reports.catalogue(user);
  }

  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  @Post(':key/preview')
  @HttpCode(200)
  preview(@Param('key') key: string, @Body() dto: PreviewDto, @CurrentUser() user: RequestUser) {
    return this.reports.preview(key, dto.filters, user);
  }

  @RequirePermissions(PERMISSIONS.REPORTS_VIEW, PERMISSIONS.REPORTS_EXPORT)
  @Post(':key/export')
  @HttpCode(200)
  async export(@Param('key') key: string, @Body() dto: ExportDto, @CurrentUser() user: RequestUser, @Res({ passthrough: true }) res: Response) {
    const file = await this.reports.export(key, dto.filters, dto.format, user);
    res.set({
      'Content-Type': file.mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
    return new StreamableFile(file.body);
  }
}

@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
