import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AssetMediaService } from './asset-media.service';
import { AssetsController, DocumentsController, FilesController, QrController } from './assets.controller';
import { AssetsService } from './assets.service';
import { QrService } from './qr.service';

@Module({
  imports: [AccessModule],
  controllers: [AssetsController, DocumentsController, QrController, FilesController],
  providers: [AssetsService, AssetMediaService, QrService],
  exports: [AssetsService, AssetMediaService, QrService],
})
export class AssetsModule {}
