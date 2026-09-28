import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';

/** HTTP surface for settings. SettingsService itself is provided globally by CoreModule. */
@Module({ controllers: [SettingsController] })
export class SettingsModule {}
