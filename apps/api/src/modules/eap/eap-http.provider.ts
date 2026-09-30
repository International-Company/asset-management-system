import { Logger } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { EapEmployee, EapProvider, PasswordResult, ProviderHealth } from './eap.types';

/**
 * EAP = the Company Central Platform (contracts/platform-api.json in its
 * repository, and its docs/development/integration-guide.md).
 *
 * - Password step: POST /auth/login with the person's credentials. The
 *   Platform session it opens is closed straight away; the Asset System keeps
 *   its own session.
 * - Fingerprint step: not here. A passkey only works on the domain it was
 *   registered for, so the Asset System registers its own (FingerprintService).
 * - Employees: read with this application's machine token (client
 *   credentials). The application needs `platform.employees.view`; with
 *   `platform.organization.view` as well, job titles are shown by name rather
 *   than position code.
 *
 * `eapEmployeeId` is the Platform's employee id, as the Platform's own guide
 * for this integration specifies (docs/development/usooli-integration.md).
 * A Platform account with no employee record cannot sign in: a person who is
 * not an employee cannot hold an asset.
 */

interface PlatformEmployee {
  id: string;
  employeeNumber: string;
  fullName: { ar: string; en: string };
  userId: string | null;
  positionId: string | null;
  positionCode: string | null;
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
/** How long position titles are reused. */
const POSITIONS_TTL_MS = 5 * 60_000;

export class EapHttpProvider implements EapProvider {
  readonly name = 'eap' as const;
  private readonly logger = new Logger(EapHttpProvider.name);
  private readonly base: string;
  private token: { value: string; expiresAt: number } | null = null;
  private pendingToken: Promise<string> | null = null;
  /** Position titles; `null` titles = this application may not read positions. */
  private positions: { titles: Map<string, string> | null; at: number } | null = null;

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

    // Policy: only an active employee may sign in (no employee record → refused).
    const employee = await this.machineOrNull<PlatformEmployee>(`/organization/employees/by-user/${encodeURIComponent(result.user.id)}`);
    if (!employee || !employee.isActive) return { ok: false };
    return { ok: true, eapEmployeeId: employee.id, providerRef: result.user.id };
  }

  // ── Employees ─────────────────────────────────────────────────────────

  async getEmployee(eapEmployeeId: string): Promise<EapEmployee | null> {
    const employee = await this.machineOrNull<PlatformEmployee>(`/organization/employees/${encodeURIComponent(eapEmployeeId)}`);
    return employee ? this.toEmployee(employee) : null;
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
      eapEmployeeId: e.id,
      fullName: e.fullName.ar || e.fullName.en,
      jobTitle: await this.jobTitle(e),
      email: e.workEmail,
      phone: e.workPhone,
      isActive: e.isActive,
    };
  }

  /** The position's name when positions may be read, otherwise its code. */
  private async jobTitle(e: PlatformEmployee): Promise<string | null> {
    if (!e.positionId) return null;
    if (!this.positions || Date.now() - this.positions.at >= POSITIONS_TTL_MS) {
      try {
        const list = await this.call<Array<{ id: string; title: { ar: string; en: string } }>>('/organization/positions?includeInactive=true', {
          bearer: await this.machineToken(),
        });
        this.positions = { titles: new Map(list.map((p) => [p.id, p.title.ar || p.title.en])), at: Date.now() };
      } catch (err) {
        // Without platform.organization.view the code is enough; not an outage.
        if (!(err instanceof PlatformError && err.status === 403)) throw this.unavailable(err);
        this.positions = { titles: null, at: Date.now() };
      }
    }
    return this.positions.titles?.get(e.positionId) ?? e.positionCode;
  }

  /** Ends the Platform session a sign-in step opened. Best effort. */
  private async endPlatformSession(accessToken: string): Promise<void> {
    try {
      await this.call('/auth/logout', { method: 'POST', bearer: accessToken });
    } catch (e) {
      this.logger.warn({ err: e instanceof Error ? e.message : String(e) }, 'Could not end the Platform session opened for sign-in');
    }
  }

  /** Like machine(), but a 404 (no such employee) is null rather than an error. */
  private async machineOrNull<T>(path: string): Promise<T | null> {
    try {
      return await this.machineRaw<T>(path);
    } catch (e) {
      if (e instanceof PlatformError && e.status === 404) return null;
      throw this.unavailable(e);
    }
  }

  /** A call made as this application; failures become a safe Arabic error. */
  private async machine<T>(path: string): Promise<T> {
    try {
      return await this.machineRaw<T>(path);
    } catch (e) {
      throw this.unavailable(e);
    }
  }

  /** Retried once with a fresh token on 401 (revoked or rotated credential). */
  private async machineRaw<T>(path: string): Promise<T> {
    try {
      return await this.call<T>(path, { bearer: await this.machineToken() });
    } catch (e) {
      if (!(e instanceof PlatformError && e.status === 401)) throw e;
      this.token = null;
      return this.call<T>(path, { bearer: await this.machineToken() });
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
