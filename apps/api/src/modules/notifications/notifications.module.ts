import { Global, Module } from '@nestjs/common';
import { NotificationsController, NotificationTypesController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  controllers: [NotificationsController, NotificationTypesController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
