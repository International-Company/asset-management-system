import { EapHttpProvider } from './eap-http.provider';

/**
 * A stand-in for the Company Central Platform that follows its contract
 * (contracts/platform-api.json): paths, payload shapes, problem documents.
 */
function fakePlatform(overrides: { mustChangePassword?: boolean; passkeyUser?: string; tokenStatus?: number } = {}) {
  const calls: Array<{ method: string; path: string; auth?: string; body?: string }> = [];
  const employees = [
    { id: 'e1', employeeNumber: 'EMP-001', fullName: { ar: 'سامي الأحمد', en: 'Sami' }, userId: 'u1', positionId: 'p1', workEmail: 'sami@example.test', workPhone: null, isActive: true },
    { id: 'e2', employeeNumber: 'EMP-002', fullName: { ar: 'ليلى حسن', en: 'Layla' }, userId: 'u2', positionId: null, workEmail: null, workPhone: '0590000000', isActive: false },
  ];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/api/v1', '');
    const auth = (init?.headers as Record<string, string>)?.Authorization;
    calls.push({ method: init?.method ?? 'GET', path: path + url.search, auth, body: init?.body as string | undefined });
    if (path === '/oauth/token') {
      if (overrides.tokenStatus) return json(overrides.tokenStatus, { code: 'IDENTITY.INVALID_CLIENT', correlationId: 'c1' });
      const form = new URLSearchParams(init?.body as string);
      expect(form.get('grant_type')).toBe('client_credentials');
      return json(200, { access_token: 'machine-token', token_type: 'Bearer', expires_in: 900 });
    }
    if (path === '/auth/login') {
      const { username, password } = JSON.parse(init!.body as string);
      const accounts: Record<string, string> = { sami: 'u1', layla: 'u2' };
      if (!accounts[username] || password !== 'secret') return json(401, { code: 'IDENTITY.INVALID_CREDENTIALS', correlationId: 'c2' });
      return json(200, { accessToken: 'user-token', refreshToken: 'r', expiresInSeconds: 900, tokenType: 'Bearer', user: { id: accounts[username], username, mustChangePassword: !!overrides.mustChangePassword } });
    }
    if (path === '/auth/logout') return new Response(null, { status: 204 });
    if (path === '/auth/passkey/options') return json(200, { challenge: 'Y2hhbGxlbmdl', relyingPartyId: 'company.test', timeoutMilliseconds: '300000' });
    if (path === '/auth/passkey') {
      const body = JSON.parse(init!.body as string);
      if (body.signature !== 'good') return json(401, { code: 'IDENTITY.INVALID_PASSKEY' });
      return json(200, { accessToken: 'user-token-2', refreshToken: 'r', expiresInSeconds: 900, tokenType: 'Bearer', user: { id: overrides.passkeyUser ?? 'u1', username: 'sami', mustChangePassword: false } });
    }
    if (path === '/organization/employees') {
      if (auth !== 'Bearer machine-token') return json(401, {});
      const q = url.searchParams.get('q');
      const items = q ? employees.filter((e) => e.employeeNumber.includes(q) || e.fullName.ar.includes(q)) : employees;
      return json(200, { items, page: 1, pageSize: 100, totalItems: items.length, totalPages: 1, hasPrevious: false, hasNext: false });
    }
    if (path === '/organization/positions') return json(200, [{ id: 'p1', code: 'IT', title: { ar: 'مدير أنظمة', en: 'Systems manager' }, level: 1, isActive: true }]);
    if (path === '/diagnostics/ping') return json(200, { status: 'ok' });
    return json(404, {});
  }) as typeof fetch;
  const provider = new EapHttpProvider({ baseUrl: 'https://platform.test/', clientId: 'ccp_id', clientSecret: 'ccps_secret' }, fetchImpl);
  return { provider, calls };
}

