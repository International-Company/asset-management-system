import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { ENV } from '../../config/config.module';
import { type Env, fingerprintMode } from '../../config/env';
import { AppError } from '../../common/errors/app-error';
import type { ClientInfo } from '../../common/request-user';
import { PrismaService } from '../../prisma/prisma.service';
import { SecurityLogService } from '../security/security-log.service';

/**
 * What the browser does for the fingerprint step (spec §47).
 * - `passkey`: the device checks the fingerprint (it never leaves the device)
 *   and signs this system's challenge with a passkey registered here.
 * - `passkey-register`: first sign-in (or after an administrator reset): the
 *   device creates that passkey now, after the password was verified.
 * - `code`: development stand-in.
 */
export type FingerprintOptions =
  | { type: 'passkey'; options: PublicKeyCredentialRequestOptionsJSON }
  | { type: 'passkey-register'; options: PublicKeyCredentialCreationOptionsJSON }
  | { type: 'code' };

interface Account {
  id: string;
  username: string;
  fullName: string;
}

const ADD_CHALLENGE_TTL_MS = 5 * 60_000;
/** A device link code works for 10 minutes, once, and dies after 5 wrong tries. */
export const LINK_CODE_TTL_MS = 10 * 60_000;
const LINK_CODE_MAX_ATTEMPTS = 5;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** "Windows · Chrome" from a user agent: a hint for the account page, nothing more. */
export function deviceName(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const os = /Windows/.test(userAgent) ? 'Windows' : /iPhone|iPad/.test(userAgent) ? 'iOS' : /Android/.test(userAgent) ? 'Android' : /Mac OS X/.test(userAgent) ? 'macOS' : /Linux/.test(userAgent) ? 'Linux' : null;
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Chrome\//.test(userAgent) ? 'Chrome' : /Firefox\//.test(userAgent) ? 'Firefox' : /Safari\//.test(userAgent) ? 'Safari' : null;
  return [os, browser].filter(Boolean).join(' · ') || null;
}

/**
 * The fingerprint step and the passkeys behind it. Passkeys are registered in
 * the Asset System itself, for its own domain (a passkey only works on the
 * domain it was created for). Only public keys are stored.
 */
