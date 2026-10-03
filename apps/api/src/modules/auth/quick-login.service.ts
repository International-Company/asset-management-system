import { createHmac, createPublicKey, randomBytes, scrypt as scryptCb, timingSafeEqual, verify } from 'node:crypto';
import { promisify } from 'node:util';
import { Inject, Injectable } from '@nestjs/common';
import { isWeakPin, QUICK_PIN_PATTERN } from '@osooli/shared';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AppError } from '../../common/errors/app-error';
import type { ClientInfo, RequestUser } from '../../common/request-user';
import { PrismaService } from '../../prisma/prisma.service';
import { SecurityLogService } from '../security/security-log.service';
import { AuthService } from './auth.service';
import { deviceName } from './fingerprint.service';
import { SessionService } from './session.service';

const scrypt = promisify(scryptCb) as (pin: string | Buffer, salt: Buffer, keylen: number) => Promise<Buffer>;

/** Wrong PINs before the device is revoked and a full sign-in is needed again. */
export const QUICK_LOGIN_MAX_ATTEMPTS = 5;
const CHALLENGE_TTL_MS = 2 * 60_000;
const MAX_DEVICES_PER_USER = 10;

/**
 * Quick sign-in with a 4-digit PIN (decided by the user on 2026-10-03, in place
 * of the spec's password + fingerprint for returning users).
 *
 * A PIN alone is weak (10,000 values), so it only works together with the
 * device it was set on: that device holds a non-extractable ECDSA key and must
 * sign a fresh, single-use challenge. Five wrong PINs revoke the device. The
 * PIN is stored as scrypt(HMAC(server key, PIN)), so a database copy alone does
 * not allow guessing it offline.
 */
