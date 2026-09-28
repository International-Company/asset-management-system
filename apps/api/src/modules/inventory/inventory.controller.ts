import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PERMISSIONS } from '@osooli/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { actorOf, RequestUser } from '../../common/request-user';
import type { UploadedFile as Upload } from '../storage/storage.service';
import { AddItemDto, CheckItemDto, CreateInventoryDto, InventoryItemsQueryDto, InventoryListQueryDto, ReopenDto, ScanDto, UnregisteredDto } from './inventory.dto';
import { InventoryService } from './inventory.service';

const P = PERMISSIONS;
const uuid = new ParseUUIDPipe();
const photo = FileInterceptor('photo', { limits: { fileSize: 101 * 1024 * 1024, files: 1 } });

@Controller('inventories')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @RequirePermissions(P.INVENTORY_VIEW)
  @Get()
  list(@Query() q: InventoryListQueryDto) {
    return this.inventory.list(q);
  }

  @RequirePermissions(P.INVENTORY_MANAGE)
  @Post()
  create(@Body() dto: CreateInventoryDto, @CurrentUser() user: RequestUser) {
    return this.inventory.create(dto, actorOf(user));
  }

  @RequirePermissions(P.INVENTORY_VIEW)
  @Get(':id')
  get(@Param('id', uuid) id: string) {
    return this.inventory.get(id);
  }

  @RequirePermissions(P.INVENTORY_VIEW)
  @Get(':id/items')
  items(@Param('id', uuid) id: string, @Query() q: InventoryItemsQueryDto) {
    return this.inventory.items(id, q);
  }

  @RequirePermissions(P.INVENTORY_MANAGE)
  @Post(':id/scan')
  @HttpCode(200)
  scan(@Param('id', uuid) id: string, @Body() dto: ScanDto) {
    return this.inventory.scan(id, dto.code);
  }

  @RequirePermissions(P.INVENTORY_MANAGE)
  @Post(':id/items')
  addItem(@Param('id', uuid) id: string, @Body() dto: AddItemDto, @CurrentUser() user: RequestUser) {
    return this.inventory.addItem(id, dto, actorOf(user));
  }

  @RequirePermissions(P.INVENTORY_MANAGE)
  @Post(':id/items/:itemId/check')
  @HttpCode(200)
  @UseInterceptors(photo)
  check(
    @Param('id', uuid) id: string,
    @Param('itemId', uuid) itemId: string,
    @Body() dto: CheckItemDto,
    @UploadedFile() file: Upload | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.inventory.check(id, itemId, dto, file, actorOf(user));
  }

  @RequirePermissions(P.INVENTORY_MANAGE)
  @Post(':id/unregistered')
  @UseInterceptors(photo)
  unregistered(@Param('id', uuid) id: string, @Body() dto: UnregisteredDto, @UploadedFile() file: Upload | undefined, @CurrentUser() user: RequestUser) {
    return this.inventory.addUnregistered(id, dto, file, actorOf(user));
  }

  @RequirePermissions(P.INVENTORY_MANAGE)
  @Post(':id/close')
  @HttpCode(200)
  close(@Param('id', uuid) id: string, @CurrentUser() user: RequestUser) {
    return this.inventory.close(id, actorOf(user));
  }

  /** Exceptional reopening of a closed inventory (System Administrator, spec §34). */
  @RequirePermissions(P.INVENTORY_REOPEN)
  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@Param('id', uuid) id: string, @Body() dto: ReopenDto, @CurrentUser() user: RequestUser) {
    return this.inventory.reopen(id, dto.reason, actorOf(user));
  }
}
