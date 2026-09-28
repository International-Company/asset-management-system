import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AppConfigModule } from './config/config.module';
import { validateEnv } from './config/env';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { PrismaModule } from './prisma/prisma.module';
import { AccessModule } from './modules/access/access.module';
import { AssetsModule } from './modules/assets/assets.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BootstrapService } from './modules/bootstrap/bootstrap.service';
import { InitialAdminService } from './modules/bootstrap/initial-admin.service';
import { CoreModule } from './modules/core.module';
import { EapModule } from './modules/eap/eap.module';
import { HealthController } from './modules/health/health.controller';
import { LogsController } from './modules/logs/logs.controller';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ReportsModule } from './modules/reports/reports.controller';
import { SavedSearchesModule } from './modules/saved-searches/saved-searches';
import { SyncModule } from './modules/sync/sync.controller';
import { OperationsModule } from './modules/operations/operations.module';
import { PdfModule } from './modules/pdf/pdf.module';
import { ReferenceModule } from './modules/reference/reference.module';
import { SecurityModule } from './modules/security/security.module';
import { SettingsModule } from './modules/settings/settings.module';
import { StorageModule } from './modules/storage/storage.module';

const env = validateEnv(process.env);

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
        // Never log credentials, cookies or session tokens (spec §48, §75).
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            '*.password',
            '*.assertion',
            '*.token',
            '*.secret',
          ],
          censor: '[REDACTED]',
        },
        transport: env.APP_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
        autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      },
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
      // Automated tests log in many times from one address; account lockout
      // (tested separately) still applies.
      skipIf: () => env.APP_ENV === 'test',
    }),
    ScheduleModule.forRoot(),
    AppConfigModule,
    PrismaModule,
    AuditModule,
    CoreModule,
    EapModule,
    StorageModule,
    AuthModule,
    SecurityModule,
    NotificationsModule,
    AccessModule,
    ReferenceModule,
    SettingsModule,
    PdfModule,
    AssetsModule,
    OperationsModule,
    InventoryModule,
    SavedSearchesModule,
    ReportsModule,
    SyncModule,
  ],
  controllers: [HealthController, LogsController],
  providers: [
    BootstrapService,
    InitialAdminService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
