import { timingSafeEqual } from 'node:crypto';
import type { EapEmployee, EapProvider, PasswordResult, ProviderHealth } from './eap.types';

/**
 * Development/test stand-in for EAP (spec §88). Refused in staging and
 * production by env validation. All people here are fictional.
 */
export const MOCK_DIRECTORY: Array<EapEmployee & { username: string }> = [
  { username: 'admin', eapEmployeeId: 'EMP-1001', fullName: 'سامي الأحمد', jobTitle: 'مدير أنظمة', email: 'admin@example.test', phone: null, isActive: true },
  { username: 'manager', eapEmployeeId: 'EMP-1002', fullName: 'ليلى حسن', jobTitle: 'مديرة الأصول', email: 'manager@example.test', phone: null, isActive: true },
  { username: 'viewer', eapEmployeeId: 'EMP-1003', fullName: 'كريم يوسف', jobTitle: 'موظف', email: 'viewer@example.test', phone: null, isActive: true },
  { username: 'noaccess', eapEmployeeId: 'EMP-1004', fullName: 'هالة سعيد', jobTitle: 'محاسبة', email: null, phone: null, isActive: true },
  { username: 'staff1', eapEmployeeId: 'EMP-1005', fullName: 'مراد خليل', jobTitle: 'فني', email: null, phone: null, isActive: true },
  { username: 'staff2', eapEmployeeId: 'EMP-1006', fullName: 'رنا عمر', jobTitle: 'منسقة', email: null, phone: null, isActive: true },
  { username: 'former', eapEmployeeId: 'EMP-1007', fullName: 'باسل ناصر', jobTitle: 'موظف سابق', email: null, phone: null, isActive: false },
];

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export class MockEapProvider implements EapProvider {
  readonly name = 'mock' as const;

  constructor(
    private readonly password: string,
    private readonly fingerprint: string,
  ) {}

  async verifyPassword(username: string, password: string): Promise<PasswordResult> {
    const person = MOCK_DIRECTORY.find((p) => p.username === username.toLowerCase());
    if (!person || !person.isActive || !safeEqual(password, this.password)) return { ok: false };
    return { ok: true, eapEmployeeId: person.eapEmployeeId, providerRef: null };
  }

  async verifyFingerprint(input: { assertion: string }): Promise<boolean> {
    return safeEqual(input.assertion, this.fingerprint);
  }

  async getEmployee(eapEmployeeId: string): Promise<EapEmployee | null> {
    const p = MOCK_DIRECTORY.find((e) => e.eapEmployeeId === eapEmployeeId);
    return p ? strip(p) : null;
  }

  async searchEmployees(query: string, limit: number): Promise<EapEmployee[]> {
    const q = query.trim().toLowerCase();
    return MOCK_DIRECTORY.filter(
      (p) => p.fullName.toLowerCase().includes(q) || p.eapEmployeeId.toLowerCase().includes(q),
    )
      .slice(0, limit)
      .map(strip);
  }

  async health(): Promise<ProviderHealth> {
    return { status: 'up', detail: 'Mock provider (development only)' };
  }
}

function strip({ username: _u, ...employee }: EapEmployee & { username: string }): EapEmployee {
  return employee;
}
