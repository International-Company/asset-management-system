import { Logger } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { EapEmployee, EapProvider, FingerprintOptions, PasswordResult, ProviderHealth } from './eap.types';

/**
 * EAP = the Company Central Platform (contracts/platform-api.json in its
 * repository, and its docs/development/integration-guide.md).
 *
 * - Password step: POST /auth/login with the person's credentials. The
 *   Platform session it opens is closed straight away; the Asset System keeps
 *   its own session.
 * - Fingerprint step: a passkey. The browser asks the device for the
 *   fingerprint (it never leaves the device) and signs the Platform's
 *   challenge; the Platform verifies the signature. The passkey must belong to
 *   the same Platform user who passed the password step.
 * - Employees: read with this application's machine token (client
 *   credentials). The application needs `platform.organization.view`.
 *
 * `eapEmployeeId` is the Platform's employee number: unique, readable, and not
 * changeable through the Platform API.
 */

interface PlatformEmployee {
  id: string;
  employeeNumber: string;
  fullName: { ar: string; en: string };
  userId: string | null;
  positionId: string | null;
  workEmail: string | null;
  workPhone: string | null;
  isActive: boolean;
}

interface Paged<T> {
  items: T[];
  hasNext: boolean;
}

interface AuthResult {
  accessToken: string;
  user: { id: string; username: string; mustChangePassword: boolean };
}

