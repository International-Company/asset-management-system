import { AppError } from '../../common/errors/app-error';
import type { EapEmployee, EapProvider, PasswordResult, ProviderHealth } from './eap.types';

/**
 * Real EAP integration.
 *
 * The EAP REST contract (endpoints, payloads, and how the company
 * fingerprint mechanism returns its assertion) has not been provided yet
 * (spec §88). Rather than guess at an API, every call fails with
 * SERVICE_UNAVAILABLE until the contract is implemented here. The health
 * check reports only whether EAP_API_URL is reachable.
 */
export class EapHttpProvider implements EapProvider {
  readonly name = 'eap' as const;

  constructor(private readonly config: { baseUrl: string; clientId: string; clientSecret: string }) {}

  private notImplemented(): never {
    throw new AppError('SERVICE_UNAVAILABLE', 'خدمة المصادقة EAP غير مهيأة بعد.', {
      internal: 'EAP integration contract not implemented (spec §88)',
    });
  }

  verifyPassword(_username: string, _password: string): Promise<PasswordResult> {
    return this.notImplemented();
  }

  verifyFingerprint(): Promise<boolean> {
    return this.notImplemented();
  }

  getEmployee(_eapEmployeeId: string): Promise<EapEmployee | null> {
    return this.notImplemented();
  }

  searchEmployees(_query: string, _limit: number): Promise<EapEmployee[]> {
    return this.notImplemented();
  }

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      const res = await fetch(this.config.baseUrl, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
      return {
        status: res.status < 500 ? 'up' : 'down',
        detail: 'Integration contract pending',
        latencyMs: Date.now() - started,
      };
    } catch {
      return { status: 'down', latencyMs: Date.now() - started };
    }
  }
}
