import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.MOCK_AUTH_PASSWORD ?? 'dev-password';
const FINGERPRINT = process.env.MOCK_AUTH_FINGERPRINT ?? '000000';
/** The server pair running with FINGERPRINT_MODE=passkey (see playwright.config.ts). */
const PASSKEY_SITE = 'http://localhost:4273';

/**
 * The fingerprint step in a real browser (spec §47): Chromium's virtual
 * authenticator plays the device's fingerprint sensor, so the page, the
 * WebAuthn browser API and the server's verification all run for real.
 */
test.skip(({ browserName, isMobile }) => browserName !== 'chromium' || !!isMobile, 'Virtual authenticator: Chromium desktop');

async function passwordSteps(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('اسم المستخدم').fill(username);
  await page.getByRole('button', { name: 'متابعة' }).click();
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'متابعة' }).click();
}

test('first sign-in registers the fingerprint, the next one signs in with it, and it appears under «بصماتي»', async ({ browser }) => {
  // An administrator (on the development server) clears viewer's fingerprints.
  const adminContext = await browser.newContext({ baseURL: 'http://localhost:4173' });
  const admin = await adminContext.newPage();
  await passwordSteps(admin, 'admin');
  await admin.getByLabel('رمز محاكاة البصمة').fill(FINGERPRINT);
  await admin.getByRole('button', { name: 'دخول' }).click();
  await expect(admin.getByRole('heading', { name: /مرحبًا/ })).toBeVisible();
  const users = await (await admin.request.get('/api/v1/users?q=viewer')).json();
  const viewer = users.items.find((u: { username: string }) => u.username === 'viewer');
  expect((await admin.request.post(`/api/v1/users/${viewer.id}/passkeys/reset`)).ok()).toBe(true);
  await adminContext.close();

  const context = await browser.newContext({ baseURL: PASSKEY_SITE, locale: 'ar' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  // First sign-in: the device registers its fingerprint.
  await passwordSteps(page, 'viewer');
  await expect(page.getByText(/هذا أول دخول لك/)).toBeVisible();
  await page.getByRole('button', { name: 'تسجيل البصمة' }).click();
  await expect(page.getByRole('heading', { name: /مرحبًا/ })).toBeVisible();

  await page.goto('/account/sessions');
  const section = page.getByRole('region', { name: 'بصماتي' });
  await expect(section.getByRole('row')).toHaveCount(2); // header + one device
  await expect(section.getByRole('button', { name: 'حذف' })).toBeDisabled();

  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await expect(page.getByLabel('اسم المستخدم')).toBeVisible();

  // Next sign-in: the same device signs the new challenge.
  await passwordSteps(page, 'viewer');
  await page.getByRole('button', { name: 'التحقق بالبصمة' }).click();
  // Signed in again, back on the page it signed out from.
  await expect(page.getByRole('heading', { name: 'جلساتي' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'بصماتي' }).getByRole('row')).toHaveCount(2);
  await context.close();
});

test('a device without a registered fingerprint cannot sign in', async ({ browser }) => {
  // viewer now has a fingerprint on another device; this browser has a new, empty authenticator.
  const context = await browser.newContext({ baseURL: PASSKEY_SITE, locale: 'ar' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await passwordSteps(page, 'viewer');
  await page.getByRole('button', { name: 'التحقق بالبصمة' }).click();
  await expect(page.getByRole('alert')).toContainText('لم يكتمل التحقق من البصمة');
  await expect(page.getByRole('heading', { name: /مرحبًا/ })).toHaveCount(0);
  await context.close();
});
