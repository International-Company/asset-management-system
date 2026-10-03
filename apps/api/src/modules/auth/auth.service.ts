import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { ClientInfo } from '../../common/request-user';
import { SettingsService } from '../settings/settings.service';
import { SecurityLogService } from '../security/security-log.service';
import { EAP_PROVIDER, EapProvider } from '../eap/eap.types';
import { FingerprintService, type FingerprintOptions } from './fingerprint.service';
import { SessionService } from './session.service';

const CHALLENGE_TTL_MS = 5 * 60_000;

type Step = 'PASSWORD' | 'FINGERPRINT' | 'FINGERPRINT_LINK';

/**
 * Login flow (spec §47): username → password → fingerprint → session.
 * The password is verified by EAP; the fingerprint by a passkey registered in
 * this system (FingerprintService). Nothing secret is stored or logged here.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly settings: SettingsService,
    private readonly securityLog: SecurityLogService,
    @Inject(EAP_PROVIDER) private readonly eap: EapProvider,
    private readonly fingerprint: FingerprintService,
  ) {}

  /** Step 1. Always succeeds so the response does not reveal whether the username exists. */
  async start(username: string, client: ClientInfo): Promise<{ challengeId: string; next: 'password' }> {
    const challenge = await this.prisma.loginChallenge.create({
      data: {
        username: username.trim().toLowerCase(),
        step: 'PASSWORD',
        ip: client.ip,
        userAgent: client.userAgent,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
    });
    return { challengeId: challenge.id, next: 'password' };
  }

  /** Step 2. */
  async verifyPassword(challengeId: string, password: string, client: ClientInfo): Promise<{ next: 'fingerprint'; fingerprint: FingerprintOptions }> {
    const challenge = await this.loadChallenge(challengeId, 'PASSWORD');
    const user = await this.prisma.user.findUnique({ where: { username: challenge.username } });
    await this.assertNotLocked(user, challenge.username, client);

    const result = await this.eap.verifyPassword(challenge.username, password);
    if (!result.ok) {
      if (result.reason === 'password_change_required') {
        // The password was right; EAP wants it changed before any sign-in.
        throw new AppError('INVALID_STATE', 'يجب تغيير كلمة المرور في نظام EAP أولًا، ثم تسجيل الدخول من جديد.');
      }
      await this.registerFailure(user, challenge.username, client, 'invalid_password');
      throw new AppError('INVALID_CREDENTIALS');
    }

    // EAP accepted the credentials, but the person must also hold an active
    // account in the Asset System, linked to the same employee.
    const employee = user
      ? await this.prisma.employee.findUnique({ where: { id: user.employeeId } })
      : null;
    if (!user || !user.isActive || employee?.eapEmployeeId !== result.eapEmployeeId) {
      await this.securityLog.record({
        type: 'LOGIN_FAILED',
        userId: user?.id ?? null,
        username: challenge.username,
        client,
        details: { reason: 'no_system_access' },
      });
      throw new AppError('FORBIDDEN', 'لا يملك هذا الحساب صلاحية الدخول إلى نظام الأصول.');
    }

    const advanced = await this.prisma.loginChallenge.updateMany({
      where: { id: challenge.id, step: 'PASSWORD', consumedAt: null },
      data: { step: 'FINGERPRINT', providerRef: result.providerRef },
    });
    if (advanced.count === 0) throw new AppError('SESSION_EXPIRED');
    const fingerprint = await this.fingerprint.options(challenge.id, { id: user.id, username: user.username, fullName: employee.fullName });
    return { next: 'fingerprint', fingerprint };
  }

  /**
   * Step 3 on a new device: a one-time code from a device that is already
   * signed in lets this attempt register the new device's fingerprint.
   */
  async linkDevice(challengeId: string, code: string, client: ClientInfo): Promise<{ fingerprint: FingerprintOptions }> {
    const challenge = await this.loadChallenge(challengeId, 'FINGERPRINT');
    const user = await this.prisma.user.findUnique({ where: { username: challenge.username }, include: { employee: true } });
    if (!user || !user.isActive) throw new AppError('UNAUTHENTICATED');
    await this.assertNotLocked(user, challenge.username, client);
    if (!(await this.fingerprint.useLinkCode(user.id, code))) {
      await this.registerFailure(user, challenge.username, client, 'invalid_link_code');
      throw new AppError('INVALID_CREDENTIALS', 'رمز الربط غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا من جهازك الآخر.');
    }
    const fingerprint = await this.fingerprint.linkOptions(challenge.id, { id: user.id, username: user.username, fullName: user.employee.fullName });
    return { fingerprint };
  }

  /** Step 3: on success, creates the authenticated session. */
  async verifyFingerprint(challengeId: string, assertion: string, client: ClientInfo) {
    const challenge = await this.loadChallenge(challengeId, ['FINGERPRINT', 'FINGERPRINT_LINK']);
    const user = await this.prisma.user.findUnique({
      where: { username: challenge.username },
      include: { employee: true },
    });
    if (!user || !user.isActive) throw new AppError('UNAUTHENTICATED');
    await this.assertNotLocked(user, challenge.username, client);

    const ok = await this.fingerprint.verify(challenge, { id: user.id, username: user.username, fullName: user.employee.fullName }, assertion, client);
    if (!ok) {
      await this.registerFailure(user, challenge.username, client, 'fingerprint_failed');
      throw new AppError('FINGERPRINT_FAILED');
    }

    await this.refreshEmployee(user.employee.id, user.employee.eapEmployeeId);

    return this.prisma.transaction(async (tx) => {
      // Consume the challenge exactly once (guards against replay/double submit).
      const consumed = await tx.loginChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count === 0) throw new AppError('SESSION_EXPIRED');

      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      const session = await this.sessions.create(user.id, client, tx);
      await this.securityLog.record(
        { type: 'LOGIN_SUCCESS', userId: user.id, username: user.username, sessionId: session.sessionId, client },
        tx,
      );
      return session;
    });
  }

  private async loadChallenge(challengeId: string, step: Step | Step[]) {
    const steps: string[] = Array.isArray(step) ? step : [step];
    const challenge = await this.prisma.loginChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date() || !steps.includes(challenge.step)) {
      throw new AppError('SESSION_EXPIRED', 'انتهت صلاحية محاولة الدخول. يرجى البدء من جديد.');
    }
    return challenge;
  }

  private async assertNotLocked(
    user: { id: string; lockedUntil: Date | null } | null,
    username: string,
    client: ClientInfo,
  ): Promise<void> {
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      await this.securityLog.record({
        type: 'LOGIN_FAILED',
        userId: user.id,
        username,
        client,
        details: { reason: 'account_locked' },
      });
      throw new AppError('ACCOUNT_LOCKED');
    }
  }

  /** Brute-force protection (spec §48): lock after N failures for M minutes. */
  private async registerFailure(
    user: { id: string } | null,
    username: string,
    client: ClientInfo,
    reason: string,
  ): Promise<void> {
    await this.securityLog.record({ type: 'LOGIN_FAILED', userId: user?.id ?? null, username, client, details: { reason } });
    if (!user) return;

    const { 'security.maxFailedAttempts': max, 'security.lockoutMinutes': minutes } =
      await this.settings.getMany(['security.maxFailedAttempts', 'security.lockoutMinutes']);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
    });
    if (updated.failedLoginCount >= max) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + minutes * 60_000) },
      });
      await this.securityLog.record({
        type: 'ACCOUNT_LOCKED',
        userId: user.id,
        username,
        client,
        details: { attempts: updated.failedLoginCount, lockoutMinutes: minutes },
      });
    }
  }

  /** Refreshes the cached employee record from EAP (spec §46). Failures never block login (the cached record is used). */
  async refreshEmployee(employeeId: string, eapEmployeeId: string): Promise<void> {
    try {
      const fresh = await this.eap.getEmployee(eapEmployeeId);
      if (!fresh) return;
      await this.prisma.employee.update({
        where: { id: employeeId },
        data: {
          fullName: fresh.fullName,
          jobTitle: fresh.jobTitle,
          email: fresh.email,
          phone: fresh.phone,
          isActive: fresh.isActive,
          lastSyncedAt: new Date(),
        },
      });
    } catch {
      // EAP directory temporarily unavailable: keep the cached record.
    }
  }
}
