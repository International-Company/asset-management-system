import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { App } from '../App';
import { mockApi, renderApp } from '../test/render';

const webauthn = vi.hoisted(() => ({ startRegistration: vi.fn(), startAuthentication: vi.fn(), browserSupportsWebAuthn: vi.fn(() => true) }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const me = () => ({
  status: 200,
  body: { id: 'u1', username: 'sami', fullName: 'سامي الأحمد', roles: [], permissions: [], authProvider: 'eap', fingerprintMode: 'passkey', company: { nameAr: 'شركة', nameEn: 'Co' } },
});
const sessions = () => ({ status: 200, body: { items: [] } });
const device = (id: string, deviceName: string) => ({ id, deviceName, createdAt: '2026-09-29T08:00:00Z', lastUsedAt: null });

describe('My fingerprints (account page)', () => {
  it('lists devices, adds this one, and removes another after confirmation', async () => {
    let devices = [device('p1', 'Windows · Chrome')];
    webauthn.startRegistration.mockResolvedValue({ id: 'new', rawId: 'new', type: 'public-key', response: { attestationObject: 'YQ' } });
    const calls = mockApi({
      'GET /auth/me': me,
      'GET /security/sessions/mine': sessions,
      'GET /notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /auth/passkeys': () => ({ status: 200, body: devices }),
      'POST /auth/passkeys/options': () => ({ status: 200, body: { challengeId: 'ch-1', options: { challenge: 'YWRk' } } }),
      'POST /auth/passkeys': () => {
        devices = [...devices, device('p2', 'Android · Chrome')];
        return { status: 201, body: devices };
      },
      'DELETE /auth/passkeys/p1': () => {
        devices = devices.filter((d) => d.id !== 'p1');
        return { status: 204, body: null };
      },
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/account/sessions' });

    const section = await screen.findByRole('region', { name: 'بصماتي' });
    await within(section).findByText('Windows · Chrome');
    // The only device cannot be removed.
    expect(within(section).getByRole('button', { name: 'حذف' })).toBeDisabled();

    await user.click(within(section).getByRole('button', { name: 'إضافة هذا الجهاز' }));
    await within(section).findByText('Android · Chrome');
    expect(webauthn.startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: 'YWRk' } });
    expect(calls.find((c) => c.key === 'POST /auth/passkeys')!.body).toMatchObject({ challengeId: 'ch-1', credential: { id: 'new' } });

    const firstRow = within(section).getByRole('row', { name: /Windows · Chrome/ });
    await user.click(within(firstRow).getByRole('button', { name: 'حذف' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'حذف البصمة' }));
    await waitFor(() => expect(within(section).queryByText('Windows · Chrome')).not.toBeInTheDocument());
  });

  it('shows a one-time code to link a new device, with the time left', async () => {
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    mockApi({
      'GET /auth/me': me,
      'GET /security/sessions/mine': sessions,
      'GET /notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /auth/passkeys': () => ({ status: 200, body: [device('p1', 'Windows · Chrome')] }),
      'GET /auth/quick/devices': () => ({ status: 200, body: [] }),
      'POST /auth/passkeys/link-code': () => ({ status: 200, body: { code: '482913', expiresAt } }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/account/sessions' });

    const section = await screen.findByRole('region', { name: 'بصماتي' });
    await user.click(within(section).getByRole('button', { name: 'ربط جهاز جديد' }));
    const dialog = await screen.findByRole('dialog', { name: 'ربط جهاز جديد' });
    expect(within(dialog).getByText('482 913')).toBeInTheDocument();
    expect(within(dialog).getByText(/ينتهي بعد (9:5\d|10:00)/)).toBeInTheDocument();
  });

  it('is hidden when the development fingerprint code is in use', async () => {
    mockApi({
      'GET /auth/me': () => ({ ...me(), body: { ...me().body, fingerprintMode: 'code' } }),
      'GET /security/sessions/mine': sessions,
      'GET /notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
    });
    renderApp(<App />, { route: '/account/sessions' });
    await screen.findByRole('heading', { name: 'جلساتي' });
    expect(screen.queryByRole('region', { name: 'بصماتي' })).not.toBeInTheDocument();
  });
});
