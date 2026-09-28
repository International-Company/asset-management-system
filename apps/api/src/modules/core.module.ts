import { Global, Module } from '@nestjs/common';
import { NumberingService } from './numbering/numbering.service';
import { SecurityLogService } from './security/security-log.service';
import { SettingsService } from './settings/settings.service';

/** Cross-cutting services used by most modules. */
@Global()
@Module({
  providers: [SettingsService, SecurityLogService, NumberingService],
  exports: [SettingsService, SecurityLogService, NumberingService],
})
export class CoreModule {}