/** Parsed Platform failure: RFC 9457 problem document with a stable code. */
class PlatformError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly correlationId: string | null,
  ) {
    super(`Platform ${status} ${code ?? ''}`.trim());
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
/** Renew the machine token this long before it expires. */
const TOKEN_MARGIN_MS = 60_000;
/** How long the user → employee and position lists are reused. */
const DIRECTORY_TTL_MS = 5 * 60_000;
/** A safety net: never page forever if the Platform misreports hasNext. */
const MAX_PAGES = 200;

export class EapHttpProvider implements EapProvider {
  readonly name = 'eap' as const;
  private readonly logger = new Logger(EapHttpProvider.name);
  private readonly base: string;
  private token: { value: string; expiresAt: number } | null = null;
  private pendingToken: Promise<string> | null = null;
  private positions: { titles: Map<string, string>; at: number } | null = null;
  private userDirectory: { byUserId: Map<string, PlatformEmployee>; at: number } | null = null;

  constructor(
    private readonly config: { baseUrl: string; clientId: string; clientSecret: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = `${config.baseUrl.replace(/\/+$/, '')}/api/v1`;
  }

  // ── Authentication ────────────────────────────────────────────────────

  async verifyPassword(username: string, password: string): Promise<PasswordResult> {
    let result: AuthResult;
    try {
      result = await this.call<AuthResult>('/auth/login', { method: 'POST', json: { username, password, deviceFingerprint: null } });
    } catch (e) {
      // The Platform answers every refusal (unknown user, wrong password,
      // locked, disabled) with the same code, and so do we.
      if (e instanceof PlatformError && (e.status === 400 || e.status === 401 || e.status === 403 || e.status === 422)) return { ok: false };
      throw this.unavailable(e);
    }
    await this.endPlatformSession(result.accessToken);
    if (result.user.mustChangePassword) return { ok: false, reason: 'password_change_required' };

    const employee = await this.employeeForUser(result.user.id);
    if (!employee || !employee.isActive) return { ok: false };
    return { ok: true, eapEmployeeId: employee.employeeNumber, providerRef: result.user.id };
  }

  async fingerprintOptions(): Promise<FingerprintOptions> {
    try {
      const o = await this.call<{ challenge: string; relyingPartyId: string; timeoutMilliseconds: number | string }>('/auth/passkey/options', {
        method: 'POST',
      });
      return { type: 'webauthn', challenge: o.challenge, rpId: o.relyingPartyId, timeoutMs: Number(o.timeoutMilliseconds) };
    } catch (e) {
      throw this.unavailable(e);
    }
  }

  async verifyFingerprint(input: { username: string; eapEmployeeId: string; providerRef: string | null; assertion: string }): Promise<boolean> {
    let assertion: Record<string, unknown>;
    try {
      assertion = JSON.parse(input.assertion) as Record<string, unknown>;
    } catch {
      return false;
    }
    const fields = ['credentialId', 'clientDataJson', 'authenticatorData', 'signature'];
    if (fields.some((f) => typeof assertion[f] !== 'string') || (assertion.userHandle != null && typeof assertion.userHandle !== 'string')) return false;

    let result: AuthResult;
    try {
      result = await this.call<AuthResult>('/auth/passkey', {
        method: 'POST',
        json: {
          credentialId: assertion.credentialId,
          clientDataJson: assertion.clientDataJson,
          authenticatorData: assertion.authenticatorData,
          signature: assertion.signature,
          userHandle: assertion.userHandle ?? null,
        },
      });
    } catch (e) {
      if (e instanceof PlatformError && e.status >= 400 && e.status < 500 && e.status !== 429) return false;
      throw this.unavailable(e);
    }
    await this.endPlatformSession(result.accessToken);
    // Somebody else's passkey on the same device is not this person's fingerprint.
    return !!input.providerRef && result.user.id === input.providerRef;
  }

  // ── Employees ─────────────────────────────────────────────────────────

  async getEmployee(eapEmployeeId: string): Promise<EapEmployee | null> {
    const page = await this.machine<Paged<PlatformEmployee>>(`/organization/employees?q=${encodeURIComponent(eapEmployeeId)}&pageSize=100`);
    const match = page.items.find((e) => e.employeeNumber === eapEmployeeId);
    return match ? this.toEmployee(match) : null;
  }

  async searchEmployees(query: string, limit: number): Promise<EapEmployee[]> {
    const size = Math.min(Math.max(limit, 1), 100);
    const page = await this.machine<Paged<PlatformEmployee>>(`/organization/employees?q=${encodeURIComponent(query.trim())}&pageSize=${size}&sort=employeeNumber`);
    return Promise.all(page.items.slice(0, limit).map((e) => this.toEmployee(e)));
  }

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      await this.call('/diagnostics/ping');
    } catch {
      return { status: 'down', detail: 'Platform unreachable', latencyMs: Date.now() - started };
    }
    try {
      await this.machineToken();
      return { status: 'up', latencyMs: Date.now() - started };
    } catch {
      return { status: 'down', detail: 'Application credentials refused', latencyMs: Date.now() - started };
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async toEmployee(e: PlatformEmployee): Promise<EapEmployee> {
    return {
      eapEmployeeId: e.employeeNumber,
      fullName: e.fullName.ar || e.fullName.en,
      jobTitle: e.positionId ? ((await this.positionTitles()).get(e.positionId) ?? null) : null,
      email: e.workEmail,
      phone: e.workPhone,
      isActive: e.isActive,
    };
  }

  /** The employee linked to a Platform user account (the list has no userId filter). */
  private async employeeForUser(userId: string): Promise<PlatformEmployee | null> {
    const fresh = this.userDirectory && Date.now() - this.userDirectory.at < DIRECTORY_TTL_MS;
    const cached = fresh ? this.userDirectory!.byUserId.get(userId) : undefined;
    if (cached) return cached;
    // Unknown or stale: reload (a new starter, or a newly linked account).
    const byUserId = new Map<string, PlatformEmployee>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await this.machine<Paged<PlatformEmployee>>(`/organization/employees?page=${page}&pageSize=100&sort=employeeNumber`);
      for (const e of res.items) if (e.userId) byUserId.set(e.userId, e);
      if (!res.hasNext) break;
    }
    this.userDirectory = { byUserId, at: Date.now() };
    return byUserId.get(userId) ?? null;
  }

  private async positionTitles(): Promise<Map<string, string>> {
    if (this.positions && Date.now() - this.positions.at < DIRECTORY_TTL_MS) return this.positions.titles;
    const list = await this.machine<Array<{ id: string; title: { ar: string; en: string } }>>('/organization/positions?includeInactive=true');
    const titles = new Map(list.map((p) => [p.id, p.title.ar || p.title.en]));
    this.positions = { titles, at: Date.now() };
    return titles;
  }

  /** Ends the Platform session a sign-in step opened. Best effort. */
  private async endPlatformSession(accessToken: string): Promise<void> {
    try {
      await this.call('/auth/logout', { method: 'POST', bearer: accessToken });
    } catch (e) {
      this.logger.warn({ err: e instanceof Error ? e.message : String(e) }, 'Could not end the Platform session opened for sign-in');
    }
  }

  /** A call made as this application, retried once with a fresh token on 401. */
  private async machine<T>(path: string): Promise<T> {
    try {
      return await this.call<T>(path, { bearer: await this.machineToken() });
    } catch (e) {
      if (e instanceof PlatformError && e.status === 401) {
        this.token = null;
        try {
          return await this.call<T>(path, { bearer: await this.machineToken() });
        } catch (retry) {
          throw this.unavailable(retry);
        }
      }
      throw this.unavailable(e);
    }
  }

  /** Cached client-credentials token; concurrent callers share one request. */
  private machineToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - TOKEN_MARGIN_MS) return Promise.resolve(this.token.value);
    this.pendingToken ??= (async () => {
      try {
        const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.config.clientId, client_secret: this.config.clientSecret });
        const res = await this.call<{ access_token: string; expires_in: number | string }>('/oauth/token', { method: 'POST', form: body });
        this.token = { value: res.access_token, expiresAt: Date.now() + Number(res.expires_in) * 1000 };
        return res.access_token;
      } finally {
        this.pendingToken = null;
      }
    })();
    return this.pendingToken;
  }

  private async call<T = unknown>(path: string, opts: { method?: string; json?: unknown; form?: URLSearchParams; bearer?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': 'ar' };
    if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.form ? opts.form.toString() : opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const problem = (await res.json().catch(() => ({}))) as { code?: string; correlationId?: string };
      throw new PlatformError(res.status, problem.code ?? null, problem.correlationId ?? null);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Maps any unexpected failure to a user-safe error; details go to the log only. */
  private unavailable(e: unknown): AppError {
    if (e instanceof AppError) return e;
    const detail = e instanceof PlatformError ? { status: e.status, code: e.code, correlationId: e.correlationId } : { err: e instanceof Error ? e.message : String(e) };
    this.logger.error(detail, 'EAP (Company Central Platform) call failed');
    return new AppError('SERVICE_UNAVAILABLE', 'تعذر الاتصال بنظام EAP. يرجى المحاولة لاحقًا.', { internal: JSON.stringify(detail) });
  }
}
