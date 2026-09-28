import { Body, Controller, Get, HttpCode, Module, Param, ParseEnumPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PERMISSIONS } from '@osooli/shared';
import { AnyAuthenticated, CurrentUser, RequirePermissions } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import type { RequestUser } from '../../common/request-user';
import { AccessModule } from '../access/access.module';
import { AssetsModule } from '../assets/assets.module';
import { InventoryModule } from '../inventory/inventory.module';
import type { UploadedFile as Upload } from '../storage/storage.service';
import { OFFLINE_OPERATIONS, type OfflineOperation, SyncService } from './sync.service';

/** Offline snapshot and queued-operation sync (spec §52–54). */
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @RequirePermissions(PERMISSIONS.ASSETS_VIEW)
  @Get('snapshot')
  snapshot(@CurrentUser() user: RequestUser) {
    return this.sync.snapshot(user);
  }

  @AnyAuthenticated()
  @Get('operations')
  recent(@CurrentUser() user: RequestUser) {
    return this.sync.recent(user);
  }

  /**
   * Submits one queued offline operation as multipart form fields (plus an
   * optional "photo"). Permissions are checked per operation type. Always 200
   * for processed operations: the body says SYNCED or NEEDS_REVIEW.
   */
  @AnyAuthenticated()
  @Post('operations/:type')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 101 * 1024 * 1024, files: 1 } }))
  submit(
    @Param('type', new ParseEnumPipe(Object.fromEntries(OFFLINE_OPERATIONS.map((o) => [o, o])))) type: OfflineOperation,
    @Body() body: Record<string, unknown>,
    @UploadedFile() photo: Upload | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    const { clientOperationId, clientCreatedAt, ...fields } = body;
    if (typeof clientOperationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(clientOperationId)) {
      throw AppError.validation({ clientOperationId: ['معرّف العملية غير صالح.'] });
    }
    const createdAt = typeof clientCreatedAt === 'string' ? new Date(clientCreatedAt) : new Date(NaN);
    if (Number.isNaN(createdAt.getTime())) throw AppError.validation({ clientCreatedAt: ['وقت العملية غير صالح.'] });
    return this.sync.submit(user, type, clientOperationId, createdAt, fields, photo);
  }
}

@Module({
  imports: [AccessModule, AssetsModule, InventoryModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