@Injectable()
export class FingerprintService {
  private readonly logger = new Logger(FingerprintService.name);
  private readonly mode: 'code' | 'passkey';
  private readonly origin: string;
  private readonly rpID: string;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly securityLog: SecurityLogService,
  ) {
    this.mode = fingerprintMode(env);
    this.origin = env.WEB_ORIGIN.replace(/\/+$/, '');
    this.rpID = new URL(this.origin).hostname;
  }

  // ── Sign-in (step 3) ──────────────────────────────────────────────────

  /** Issued after the password step, bound to that sign-in attempt. */
  async options(challengeId: string, user: Account): Promise<FingerprintOptions> {
    if (this.mode === 'code') return { type: 'code' };
    const passkeys = await this.active(user.id);
    let result: FingerprintOptions;
    if (passkeys.length === 0) {
      result = { type: 'passkey-register', options: await this.registrationOptions(user, []) };
    } else {
      result = {
        type: 'passkey',
        options: await generateAuthenticationOptions({
          rpID: this.rpID,
          allowCredentials: passkeys.map((p) => ({ id: p.credentialId, transports: p.transports })),
          userVerification: 'required',
        }),
      };
    }
    await this.prisma.loginChallenge.update({ where: { id: challengeId }, data: { webauthnChallenge: result.options.challenge } });
    return result;
  }

  /** Verifies the fingerprint step. A first-time registration also counts as the fingerprint. */
  async verify(challenge: { step: string; webauthnChallenge: string | null }, user: Account, assertion: string, client: ClientInfo): Promise<boolean> {
    if (this.mode === 'code') return safeEqual(assertion, this.env.MOCK_AUTH_FINGERPRINT ?? '');
    if (!challenge.webauthnChallenge) return false;
    const response = this.parse(assertion);
    if (!response) return false;

    if ('attestationObject' in (response.response as object)) {
      // Registering at sign-in is allowed only while the account has no passkey
      // (first sign-in, or after an administrator reset), or after a device link
      // code from a signed-in device was accepted for this attempt.
      if (challenge.step !== 'FINGERPRINT_LINK' && (await this.active(user.id)).length > 0) return false;
      return this.register(user, response as RegistrationResponseJSON, challenge.webauthnChallenge, client);
    }
    return this.authenticate(user, response as AuthenticationResponseJSON, challenge.webauthnChallenge);
  }

  // ── Linking a new device with a code from a signed-in one ─────────────

  /** Shown on a signed-in device. A new code replaces any earlier unused one. */
  async createLinkCode(user: Account & { sessionId?: string }, client: ClientInfo) {
    this.requirePasskeys();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    await this.prisma.transaction(async (tx) => {
      await tx.deviceLinkCode.updateMany({ where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { expiresAt: new Date() } });
      await tx.deviceLinkCode.create({ data: { userId: user.id, codeHash: this.linkHash(user.id, code), expiresAt } });
      await this.securityLog.record({ type: 'DEVICE_LINK_CODE_CREATED', userId: user.id, username: user.username, actorId: user.id, sessionId: user.sessionId, client, details: { expiresAt } }, tx);
    });
    return { code, expiresAt };
  }

  /** Spends the user's current link code. A wrong code counts against it. */
  async useLinkCode(userId: string, code: string): Promise<boolean> {
    if (this.mode !== 'passkey') return false;
    const row = await this.prisma.deviceLinkCode.findFirst({
      where: { userId, usedAt: null, expiresAt: { gt: new Date() }, failedAttempts: { lt: LINK_CODE_MAX_ATTEMPTS } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return false;
    if (!/^\d{6}$/.test(code) || !safeEqual(this.linkHash(userId, code), row.codeHash)) {
      const attempts = row.failedAttempts + 1;
      await this.prisma.deviceLinkCode.update({
        where: { id: row.id },
        data: { failedAttempts: attempts, ...(attempts >= LINK_CODE_MAX_ATTEMPTS ? { expiresAt: new Date() } : {}) },
      });
      return false;
    }
    const used = await this.prisma.deviceLinkCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    return used.count === 1;
  }

  /** After a valid link code: this sign-in attempt may register the new device's passkey. */
  async linkOptions(challengeId: string, user: Account): Promise<FingerprintOptions> {
    const options = await this.registrationOptions(user, await this.active(user.id));
    const moved = await this.prisma.loginChallenge.updateMany({
      where: { id: challengeId, step: 'FINGERPRINT', consumedAt: null },
      data: { step: 'FINGERPRINT_LINK', webauthnChallenge: options.challenge },
    });
    if (moved.count === 0) throw new AppError('SESSION_EXPIRED');
    return { type: 'passkey-register', options };
  }

  // ── Account page ──────────────────────────────────────────────────────

  async list(userId: string) {
    const rows = await this.prisma.userPasskey.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, deviceName: true, createdAt: true, lastUsedAt: true },
    });
    return rows;
  }

  /** Adding a passkey while signed in (another device). */
  async beginAdd(user: Account) {
    this.requirePasskeys();
    const existing = await this.active(user.id);
    const options = await this.registrationOptions(user, existing);
    const row = await this.prisma.loginChallenge.create({
      data: { username: user.username, step: 'PASSKEY_ADD', webauthnChallenge: options.challenge, expiresAt: new Date(Date.now() + ADD_CHALLENGE_TTL_MS) },
    });
    return { challengeId: row.id, options };
  }

  async finishAdd(user: Account, challengeId: string, credential: unknown, client: ClientInfo) {
    this.requirePasskeys();
    const row = await this.prisma.loginChallenge.findUnique({ where: { id: challengeId } });
    if (!row || row.step !== 'PASSKEY_ADD' || row.username !== user.username || row.consumedAt || row.expiresAt < new Date() || !row.webauthnChallenge) {
      throw new AppError('SESSION_EXPIRED', 'انتهت مهلة تسجيل البصمة. يرجى المحاولة من جديد.');
    }
    const consumed = await this.prisma.loginChallenge.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count === 0) throw new AppError('SESSION_EXPIRED');
    const response = this.parse(JSON.stringify(credential));
    if (!response || !('attestationObject' in (response.response as object))) throw new AppError('FINGERPRINT_FAILED');
    const ok = await this.register(user, response as RegistrationResponseJSON, row.webauthnChallenge, client);
    if (!ok) throw new AppError('FINGERPRINT_FAILED', 'تعذر تسجيل البصمة على هذا الجهاز.');
    return this.list(user.id);
  }

  /** A user removes one of their own passkeys; the last one cannot be removed. */
  async revokeOwn(user: Account, passkeyId: string, client: ClientInfo) {
    return this.prisma.transaction(async (tx) => {
      const passkeys = await tx.userPasskey.findMany({ where: { userId: user.id, revokedAt: null } });
      const target = passkeys.find((p) => p.id === passkeyId);
      if (!target) throw AppError.notFound('البصمة غير موجودة.');
      if (passkeys.length === 1) throw AppError.invalidState('لا يمكن حذف آخر بصمة. أضف بصمة من جهاز آخر أولًا.');
      await tx.userPasskey.update({ where: { id: target.id }, data: { revokedAt: new Date(), revokedById: user.id } });
      await this.securityLog.record({ type: 'PASSKEY_REVOKED', userId: user.id, username: user.username, actorId: user.id, client, details: { passkeyId: target.id, device: target.deviceName } }, tx);
      return true;
    });
  }

  countActive(userId: string): Promise<number> {
    return this.prisma.userPasskey.count({ where: { userId, revokedAt: null } });
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private requirePasskeys(): void {
    if (this.mode !== 'passkey') throw AppError.invalidState('البصمة عبر مفاتيح المرور غير مفعّلة في هذه البيئة.');
  }

  private linkHash(userId: string, code: string): string {
    return createHmac('sha256', this.env.ENCRYPTION_KEY).update(`device-link:${userId}:${code}`).digest('hex');
  }

  private active(userId: string) {
    return this.prisma.userPasskey.findMany({ where: { userId, revokedAt: null } });
  }

  private registrationOptions(user: Account, existing: Array<{ credentialId: string; transports: string[] }>) {
    return generateRegistrationOptions({
      rpName: 'نظام إدارة الأصول',
      rpID: this.rpID,
      userName: user.username,
      userID: new TextEncoder().encode(user.id),
      userDisplayName: user.fullName,
      attestationType: 'none',
      excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
      // A fingerprint (or the device's equivalent) is required, not just a tap.
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    });
  }

  private parse(assertion: string): (RegistrationResponseJSON | AuthenticationResponseJSON) | null {
    try {
      const value = JSON.parse(assertion) as { id?: unknown; rawId?: unknown; type?: unknown; response?: unknown };
      if (typeof value.id !== 'string' || typeof value.rawId !== 'string' || value.type !== 'public-key' || typeof value.response !== 'object' || !value.response) return null;
      return value as RegistrationResponseJSON | AuthenticationResponseJSON;
    } catch {
      return null;
    }
  }

  private async register(user: Account, response: RegistrationResponseJSON, expectedChallenge: string, client: ClientInfo): Promise<boolean> {
    let verification;
    try {
      verification = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: this.origin, expectedRPID: this.rpID, requireUserVerification: true });
    } catch (e) {
      this.logger.warn({ err: (e as Error).message, userId: user.id }, 'Passkey registration rejected');
      return false;
    }
    if (!verification.verified || !verification.registrationInfo) return false;
    const { credential } = verification.registrationInfo;
    try {
      await this.prisma.transaction(async (tx) => {
        const passkey = await tx.userPasskey.create({
          data: {
            userId: user.id,
            credentialId: credential.id,
            publicKey: Buffer.from(credential.publicKey),
            counter: BigInt(credential.counter),
            transports: credential.transports ?? [],
            deviceName: deviceName(client.userAgent),
          },
        });
        await this.securityLog.record({ type: 'PASSKEY_REGISTERED', userId: user.id, username: user.username, actorId: user.id, client, details: { passkeyId: passkey.id, device: passkey.deviceName } }, tx);
      });
    } catch (e) {
      // The same credential registered twice (unique credential id).
      this.logger.warn({ err: (e as Error).message, userId: user.id }, 'Passkey could not be stored');
      return false;
    }
    return true;
  }

  private async authenticate(user: Account, response: AuthenticationResponseJSON, expectedChallenge: string): Promise<boolean> {
    const passkey = await this.prisma.userPasskey.findUnique({ where: { credentialId: response.id } });
    // Another person's passkey, or a revoked one, is not this person's fingerprint.
    if (!passkey || passkey.userId !== user.id || passkey.revokedAt) return false;
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        credential: { id: passkey.credentialId, publicKey: new Uint8Array(passkey.publicKey), counter: Number(passkey.counter), transports: passkey.transports },
        requireUserVerification: true,
      });
    } catch (e) {
      this.logger.warn({ err: (e as Error).message, userId: user.id }, 'Passkey sign-in rejected');
      return false;
    }
    if (!verification.verified) return false;
    await this.prisma.userPasskey.update({
      where: { id: passkey.id },
      data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
    });
    return true;
  }
}
