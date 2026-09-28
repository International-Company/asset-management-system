import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { App } from './App';
import { meResponse, mockApi, renderApp, unauthenticated } from './test/render';

const config = () => ({
  status: 200,
  body: { authProvider: 'mock', company: { nameAr: 'شركة تجريبية', nameEn: 'Demo Co' } },
});

describe('Login flow', () => {
  it('walks username → password → fingerprint and enters the app', async () => {
    let signedIn = false;
    const calls = mockApi({
      'GET /auth/me': () => (signedIn ? meResponse(['assets.view'])() : unauthenticated()),
      'GET /auth/config': config,
      'POST /auth/login/start': () => ({ status: 200, body: { challengeId: 'c1', next: 'password' } }),
      'POST /auth/login/password': () => ({ status: 200, body: { next: 'fingerprint', fingerprint: { type: 'code' } } }),
      'POST /auth/login/fingerprint': () => {
        signedIn = true;
        return { status: 200, body: { ok: true } };
      },
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/' });

    await user.type(await screen.findByLabelText('اسم المستخدم'), 'manager');
    await user.click(screen.getByRole('button', { name: 'متابعة' }));
    await user.type(await screen.findByLabelText('كلمة المرور'), 'secret');
    await user.click(screen.getByRole('button', { name: 'متابعة' }));
    await user.type(await screen.findByLabelText('رمز محاكاة البصمة'), '000000');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    expect(await screen.findByRole('heading', { name: /مرحبًا، ليلى حسن/ })).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /auth/login/password')?.body).toEqual({ challengeId: 'c1', password: 'secret' });
  });

  it('shows the Arabic server message and restarts after a wrong password', async () => {
    mockApi({
      'GET /auth/me': unauthenticated,
      'GET /auth/config': config,
      'POST /auth/login/start': () => ({ status: 200, body: { challengeId: 'c1', next: 'password' } }),
      'POST /auth/login/password': () => ({
        status: 401,
        body: { error: { code: 'INVALID_CREDENTIALS', message: 'اسم المستخدم أو كلمة المرور غير صحيحة.' } },
      }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/login' });

    await user.type(await screen.findByLabelText('اسم المستخدم'), 'manager');
    await user.click(screen.getByRole('button', { name: 'متابعة' }));
    await user.type(await screen.findByLabelText('كلمة المرور'), 'bad');
    await user.click(screen.getByRole('button', { name: 'متابعة' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('اسم المستخدم أو كلمة المرور غير صحيحة.');
    expect(screen.getByLabelText('اسم المستخدم')).toBeInTheDocument();
  });
});

describe('Login with EAP passkey (fingerprint on the device)', () => {
  const eapConfig = () => ({ status: 200, body: { authProvider: 'eap', company: { nameAr: 'شركة تجريبية', nameEn: 'Demo Co' } } });
  const bytes = (...b: number[]) => new Uint8Array(b).buffer;

  afterEach(() => {
    Reflect.deleteProperty(window, 'PublicKeyCredential');
    Reflect.deleteProperty(navigator, 'credentials');
  });

  function stubPasskey(result: 'ok' | 'cancel') {
    const get = vi.fn(async () => {
      if (result === 'cancel') throw new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError');
      return {
        id: 'cred-1',
        response: { clientDataJSON: bytes(1, 2, 3), authenticatorData: bytes(255, 254), signature: bytes(62, 63), userHandle: bytes(9) },
      };
    });
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: function PublicKeyCredential() {} });
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get } });
    return get;
  }

  function mocks(onFingerprint: () => void = () => {}) {
    let signedIn = false;
    const calls = mockApi({
      'GET /auth/me': () => (signedIn ? meResponse(['assets.view'])() : unauthenticated()),
      'GET /auth/config': eapConfig,
      'POST /auth/login/start': () => ({ status: 200, body: { challengeId: 'c1', next: 'password' } }),
      'POST /auth/login/password': () => ({
        status: 200,
        body: { next: 'fingerprint', fingerprint: { type: 'webauthn', challenge: 'AQID', rpId: 'company.test', timeoutMs: 60000 } },
      }),
      'POST /auth/login/fingerprint': () => {
        onFingerprint();
        signedIn = true;
        return { status: 200, body: { ok: true } };
      },
    });
    return calls;
  }

  async function reachFingerprint() {
    const user = userEvent.setup();
    renderApp(<App />, { route: '/login' });
    await user.type(await screen.findByLabelText('اسم المستخدم'), 'sami');
    await user.click(screen.getByRole('button', { name: 'متابعة' }));
    await user.type(await screen.findByLabelText('كلمة المرور'), 'secret');
    await user.click(screen.getByRole('button', { name: 'متابعة' }));
    return user;
  }

  it('asks the device for the passkey and sends only the signed assertion (base64url)', async () => {
    const get = stubPasskey('ok');
    const calls = mocks();
    const user = await reachFingerprint();
    await user.click(await screen.findByRole('button', { name: 'التحقق بالبصمة' }));

    expect(await screen.findByRole('heading', { name: /مرحبًا/ })).toBeInTheDocument();
    const options = (get.mock.calls[0] as unknown as [CredentialRequestOptions])[0].publicKey!;
    expect(options).toMatchObject({ rpId: 'company.test', userVerification: 'required', timeout: 60000 });
    expect(new Uint8Array(options.challenge as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    const sent = calls.find((c) => c.key === 'POST /auth/login/fingerprint')!.body as { assertion: string };
    expect(JSON.parse(sent.assertion)).toEqual({ credentialId: 'cred-1', clientDataJson: 'AQID', authenticatorData: '__4', signature: 'Pj8', userHandle: 'CQ' });
  });

  it('explains a cancelled fingerprint without sending anything', async () => {
    stubPasskey('cancel');
    let sent = false;
    mocks(() => (sent = true));
    const user = await reachFingerprint();
    await user.click(await screen.findByRole('button', { name: 'التحقق بالبصمة' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('لم يكتمل التحقق من البصمة');
    expect(sent).toBe(false);
    expect(screen.getByRole('button', { name: 'التحقق بالبصمة' })).toBeEnabled();
  });
});

describe('Permission-aware UI', () => {
  it('hides the control panel link from users without dashboard.view', async () => {
    mockApi({ 'GET /auth/me': meResponse(['assets.view']) });
    renderApp(<App />, { route: '/' });
    await screen.findByRole('heading', { name: /مرحبًا/ });
    expect(screen.queryByRole('link', { name: 'لوحة التحكم' })).not.toBeInTheDocument();
  });

  it('shows a permission-denied page when opening /dashboard directly', async () => {
    mockApi({ 'GET /auth/me': meResponse(['assets.view']) });
    renderApp(<App />, { route: '/dashboard' });
    expect(await screen.findByRole('heading', { name: 'لا تملك صلاحية الوصول' })).toBeInTheDocument();
  });

  it('shows the control panel with health checks for administrators', async () => {
    mockApi({
      'GET /auth/me': meResponse(['dashboard.view', 'health.view'], ['SYSTEM_ADMINISTRATOR']),
      'GET /health/details': () => ({
        status: 200,
        body: {
          status: 'up',
          checkedAt: new Date().toISOString(),
          checks: {
            backend: { status: 'up' },
            database: { status: 'up', latencyMs: 2 },
            eap: { status: 'down' },
            storage: { status: 'up' },
          },
        },
      }),
    });
    renderApp(<App />, { route: '/dashboard' });
    expect(await screen.findByRole('link', { name: 'لوحة التحكم' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('قاعدة البيانات')).toBeInTheDocument());
    expect(screen.getByText('متوقف')).toBeInTheDocument();
  });
});

describe('Session handling', () => {
  it('returns to the login page with a message when the session expires', async () => {
    let expired = false;
    mockApi({
      'GET /auth/me': () =>
        expired
          ? { status: 401, body: { error: { code: 'SESSION_EXPIRED', message: 'انتهت الجلسة. يرجى تسجيل الدخول من جديد.' } } }
          : meResponse([])(),
      'GET /security/sessions/mine': () => {
        expired = true;
        return { status: 401, body: { error: { code: 'SESSION_EXPIRED', message: 'انتهت الجلسة. يرجى تسجيل الدخول من جديد.' } } };
      },
      'GET /auth/config': config,
    });
    renderApp(<App />, { route: '/account/sessions' });
    expect(await screen.findByRole('alert')).toHaveTextContent('انتهت الجلسة');
    expect(screen.getByRole('heading', { name: 'تسجيل الدخول' })).toBeInTheDocument();
  });

  it('shows an Arabic 404 for unknown pages', async () => {
    mockApi({ 'GET /auth/me': meResponse([]) });
    renderApp(<App />, { route: '/no-such-page' });
    expect(await screen.findByRole('heading', { name: 'الصفحة غير موجودة' })).toBeInTheDocument();
  });
});
