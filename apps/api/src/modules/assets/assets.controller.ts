import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { PERMISSIONS } from '@osooli/shared';
import { AnyAuthenticated, CurrentUser, RequirePermissions } from '../../common/decorators';
import { SettingsService } from '../settings/settings.service';
import { actorOf, RequestUser } from '../../common/request-user';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import {
  AssetListQueryDto,
  ChangeCategoryDto,
  ChangeSerialDto,
  CreateAssetDto,
  DocumentNameDto,
  LabelsDto,
  PhotoUploadDto,
  UpdateAssetDto,
} from './assets.dto';
import { AssetMediaService } from './asset-media.service';
import { AssetsService } from './assets.service';
import { QrService } from './qr.service';

const P = PERMISSIONS;
const uuid = new ParseUUIDPipe();
/** Hard cap before settings-based validation; the configured limit (≤100 MB) is enforced in StorageService. */
const upload = FileInterceptor('file', { limits: { fileSize: 101 * 1024 * 1024, files: 1 } });

type MulterFile = { originalname: string; buffer: Buffer; size: number };

@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly media: AssetMediaService,
    private readonly qr: QrService,
  ) {}

  @RequirePermissions(P.ASSETS_VIEW)
  @Get()
  list(@Query() q: AssetListQueryDto) {
    return this.assets.list(q);
  }

  @RequirePermissions(P.ASSETS_CREATE)
  @Post()
  create(@Body() dto: CreateAssetDto, @CurrentUser() user: RequestUser) {
    return this.assets.create(dto, actorOf(user));
  }

  @RequirePermissions(P.ASSETS_VIEW)
  @Get(':id')
  get(@Param('id', uuid) id: string) {
    return this.assets.get(id);
  }

  @RequirePermissions(P.ASSETS_EDIT)
  @Patch(':id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateAssetDto, @CurrentUser() user: RequestUser) {
    return this.assets.update(id, dto, actorOf(user));
  }

  @RequirePermissions(P.ASSETS_DELETE)
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', uuid) id: string, @CurrentUser() user: RequestUser) {
    return this.assets.remove(id, actorOf(user));
  }

  @RequirePermissions(P.ASSETS_VIEW)
  @Get(':id/history')
  history(@Param('id', uuid) id: string) {
    return this.assets.history(id);
  }

  @RequirePermissions(P.ASSETS_CHANGE_CATEGORY)
  @Get(':id/category-change')
  previewCategory(@Param('id', uuid) id: string, @Query('subcategoryId', uuid) subcategoryId: string) {
    return this.assets.previewCategoryChange(id, subcategoryId);
  }

  @RequirePermissions(P.ASSETS_CHANGE_CATEGORY)
  @Post(':id/category-change')
  @HttpCode(200)
  changeCategory(@Param('id', uuid) id: string, @Body() dto: ChangeCategoryDto, @CurrentUser() user: RequestUser) {
    return this.assets.changeCategory(id, dto, actorOf(user));
  }

  @RequirePermissions(P.ASSETS_EDIT_SERIAL)
  @Post(':id/serial')
  @HttpCode(200)
  changeSerial(@Param('id', uuid) id: string, @Body() dto: ChangeSerialDto, @CurrentUser() user: RequestUser) {
    return this.assets.changeSerial(id, dto, actorOf(user));
  }

  @RequirePermissions(P.ASSETS_VIEW)
  @Get(':id/qr.svg')
  @Header('Content-Type', 'image/svg+xml')
  @Header('Cache-Control', 'private, max-age=86400')
  qrSvg(@Param('id', uuid) id: string) {
    return this.qr.svgForAsset(id);
  }

  // Photos
  @RequirePermissions(P.ASSETS_EDIT)
  @Post(':id/photos')
  @UseInterceptors(upload)
  addPhoto(
    @Param('id', uuid) id: string,
    @UploadedFile() file: MulterFile | undefined,
    @Body() body: PhotoUploadDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.media.addPhoto(id, file, !!body.isMain, actorOf(user));
  }

  @RequirePermissions(P.ASSETS_EDIT)
  @Post(':id/photos/:photoId/main')
  @HttpCode(200)
  setMain(@Param('id', uuid) id: string, @Param('photoId', uuid) photoId: string, @CurrentUser() user: RequestUser) {
    return this.media.setMainPhoto(id, photoId, actorOf(user));
  }

  @RequirePermissions(P.ASSETS_PHOTOS_DELETE)
  @Delete(':id/photos/:photoId')
  @HttpCode(204)
  removePhoto(@Param('id', uuid) id: string, @Param('photoId', uuid) photoId: string, @CurrentUser() user: RequestUser) {
    return this.media.removePhoto(id, photoId, actorOf(user));
  }

  // Documents
  @RequirePermissions(P.ASSETS_VIEW, P.DOCUMENTS_VIEW)
  @Get(':id/documents')
  documents(@Param('id', uuid) id: string) {
    return this.media.listDocuments(id);
  }

  @RequirePermissions(P.DOCUMENTS_UPLOAD)
  @Post(':id/documents')
  @UseInterceptors(upload)
  addDocument(
    @Param('id', uuid) id: string,
    @UploadedFile() file: MulterFile | undefined,
    @Body() body: DocumentNameDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.media.addDocument(id, body.name, file, actorOf(user));
  }
}

