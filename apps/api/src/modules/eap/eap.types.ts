/**
 * Contract between the Asset System and EAP (spec §46–47, §88).
 *
 * EAP is the source of truth for authentication (username → password →
 * fingerprint) and for employee data. The Asset System never receives or
 * stores raw biometric data: the fingerprint step exchanges an opaque
 * assertion produced by the company/EAP fingerprint mechanism.
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

/**
 * What the browser needs for the fingerprint step. `webauthn`: ask the device
 * for a passkey (the fingerprint stays on the device). `code`: the development
 * mock, where a code stands in for the fingerprint.
 */
export type FingerprintOptions =
  | { type: 'webauthn'; challenge: string; rpId: string; timeoutMs: number }
  | { type: 'code' };

export interface ProviderHealth {
  status: 'up' | 'down' | 'not_configured';
  detail?: string;
  latencyMs?: number;
}

export interface EapProvider {
  readonly name: 'mock' | 'eap';

  /** Step 2: verify username + password against EAP. */
  verifyPassword(username: string, password: string): Promise<PasswordResult>;

  /** Issued after step 2: how the browser should collect the fingerprint. */
  fingerprintOptions(): Promise<FingerprintOptions>;

  /**
   * Step 3: verify the fingerprint assertion for the session started in
   * step 2. `assertion` is opaque to the Asset System.
   */
  verifyFingerprint(input: {
    username: string;
    eapEmployeeId: string;
    providerRef: string | null;
    assertion: string;
  }): Promise<boolean>;

  getEmployee(eapEmployeeId: string): Promise<EapEmployee | null>;
  searchEmployees(query: string, limit: number): Promise<EapEmployee[]>;

  health(): Promise<ProviderHealth>;
}

export const EAP_PROVIDER = Symbol('EAP_PROVIDER');
