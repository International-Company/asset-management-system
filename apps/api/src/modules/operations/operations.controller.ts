import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { PERMISSIONS } from '@osooli/shared';
import { AnyAuthenticated, CurrentUser, RequirePermissions } from '../../common/decorators';
import { actorOf, RequestUser } from '../../common/request-user';
import type { UploadedFile as Upload } from '../storage/storage.service';
import { CustodyService } from './custody.service';
import { MaintenanceService } from './maintenance.service';
import {
  CompleteMaintenanceDto,
  CreateCustodyDto,
  CreateMaintenanceDto,
  CreateReturnDto,
  CreateSaleDto,
  CreateTransferDto,
  CustodyListQueryDto,
  MaintenanceListQueryDto,
  OperationDocumentDto,
  OperationListQueryDto,
  ReasonDto,
  StartMaintenanceDto,
  UpdateMaintenanceDto,
} from './operations.dto';
import { ReturnsService } from './returns.service';
import { SalesService } from './sales.service';
import { TransfersService } from './transfers.service';

const P = PERMISSIONS;
const uuid = new ParseUUIDPipe();
const MAX_UPLOAD = 101 * 1024 * 1024;

@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @RequirePermissions(P.TRANSFERS_VIEW)
  @Get()
  list(@Query() q: OperationListQueryDto) {
    return this.transfers.list(q);
  }

  @RequirePermissions(P.TRANSFERS_VIEW)
  @Get(':id')
  get(@Param('id', uuid) id: string) {
    return this.transfers.get(id);
  }

  @RequirePermissions(P.TRANSFERS_CREATE)
  @Post()
  create(@Body() dto: CreateTransferDto, @CurrentUser() user: RequestUser) {
    return this.transfers.create(dto, actorOf(user));
  }
}

@Controller('custodies')
export class CustodyController {
  constructor(private readonly custody: CustodyService) {}

  @RequirePermissions(P.CUSTODY_VIEW)
  @Get()
  list(@Query() q: CustodyListQueryDto) {
    return this.custody.list(q);
  }

  /** Records awaiting the signed-in user's confirmation (works without custody permissions). */
  @AnyAuthenticated()
  @Get('pending-for-me')
  pending(@CurrentUser() user: RequestUser) {
    return this.custody.pendingFor(user);
  }

  /** Access is decided in the service: custody viewers or the confirming party. */
  @AnyAuthenticated()
  @Get(':id')
  get(@Param('id', uuid) id: string, @CurrentUser() user: RequestUser) {
    return this.custody.get(id, user);
  }

  @RequirePermissions(P.CUSTODY_CREATE)
  @Post()
  create(@Body() dto: CreateCustodyDto, @CurrentUser() user: RequestUser) {
    return this.custody.create(dto, actorOf(user));
  }

  /** Only the new responsible (or an authorised user for an external person) may confirm — checked in the service. */
  @AnyAuthenticated()
  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@Param('id', uuid) id: string, @CurrentUser() user: RequestUser) {
    return this.custody.confirm(id, user);
  }

  @AnyAuthenticated()
  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id', uuid) id: string, @Body() dto: ReasonDto, @CurrentUser() user: RequestUser) {
    return this.custody.reject(id, dto.reason, user);
  }

  @RequirePermissions(P.CUSTODY_CANCEL)
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', uuid) id: string, @Body() dto: ReasonDto, @CurrentUser() user: RequestUser) {
    return this.custody.cancel(id, dto.reason, actorOf(user));
  }
}

@Controller('custody-returns')
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @RequirePermissions(P.CUSTODY_VIEW)
  @Get()
  list(@Query() q: OperationListQueryDto) {
    return this.returns.list(q);
  }

  @AnyAuthenticated()
  @Get(':id')
  get(@Param('id', uuid) id: string, @CurrentUser() user: RequestUser) {
    return this.returns.get(id, user);
  }

  @RequirePermissions(P.CUSTODY_RETURNS_CREATE)
  @Post()
  create(@Body() dto: CreateReturnDto, @CurrentUser() user: RequestUser) {
    return this.returns.create(dto, actorOf(user));
  }
}

@Controller('maintenances')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @RequirePermissions(P.MAINTENANCE_VIEW)
  @Get()
  list(@Query() q: MaintenanceListQueryDto) {
    return this.maintenance.list(q);
  }

  @RequirePermissions(P.MAINTENANCE_VIEW)
  @Get(':id')
  get(@Param('id', uuid) id: string) {
    return this.maintenance.get(id);
  }

  @RequirePermissions(P.MAINTENANCE_MANAGE)
  @Post()
  @UseInterceptors(FileInterceptor('beforePhoto', { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  create(@Body() dto: CreateMaintenanceDto, @UploadedFile() photo: Upload | undefined, @CurrentUser() user: RequestUser) {
    return this.maintenance.create(dto, photo, actorOf(user));
  }

  @RequirePermissions(P.MAINTENANCE_MANAGE)
  @Post(':id/start')
  @HttpCode(200)
  start(@Param('id', uuid) id: string, @Body() dto: StartMaintenanceDto, @CurrentUser() user: RequestUser) {
    return this.maintenance.start(id, dto, actorOf(user));
  }

  @RequirePermissions(P.MAINTENANCE_MANAGE)
  @Patch(':id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateMaintenanceDto, @CurrentUser() user: RequestUser) {
    return this.maintenance.update(id, dto, actorOf(user));
  }

  @RequirePermissions(P.MAINTENANCE_MANAGE)
  @Post(':id/complete')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('afterPhoto', { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  complete(@Param('id', uuid) id: string, @Body() dto: CompleteMaintenanceDto, @UploadedFile() photo: Upload | undefined, @CurrentUser() user: RequestUser) {
    return this.maintenance.complete(id, dto, photo, actorOf(user));
  }

  @RequirePermissions(P.MAINTENANCE_CLOSE)
  @Post(':id/close')
  @HttpCode(200)
  close(@Param('id', uuid) id: string, @CurrentUser() user: RequestUser) {
    return this.maintenance.close(id, actorOf(user));
  }

  @RequirePermissions(P.MAINTENANCE_MANAGE, P.DOCUMENTS_UPLOAD)
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  addDocument(@Param('id', uuid) id: string, @Body() dto: OperationDocumentDto, @UploadedFile() file: Upload | undefined, @CurrentUser() user: RequestUser) {
    return this.maintenance.addDocument(id, dto.name, file, actorOf(user));
  }
}

@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @RequirePermissions(P.SALES_VIEW)
  @Get()
  list(@Query() q: OperationListQueryDto) {
    return this.sales.list(q);
  }

  @RequirePermissions(P.SALES_VIEW)
  @Get(':id')
  get(@Param('id', uuid) id: string) {
    return this.sales.get(id);
  }

  @RequirePermissions(P.SALES_CREATE)
  @Post()
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: MAX_UPLOAD } }))
  create(@Body() dto: CreateSaleDto, @UploadedFiles() files: Upload[] | undefined, @CurrentUser() user: RequestUser) {
    return this.sales.create(dto, files ?? [], actorOf(user));
  }
}

/** Current custody panel on the asset page (spec §29). */
@Controller('assets')
export class AssetCustodyController {
  constructor(private readonly custody: CustodyService) {}

  @RequirePermissions(P.ASSETS_VIEW)
  @Get(':id/custody')
  current(@Param('id', uuid) id: string) {
    return this.custody.currentForAsset(id);
  }
}