const assertion = (signature: string) =>
  JSON.stringify({ credentialId: 'cred', clientDataJson: 'cdj', authenticatorData: 'ad', signature, userHandle: 'uh' });

describe('EapHttpProvider (Company Central Platform)', () => {
  it('accepts the right password, links it to the employee, and closes the Platform session', async () => {
    const { provider, calls } = fakePlatform();
    expect(await provider.verifyPassword('sami', 'secret')).toEqual({ ok: true, eapEmployeeId: 'EMP-001', providerRef: 'u1' });
    expect(calls.find((c) => c.path === '/auth/logout')?.auth).toBe('Bearer user-token');
    expect(await provider.verifyPassword('sami', 'wrong')).toEqual({ ok: false });
  });

  it('refuses when the Platform requires a password change', async () => {
    const { provider } = fakePlatform({ mustChangePassword: true });
    expect(await provider.verifyPassword('sami', 'secret')).toEqual({ ok: false, reason: 'password_change_required' });
  });

  it('passes the passkey challenge to the browser and verifies the passkey belongs to the same person', async () => {
    const { provider } = fakePlatform();
    expect(await provider.fingerprintOptions()).toEqual({ type: 'webauthn', challenge: 'Y2hhbGxlbmdl', rpId: 'company.test', timeoutMs: 300000 });
    const input = { username: 'sami', eapEmployeeId: 'EMP-001', providerRef: 'u1' };
    expect(await provider.verifyFingerprint({ ...input, assertion: assertion('good') })).toBe(true);
    expect(await provider.verifyFingerprint({ ...input, assertion: assertion('bad') })).toBe(false);
    expect(await provider.verifyFingerprint({ ...input, assertion: 'not json' })).toBe(false);
    expect(await provider.verifyFingerprint({ ...input, providerRef: null, assertion: assertion('good') })).toBe(false);
  });

  it("someone else's passkey is refused even when the Platform accepts it", async () => {
    const { provider } = fakePlatform({ passkeyUser: 'u2' });
    expect(await provider.verifyFingerprint({ username: 'sami', eapEmployeeId: 'EMP-001', providerRef: 'u1', assertion: assertion('good') })).toBe(false);
  });

  it('reads employees with one cached machine token, including the job title', async () => {
    const { provider, calls } = fakePlatform();
    expect(await provider.getEmployee('EMP-001')).toEqual({ eapEmployeeId: 'EMP-001', fullName: 'سامي الأحمد', jobTitle: 'مدير أنظمة', email: 'sami@example.test', phone: null, isActive: true });
    expect(await provider.getEmployee('EMP-00')).toBeNull(); // partial matches are not the employee
    expect((await provider.searchEmployees('ليلى', 10)).map((e) => [e.eapEmployeeId, e.isActive])).toEqual([['EMP-002', false]]);
    expect(calls.filter((c) => c.path === '/oauth/token')).toHaveLength(1);
  });

  it('an inactive employee cannot sign in', async () => {
    // layla's Platform account is linked to EMP-002, which is inactive.
    expect(await fakePlatform().provider.verifyPassword('layla', 'secret')).toEqual({ ok: false });
  });

  it('reports health, and refused application credentials as down', async () => {
    expect((await fakePlatform().provider.health()).status).toBe('up');
    const refused = await fakePlatform({ tokenStatus: 401 }).provider.health();
    expect(refused).toMatchObject({ status: 'down', detail: 'Application credentials refused' });
  });

  it('an unreachable Platform becomes a safe Arabic error, never a leak of details', async () => {
    const failing = new EapHttpProvider({ baseUrl: 'https://platform.test', clientId: 'x', clientSecret: 'y' }, (async () => {
      throw new TypeError('connect ECONNREFUSED 10.0.0.5:443');
    }) as typeof fetch);
    await expect(failing.verifyPassword('sami', 'secret')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', message: 'تعذر الاتصال بنظام EAP. يرجى المحاولة لاحقًا.' });
  });
});
