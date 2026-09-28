import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AssetsModule } from '../assets/assets.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [AccessModule, AssetsModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
