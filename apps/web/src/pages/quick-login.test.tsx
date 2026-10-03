import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { App } from '../App';
import { ApiError } from '../lib/api';
import { meResponse, mockApi, renderApp, unauthenticated } from '../test/render';

const quick = vi.hoisted(() => ({
  getQuickDevice: vi.fn(),
  quickSignIn: vi.fn(),
  enableQuickLogin: vi.fn(),
  forgetQuickDevice: vi.fn(),
}));
vi.mock('../lib/quickLogin', async (original) => ({ ...(await original<typeof import('../lib/quickLogin')>()), ...quick }));

const device = { deviceId: 'd1', userId: 'u1', username: 'manager', fullName: 'ليلى حسن', privateKey: {} as CryptoKey };
const config = () => ({ status: 200, body: { authProvider: 'mock', company: { nameAr: 'شركة تجريبية', nameEn: 'Demo' } } });

beforeEach(() => {
  quick.getQuickDevice.mockReset().mockResolvedValue(null);
  quick.quickSignIn.mockReset();
  quick.enableQuickLogin.mockReset().mockResolvedValue(undefined);
  quick.forgetQuickDevice.mockReset().mockResolvedValue(undefined);
});

describe('Quick sign-in with a PIN', () => {
  it('a device set up for it shows the name and four boxes, and signs in once four digits are typed', async () => {
    quick.getQuickDevice.mockResolvedValue(device);
    let signedIn = false;
    quick.quickSignIn.mockImplementation(async () => {
      signedIn = true;
    });
    mockApi({
      'GET /auth/me': () => (signedIn ? meResponse([])() : unauthenticated()),
      'GET /auth/config': config,
      'GET /notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/login' });

    expect(await screen.findByText('ليلى حسن')).toBeInTheDocument();
    expect(screen.queryByLabelText('اسم المستخدم')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('رمز الدخول السريع'), '4827');
    expect(quick.quickSignIn).toHaveBeenCalledWith(device, '4827');
    expect(await screen.findByRole('heading', { name: /مرحبًا/ })).toBeInTheDocument();
  });

  it('a wrong PIN shows the attempts left and clears the boxes', async () => {
    quick.getQuickDevice.mockResolvedValue(device);
    quick.quickSignIn.mockRejectedValue(new ApiError('INVALID_CREDENTIALS', 'الرمز غير صحيح. بقيت 4 محاولات قبل إلغاء الدخول السريع على هذا الجهاز.', 401));
    mockApi({ 'GET /auth/me': unauthenticated, 'GET /auth/config': config });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/login' });

    const pin = await screen.findByLabelText('رمز الدخول السريع');
    await user.type(pin, '9999');
    expect(await screen.findByRole('alert')).toHaveTextContent('بقيت 4 محاولات');
    expect(pin).toHaveValue('');
  });

  it('a revoked device falls back to the password sign-in and is forgotten', async () => {
    quick.getQuickDevice.mockResolvedValue(device);
    quick.quickSignIn.mockRejectedValue(new ApiError('INVALID_STATE', 'أُدخل الرمز خطأً 5 مرات، فأُلغي الدخول السريع على هذا الجهاز.', 409));
    mockApi({ 'GET /auth/me': unauthenticated, 'GET /auth/config': config });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/login' });

    quick.getQuickDevice.mockResolvedValue(null);
    await user.type(await screen.findByLabelText('رمز الدخول السريع'), '9999');
    expect(await screen.findByLabelText('اسم المستخدم')).toHaveValue('manager');
    expect(screen.getByRole('alert')).toHaveTextContent('5 مرات');
    expect(quick.forgetQuickDevice).toHaveBeenCalled();
  });

  it('«الدخول بكلمة المرور» opens the usual sign-in, and «الدخول بالرمز» returns', async () => {
    quick.getQuickDevice.mockResolvedValue(device);
    mockApi({ 'GET /auth/me': unauthenticated, 'GET /auth/config': config });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/login' });

    await user.click(await screen.findByRole('button', { name: 'الدخول بكلمة المرور' }));
    expect(screen.getByLabelText('اسم المستخدم')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'الدخول بالرمز' }));
    expect(screen.getByLabelText('رمز الدخول السريع')).toBeInTheDocument();
  });

  it('after a full sign-in, offers to set up the PIN; easy and mismatched PINs are refused', async () => {
    let signedIn = false;
    mockApi({
      'GET /auth/me': () => (signedIn ? meResponse([])() : unauthenticated()),
      'GET /auth/config': config,
      'GET /notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'POST /auth/login/start': () => ({ status: 200, body: { challengeId: 'c1', next: 'password' } }),
      'POST /auth/login/password': () => ({ status: 200, body: { next: 'fingerprint', fingerprint: { type: 'code' } } }),
      'POST /auth/login/fingerprint': () => {
        signedIn = true;
        return { status: 200, body: { ok: true } };
      },
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/login' });

    await user.type(await screen.findByLabelText('اسم المستخدم'), 'manager');
    await user.click(screen.getByRole('button', { name: 'متابعة' }));
    await user.type(await screen.findByLabelText('كلمة المرور'), 'secret');
    await user.click(screen.getByRole('button', { name: 'متابعة' }));
    await user.type(await screen.findByLabelText('رمز محاكاة البصمة'), '000000');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    const dialog = await screen.findByRole('dialog', { name: 'الدخول السريع بالرمز' });
    await user.type(within(dialog).getByLabelText('الرمز الجديد'), '1234');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('سهل التخمين');
    await user.type(within(dialog).getByLabelText('الرمز الجديد'), '4827');
    await user.type(within(dialog).getByLabelText('تأكيد الرمز'), '4828');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('غير متطابقين');
    await user.type(within(dialog).getByLabelText('الرمز الجديد'), '4827');
    await user.type(within(dialog).getByLabelText('تأكيد الرمز'), '4827');
    await waitFor(() => expect(quick.enableQuickLogin).toHaveBeenCalledWith('4827', { id: 'u1', username: 'manager', fullName: 'ليلى حسن' }));
    expect(await within(dialog).findByText(/تم التفعيل/)).toBeInTheDocument();
  });
});
