/**
 * Contract between the Asset System and EAP (spec §46–47, §88).
 *
 * EAP is the source of truth for passwords and employee data. The fingerprint
 * step is handled by the Asset System's own passkeys (auth/fingerprint.service),
 * because a passkey only works on the domain it was registered for.
 */

export interface EapEmployee {
  eapEmployeeId: string;
  fullName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
}

export type PasswordResult =
  | { ok: true; eapEmployeeId: string; providerRef: string | null }
  | { ok: false; reason?: 'password_change_required' };

export interface ProviderHealth {
  status: 'up' | 'down' | 'not_configured';
  detail?: string;
  latencyMs?: number;
}

export interface EapProvider {
  readonly name: 'mock' | 'eap';

  /** Step 2: verify username + password against EAP. */
  verifyPassword(username: string, password: string): Promise<PasswordResult>;

  getEmployee(eapEmployeeId: string): Promise<EapEmployee | null>;
  searchEmployees(query: string, limit: number): Promise<EapEmployee[]>;

  health(): Promise<ProviderHealth>;
}

export const EAP_PROVIDER = Symbol('EAP_PROVIDER');
