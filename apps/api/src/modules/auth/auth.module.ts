import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { FingerprintService } from './fingerprint.service';
import { AuthGuard, PermissionsGuard } from './guards';
import { QuickLoginService } from './quick-login.service';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    FingerprintService,
    QuickLoginService,
    SessionService,
    // Order matters: authenticate first, then authorize.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [SessionService, FingerprintService],
})
export class AuthModule {}
