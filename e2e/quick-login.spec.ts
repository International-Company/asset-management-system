import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.MOCK_AUTH_PASSWORD ?? 'dev-password';
const FINGERPRINT = process.env.MOCK_AUTH_FINGERPRINT ?? '000000';

// This file wants the offer that the config turns off for every other test.
test.use({ storageState: { cookies: [], origins: [] } });

async function fullLogin(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('اسم المستخدم').fill(username);
  await page.getByRole('button', { name: 'متابعة' }).click();
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'متابعة' }).click();
  await page.getByLabel('رمز محاكاة البصمة').fill(FINGERPRINT);
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByRole('heading', { name: /مرحبًا/ })).toBeVisible();
}

async function logout(page: Page) {
  await page.getByRole('button', { name: /قائمة المستخدم/ }).click();
  await page.getByRole('menuitem', { name: 'تسجيل الخروج' }).click();
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
}

test('set up a PIN after signing in, then sign in with the PIN alone', async ({ page }, info) => {
  await fullLogin(page, 'viewer');
  // Devices left by earlier runs would count toward the per-user limit.
  const dialog = page.getByRole('dialog', { name: 'الدخول السريع بالرمز' });
  await expect(dialog).toBeVisible();
  for (const d of await (await page.request.get('/api/v1/auth/quick/devices')).json()) {
    await page.request.delete(`/api/v1/auth/quick/devices/${d.id}`);
  }

  await dialog.getByLabel('الرمز الجديد').pressSequentially('4827');
  await dialog.getByLabel('تأكيد الرمز').pressSequentially('4827');
  await expect(dialog.getByText(/تم التفعيل/)).toBeVisible();
  await dialog.getByRole('button', { name: 'حسنًا' }).click();

  await logout(page);
  await expect(page.getByText('كريم يوسف')).toBeVisible();
  await page.screenshot({ path: `test-results/screens/quick-login-${info.project.name}.png`, fullPage: true });

  // A wrong PIN says how many tries are left.
  await page.getByLabel('رمز الدخول السريع').pressSequentially('9014');
  await expect(page.getByRole('alert')).toContainText('بقيت 4 محاولات');

  await page.getByLabel('رمز الدخول السريع').pressSequentially('4827');
  await expect(page.getByRole('heading', { name: /مرحبًا، كريم يوسف/ })).toBeVisible();

  // «جلساتي» lists this device; removing it there brings back the password sign-in.
  await page.goto('/account/sessions');
  const section = page.getByRole('region', { name: 'الدخول السريع بالرمز' });
  await expect(section.getByText('هذا الجهاز')).toBeVisible();
  await section.getByRole('button', { name: 'إلغاء' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'إلغاء الدخول السريع' }).click();
  await expect(section.getByText('الدخول السريع غير مفعّل على أي جهاز.')).toBeVisible();
  await logout(page);
  await expect(page.getByLabel('اسم المستخدم')).toBeVisible();
});
