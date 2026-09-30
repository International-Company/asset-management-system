import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ENV } from '../../config/config.module';
import { type Env, fingerprintMode } from '../../config/env';
import { AnyAuthenticated, CurrentUser, Public } from '../../common/decorators';
import { clientInfo, RequestUser } from '../../common/request-user';
import { SettingsService } from '../settings/settings.service';
import { AuthService } from './auth.service';
import { AddPasskeyDto, LoginFingerprintDto, LoginPasswordDto, LoginStartDto } from './auth.dto';
import { FingerprintService } from './fingerprint.service';
import { SESSION_COOKIE } from './guards';
import { SessionService } from './session.service';

const LOGIN_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly settings: SettingsService,
    private readonly fingerprints: FingerprintService,
  ) {}

  /** What the login screen needs before sign-in: provider type and company name. */
  @Public()
  @Get('config')
  async config() {
    const company = await this.settings.getMany(['company.nameAr', 'company.nameEn']);
    return {
      authProvider: this.env.AUTH_PROVIDER,
      company: { nameAr: company['company.nameAr'], nameEn: company['company.nameEn'] },
    };
  }

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('login/start')
  @HttpCode(200)
  start(@Body() dto: LoginStartDto, @Req() req: Request) {
    return this.auth.start(dto.username, clientInfo(req));
  }

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('login/password')
  @HttpCode(200)
  password(@Body() dto: LoginPasswordDto, @Req() req: Request) {
    return this.auth.verifyPassword(dto.challengeId, dto.password, clientInfo(req));
  }

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('login/fingerprint')
  @HttpCode(200)
  async fingerprint(@Body() dto: LoginFingerprintDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.verifyFingerprint(dto.challengeId, dto.assertion, clientInfo(req));
    res.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: this.env.APP_ENV === 'staging' || this.env.APP_ENV === 'production',
      sameSite: 'strict',
      path: '/api',
      expires: session.expiresAt,
    });
    return { ok: true };
  }

  @AnyAuthenticated()
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: RequestUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.sessions.end(user.sessionId, 'LOGGED_OUT', user.id, clientInfo(req));
    res.clearCookie(SESSION_COOKIE, { path: '/api' });
    return { ok: true };
  }

  /** Current user, effective permissions and company identity for the UI shell. */
  @AnyAuthenticated()
  @Get('me')
  async me(@CurrentUser() user: RequestUser) {
    const company = await this.settings.getMany(['company.nameAr', 'company.nameEn', 'company.logoFileId']);
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      roles: user.roleKeys,
      permissions: [...user.permissions].sort(),
      authProvider: this.env.AUTH_PROVIDER,
      fingerprintMode: fingerprintMode(this.env),
      company: { nameAr: company['company.nameAr'], nameEn: company['company.nameEn'], logoFileId: company['company.logoFileId'] },
    };
  }

  // ── My fingerprints (passkeys registered in this system) ──────────────

  @AnyAuthenticated()
  @Get('passkeys')
  passkeys(@CurrentUser() user: RequestUser) {
    return this.fingerprints.list(user.id);
  }

  /** Step 1 of adding a fingerprint from another device. */
  @AnyAuthenticated()
  @Post('passkeys/options')
  @HttpCode(200)
  addPasskeyOptions(@CurrentUser() user: RequestUser) {
    return this.fingerprints.beginAdd({ id: user.id, username: user.username, fullName: user.fullName });
  }

  @AnyAuthenticated()
  @Post('passkeys')
  addPasskey(@CurrentUser() user: RequestUser, @Body() dto: AddPasskeyDto, @Req() req: Request) {
    return this.fingerprints.finishAdd({ id: user.id, username: user.username, fullName: user.fullName }, dto.challengeId, dto.credential, clientInfo(req));
  }

  @AnyAuthenticated()
  @Delete('passkeys/:id')
  @HttpCode(204)
  async removePasskey(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.fingerprints.revokeOwn({ id: user.id, username: user.username, fullName: user.fullName }, id, clientInfo(req));
  }
}