@Controller('documents')
export class DocumentsController {
  constructor(private readonly media: AssetMediaService) {}

  @RequirePermissions(P.DOCUMENTS_UPLOAD)
  @Post(':id/versions')
  @UseInterceptors(upload)
  replace(@Param('id', uuid) id: string, @UploadedFile() file: MulterFile | undefined, @CurrentUser() user: RequestUser) {
    return this.media.replaceDocument(id, file, actorOf(user));
  }
}

@Controller('qr')
export class QrController {
  constructor(
    private readonly assets: AssetsService,
    private readonly qr: QrService,
  ) {}

  /** Resolves a scanned QR token (spec §9). Signing in is required. */
  @RequirePermissions(P.ASSETS_VIEW)
  @Get('resolve/:token')
  resolve(@Param('token') token: string) {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) throw new AppError('ASSET_NOT_FOUND', 'رمز QR غير صالح.');
    return this.assets.byQrToken(token);
  }

  @RequirePermissions(P.QR_PRINT)
  @Post('labels')
  async labels(@Body() dto: LabelsDto, @CurrentUser() user: RequestUser, @Res({ passthrough: true }) res: Response) {
    const pdf = await this.qr.labelsPdf(dto.assetIds, dto.perPage ?? 24, actorOf(user));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="qr-labels.pdf"' });
    return new StreamableFile(pdf);
  }
}

/**
 * Serves stored files. Access is decided by what the file belongs to — a
 * file ID alone grants nothing.
 */
@Controller('files')
export class FilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
  ) {}

  @AnyAuthenticated()
  @Get(':id')
  async download(@Param('id', uuid) id: string, @CurrentUser() user: RequestUser, @Res({ passthrough: true }) res: Response) {
    if (!(await this.mayRead(id, user))) throw AppError.notFound('الملف غير موجود.');

    const { file, body } = await this.storage.read(id);
    const inline = /^(image\/(png|jpeg|webp)|application\/pdf)$/.test(file.mimeType);
    res.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(body.length),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      'Cache-Control': 'private, max-age=3600',
      // Defence in depth for any content the browser might try to interpret.
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    });
    return new StreamableFile(body);
  }

  /**
   * A file is readable if the user may see what it belongs to: the company
   * logo (anyone signed in), an asset photo or document, a maintenance photo,
   * or an operation's documents — including the parties to a custody or
   * return, who may lack general custody permissions.
   */
  private async mayRead(fileId: string, user: RequestUser): Promise<boolean> {
    const can = (p: (typeof P)[keyof typeof P]) => user.permissions.has(p);
    if ((await this.settings.get('company.logoFileId')) === fileId) return true;

    if (await this.prisma.assetPhoto.count({ where: { fileId } })) return can(P.ASSETS_VIEW);
    if (await this.prisma.maintenance.count({ where: { OR: [{ beforePhotoId: fileId }, { afterPhotoId: fileId }] } })) {
      return can(P.MAINTENANCE_VIEW);
    }
    const inventoryPhoto =
      (await this.prisma.inventoryItem.count({ where: { photoId: fileId } })) +
      (await this.prisma.inventoryUnregisteredAsset.count({ where: { photoId: fileId } }));
    if (inventoryPhoto) return can(P.INVENTORY_VIEW);

    const version = await this.prisma.documentVersion.findFirst({
      where: { fileId },
      select: {
        document: {
          select: {
            assetId: true,
            transferId: true,
            maintenanceId: true,
            saleId: true,
            inventoryId: true,
            custody: { select: { newResponsibleEmployeeId: true, newResponsibleExternalId: true } },
            custodyReturn: { select: { items: { select: { newResponsibleEmployeeId: true } } } },
          },
        },
      },
    });
    if (!version) return false;
    const d = version.document;
    if (d.assetId) return can(P.ASSETS_VIEW) && can(P.DOCUMENTS_VIEW);
    if (d.transferId) return can(P.TRANSFERS_VIEW);
    if (d.maintenanceId) return can(P.MAINTENANCE_VIEW);
    if (d.saleId) return can(P.SALES_VIEW);
    if (d.inventoryId) return can(P.INVENTORY_VIEW);
    if (d.custody) {
      const party = d.custody.newResponsibleEmployeeId
        ? d.custody.newResponsibleEmployeeId === user.employeeId
        : can(P.CUSTODY_CONFIRM_EXTERNAL);
      return can(P.CUSTODY_VIEW) || party;
    }
    if (d.custodyReturn) {
      return can(P.CUSTODY_VIEW) || d.custodyReturn.items.some((i) => i.newResponsibleEmployeeId === user.employeeId);
    }
    return false;
  }
}
