import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AssetsModule } from '../assets/assets.module';
import { CustodyService } from './custody.service';
import { MaintenanceService } from './maintenance.service';
import { AssetCustodyController, CustodyController, MaintenanceController, ReturnsController, SalesController, TransfersController } from './operations.controller';
import { ReturnsService } from './returns.service';
import { SalesService } from './sales.service';
import { TransfersService } from './transfers.service';

@Module({
  imports: [AccessModule, AssetsModule],
  controllers: [AssetCustodyController, TransfersController, CustodyController, ReturnsController, MaintenanceController, SalesController],
  providers: [TransfersService, CustodyService, ReturnsService, MaintenanceService, SalesService],
  exports: [CustodyService],
})
export class OperationsModule {}
