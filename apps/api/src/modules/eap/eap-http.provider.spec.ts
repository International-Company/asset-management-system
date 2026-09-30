import { EapHttpProvider } from './eap-http.provider';

/**
 * A stand-in for the Company Central Platform that follows its contract
 * (contracts/platform-api.json and docs/development/usooli-integration.md):
 * paths, payload shapes, permissions and problem documents.
 */
function fakePlatform(overrides: { mustChangePassword?: boolean; tokenStatus?: number; canReadPositions?: boolean } = {}) {
  const calls: Array<{ method: string; path: string; auth?: string; body?: string }> = [];
  const employees = [
    { id: 'e1', employeeNumber: 'EMP-001', fullName: { ar: 'سامي الأحمد', en: 'Sami' }, userId: 'u1', positionId: 'p1', positionCode: 'SYS-MGR', workEmail: 'sami@example.test', workPhone: null, isActive: true },
    { id: 'e2', employeeNumber: 'EMP-002', fullName: { ar: 'ليلى حسن', en: 'Layla' }, userId: 'u2', positionId: null, positionCode: null, workEmail: null, workPhone: '0590000000', isActive: false },
  ];
  // Platform accounts: u3 (contractor) has no employee record.
  const accounts: Record<string, string> = { sami: 'u1', layla: 'u2', contractor: 'u3' };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/api/v1', '');
    const auth = (init?.headers as Record<string, string>)?.Authorization;
    calls.push({ method: init?.method ?? 'GET', path: path + url.search, auth, body: init?.body as string | undefined });
    const machine = auth === 'Bearer machine-token';
    if (path === '/oauth/token') {
      if (overrides.tokenStatus) return json(overrides.tokenStatus, { code: 'IDENTITY.INVALID_CLIENT', correlationId: 'c1' });
      const form = new URLSearchParams(init?.body as string);
      expect(form.get('grant_type')).toBe('client_credentials');
      return json(200, { access_token: 'machine-token', token_type: 'Bearer', expires_in: 900 });
    }
    if (path === '/auth/login') {
      const { username, password } = JSON.parse(init!.body as string);
      if (!accounts[username] || password !== 'secret') return json(401, { code: 'IDENTITY.INVALID_CREDENTIALS', correlationId: 'c2' });
      return json(200, { accessToken: 'user-token', refreshToken: 'r', expiresInSeconds: 900, tokenType: 'Bearer', user: { id: accounts[username], username, mustChangePassword: !!overrides.mustChangePassword } });
    }
    if (path === '/auth/logout') return init?.body ? json(400, {}) : new Response(null, { status: 204 });
    if (path.startsWith('/organization/')) {
      if (!machine) return json(401, {});
      const byUser = /^\/organization\/employees\/by-user\/(.+)$/.exec(path);
      if (byUser) {
        const e = employees.find((x) => x.userId === byUser[1]);
        return e ? json(200, e) : json(404, { code: 'ORGANIZATION.EMPLOYEE_NOT_FOUND' });
      }
      const one = /^\/organization\/employees\/([^/]+)$/.exec(path);
      if (one) {
        const e = employees.find((x) => x.id === one[1]);
        return e ? json(200, e) : json(404, { code: 'ORGANIZATION.EMPLOYEE_NOT_FOUND' });
      }
      if (path === '/organization/employees') {
        const q = url.searchParams.get('q') ?? '';
        const items = employees.filter((e) => e.employeeNumber.includes(q) || e.fullName.ar.includes(q));
        return json(200, { items, page: 1, pageSize: 100, totalItems: items.length, totalPages: 1, hasPrevious: false, hasNext: false });
      }
      if (path === '/organization/positions') {
        // Needs platform.organization.view, which the minimal role does not carry.
        if (!overrides.canReadPositions) return json(403, { code: 'AUTHZ.PERMISSION_DENIED' });
        return json(200, [{ id: 'p1', code: 'SYS-MGR', title: { ar: 'مدير أنظمة', en: 'Systems manager' }, level: 1, isActive: true }]);
      }
    }
    if (path === '/diagnostics/ping') return json(200, { status: 'ok' });
    return json(404, {});
  }) as typeof fetch;
  const provider = new EapHttpProvider({ baseUrl: 'https://platform.test/', clientId: 'ccp_id', clientSecret: 'ccps_secret' }, fetchImpl);
  return { provider, calls };
}


describe('EapHttpProvider (Company Central Platform)', () => {
  it('accepts the right password, links it to the employee id, and closes the Platform session', async () => {
    const { provider, calls } = fakePlatform();
    expect(await provider.verifyPassword('sami', 'secret')).toEqual({ ok: true, eapEmployeeId: 'e1', providerRef: 'u1' });
    const logout = calls.find((c) => c.path === '/auth/logout')!;
    expect(logout).toMatchObject({ auth: 'Bearer user-token', body: undefined });
    expect(calls.some((c) => c.path === '/organization/employees/by-user/u1')).toBe(true);
    expect(await provider.verifyPassword('sami', 'wrong')).toEqual({ ok: false });
  });

  it('refuses an account with no employee record, and an inactive employee', async () => {
    const { provider } = fakePlatform();
    expect(await provider.verifyPassword('contractor', 'secret')).toEqual({ ok: false });
    expect(await provider.verifyPassword('layla', 'secret')).toEqual({ ok: false });
  });

  it('refuses when the Platform requires a password change', async () => {
    const { provider } = fakePlatform({ mustChangePassword: true });
    expect(await provider.verifyPassword('sami', 'secret')).toEqual({ ok: false, reason: 'password_change_required' });
  });

  it('reads one employee by id with one cached machine token; an unknown id is null', async () => {
    const { provider, calls } = fakePlatform({ canReadPositions: true });
    expect(await provider.getEmployee('e1')).toEqual({ eapEmployeeId: 'e1', fullName: 'سامي الأحمد', jobTitle: 'مدير أنظمة', email: 'sami@example.test', phone: null, isActive: true });
    expect(await provider.getEmployee('missing')).toBeNull();
    expect((await provider.searchEmployees('ليلى', 10)).map((e) => [e.eapEmployeeId, e.isActive])).toEqual([['e2', false]]);
    expect(calls.filter((c) => c.path === '/oauth/token')).toHaveLength(1);
  });

  it('with only platform.employees.view, the job title falls back to the position code', async () => {
    const { provider } = fakePlatform();
    expect((await provider.getEmployee('e1'))?.jobTitle).toBe('SYS-MGR');
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