@Injectable()
export class QuickLoginService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly securityLog: SecurityLogService,
    private readonly auth: AuthService,
  ) {}

  /** Set up quick sign-in on the current device (after a full sign-in). */
  async enable(user: RequestUser, publicKeyB64: string, pin: string, client: ClientInfo) {
    this.assertPin(pin);
    const publicKey = this.parsePublicKey(publicKeyB64);
    const active = await this.prisma.quickLoginDevice.count({ where: { userId: user.id, revokedAt: null } });
    if (active >= MAX_DEVICES_PER_USER) throw AppError.invalidState('بلغت الحد الأقصى للأجهزة. احذف جهازًا قديمًا أولًا.');
    return this.prisma.transaction(async (tx) => {
      const device = await tx.quickLoginDevice.create({
        data: { userId: user.id, publicKey: new Uint8Array(publicKey), pinHash: await this.hashPin(pin), deviceName: deviceName(client.userAgent) },
      });
      await this.securityLog.record({ type: 'QUICK_LOGIN_ENABLED', userId: user.id, username: user.username, actorId: user.id, client, details: { deviceId: device.id, device: device.deviceName } }, tx);
      return { deviceId: device.id };
    });
  }

  /** A single-use challenge for the device to sign. Unknown or revoked devices get one too (no probing). */
  async challenge(deviceId: string) {
    const nonce = randomBytes(32).toString('base64url');
    const row = await this.prisma.loginChallenge.create({
      data: { username: '', step: 'QUICK', providerRef: deviceId, webauthnChallenge: nonce, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
    });
    return { challengeId: row.id, challenge: nonce };
  }

  /** Signs in with the device's signature and the PIN. */
  async login(deviceId: string, challengeId: string, signatureB64: string, pin: string, client: ClientInfo) {
    const challenge = await this.prisma.loginChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge || challenge.step !== 'QUICK' || challenge.providerRef !== deviceId || challenge.consumedAt || challenge.expiresAt < new Date() || !challenge.webauthnChallenge) {
      throw new AppError('SESSION_EXPIRED', 'انتهت صلاحية محاولة الدخول. يرجى المحاولة من جديد.');
    }
    // Single use, whatever happens next.
    const consumed = await this.prisma.loginChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count === 0) throw new AppError('SESSION_EXPIRED');

    const device = await this.prisma.quickLoginDevice.findUnique({
      where: { id: deviceId },
      include: { user: { include: { employee: true } } },
    });
    if (!device || device.revokedAt) throw this.notSetUp();
    const user = device.user;

    // The device must prove it holds its key; a stolen PIN is useless elsewhere.
    if (!this.signatureValid(device.publicKey, challenge.webauthnChallenge, signatureB64)) {
      await this.securityLog.record({ type: 'LOGIN_FAILED', userId: user.id, username: user.username, client, details: { reason: 'quick_bad_device_signature', deviceId } });
      throw this.notSetUp();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) throw new AppError('ACCOUNT_LOCKED');

    if (!(await this.pinMatches(pin, device.pinHash))) {
      const attempts = device.failedAttempts + 1;
      const revoke = attempts >= QUICK_LOGIN_MAX_ATTEMPTS;
      await this.prisma.quickLoginDevice.update({
        where: { id: device.id },
        data: { failedAttempts: Math.min(attempts, QUICK_LOGIN_MAX_ATTEMPTS), ...(revoke ? { revokedAt: new Date(), revokedReason: 'too_many_attempts' } : {}) },
      });
      await this.securityLog.record({ type: 'LOGIN_FAILED', userId: user.id, username: user.username, client, details: { reason: 'quick_wrong_pin', deviceId, attempts } });
      if (revoke) {
        await this.securityLog.record({ type: 'QUICK_LOGIN_REVOKED', userId: user.id, username: user.username, client, details: { deviceId, reason: 'too_many_attempts' } });
        throw new AppError('INVALID_STATE', 'أُدخل الرمز خطأً 5 مرات، فأُلغي الدخول السريع على هذا الجهاز. ادخل باسم المستخدم وكلمة المرور، ثم فعّله من جديد.');
      }
      const left = QUICK_LOGIN_MAX_ATTEMPTS - attempts;
      throw new AppError('INVALID_CREDENTIALS', `الرمز غير صحيح. ${left === 1 ? 'بقيت محاولة واحدة' : `بقيت ${left} محاولات`} قبل إلغاء الدخول السريع على هذا الجهاز.`);
    }

    // Still allowed in? The EAP record is refreshed first (cached status if EAP is unreachable).
    await this.auth.refreshEmployee(user.employee.id, user.employee.eapEmployeeId);
    const employee = await this.prisma.employee.findUniqueOrThrow({ where: { id: user.employee.id } });
    if (!user.isActive || !employee.isActive) {
      await this.securityLog.record({ type: 'LOGIN_FAILED', userId: user.id, username: user.username, client, details: { reason: 'no_system_access', method: 'quick' } });
      throw new AppError('FORBIDDEN', 'لا يملك هذا الحساب صلاحية الدخول إلى نظام الأصول.');
    }

    return this.prisma.transaction(async (tx) => {
      await tx.quickLoginDevice.update({ where: { id: device.id }, data: { failedAttempts: 0, lastUsedAt: new Date() } });
      await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lastLoginAt: new Date() } });
      const session = await this.sessions.create(user.id, client, tx);
      await this.securityLog.record({ type: 'LOGIN_SUCCESS', userId: user.id, username: user.username, sessionId: session.sessionId, client, details: { method: 'quick_pin', deviceId } }, tx);
      return session;
    });
  }

  list(userId: string) {
    return this.prisma.quickLoginDevice.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, deviceName: true, createdAt: true, lastUsedAt: true },
    });
  }

  async revoke(user: RequestUser, deviceId: string, client: ClientInfo) {
    const device = await this.prisma.quickLoginDevice.findFirst({ where: { id: deviceId, userId: user.id, revokedAt: null } });
    if (!device) throw AppError.notFound('الجهاز غير موجود.');
    await this.prisma.transaction(async (tx) => {
      await tx.quickLoginDevice.update({ where: { id: device.id }, data: { revokedAt: new Date(), revokedReason: 'by_user' } });
      await this.securityLog.record({ type: 'QUICK_LOGIN_REVOKED', userId: user.id, username: user.username, actorId: user.id, client, details: { deviceId, reason: 'by_user' } }, tx);
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private notSetUp() {
    return new AppError('INVALID_STATE', 'الدخول السريع غير مفعّل على هذا الجهاز. ادخل باسم المستخدم وكلمة المرور.');
  }

  private assertPin(pin: string) {
    if (!QUICK_PIN_PATTERN.test(pin)) throw AppError.validation({ pin: ['الرمز أربعة أرقام.'] });
    if (isWeakPin(pin)) throw AppError.validation({ pin: ['اختر رمزًا أصعب: لا أرقام متكررة ولا متسلسلة مثل 1234.'] });
  }

  private parsePublicKey(b64: string): Buffer {
    try {
      const der = Buffer.from(b64, 'base64');
      const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('curve');
      return der;
    } catch {
      throw AppError.validation({ publicKey: ['مفتاح الجهاز غير صالح.'] });
    }
  }

  /** WebCrypto ECDSA signatures are raw r||s (IEEE P1363), over the challenge text. */
  private signatureValid(publicKey: Uint8Array, challenge: string, signatureB64: string): boolean {
    try {
      const key = createPublicKey({ key: Buffer.from(publicKey), format: 'der', type: 'spki' });
      return verify('sha256', Buffer.from(challenge, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signatureB64, 'base64'));
    } catch {
      return false;
    }
  }

  private pepper(pin: string): Buffer {
    return createHmac('sha256', this.env.ENCRYPTION_KEY).update(`quick-pin:${pin}`).digest();
  }

  private async hashPin(pin: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = await scrypt(this.pepper(pin), salt, 32);
    return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
  }

  private async pinMatches(pin: string, stored: string): Promise<boolean> {
    const [scheme, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt' || !saltB64 || !hashB64 || !QUICK_PIN_PATTERN.test(pin)) return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scrypt(this.pepper(pin), Buffer.from(saltB64, 'base64'), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
