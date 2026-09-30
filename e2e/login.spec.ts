import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.MOCK_AUTH_PASSWORD ?? 'dev-password';
const FINGERPRINT = process.env.MOCK_AUTH_FINGERPRINT ?? '000000';

async function login(page: Page, username: string) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
  await page.getByLabel('اسم المستخدم').fill(username);
  await page.getByRole('button', { name: 'متابعة' }).click();
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'متابعة' }).click();
  await page.getByLabel('رمز محاكاة البصمة').fill(FINGERPRINT);
  await page.getByRole('button', { name: 'دخول' }).click();
}

test('page is Arabic RTL and a first visit shows no error', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('administrator logs in through all three steps and sees the control panel', async ({ page }, info) => {
  await page.goto('/login');
  await page.screenshot({ path: `test-results/screens/login-${info.project.name}.png`, fullPage: true });
  await login(page, 'admin');
  await expect(page.getByRole('heading', { name: /مرحبًا، سامي الأحمد/ })).toBeVisible();

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'حالة النظام' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'قاعدة البيانات' })).toBeVisible();
  await page.screenshot({ path: `test-results/screens/dashboard-${info.project.name}.png`, fullPage: true });
});

test('asset manager cannot open the control panel', async ({ page }) => {
  await login(page, 'manager');
  await expect(page.getByRole('heading', { name: /مرحبًا/ })).toBeVisible();
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'لا تملك صلاحية الوصول' })).toBeVisible();
});

test('wrong password shows an Arabic error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('اسم المستخدم').fill('viewer');
  await page.getByRole('button', { name: 'متابعة' }).click();
  await page.getByLabel('كلمة المرور').fill('not-the-password');
  await page.getByRole('button', { name: 'متابعة' }).click();
  await expect(page.getByRole('alert')).toContainText('اسم المستخدم أو كلمة المرور غير صحيحة');
});

test('logout returns to the login page and the session no longer works', async ({ page }) => {
  await login(page, 'viewer');
  await expect(page.getByRole('heading', { name: /مرحبًا/ })).toBeVisible();
  await page.getByRole('button', { name: /قائمة المستخدم/ }).click();
  await page.getByRole('menuitem', { name: 'تسجيل الخروج' }).click();
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
  const res = await page.request.get('/api/v1/auth/me');
  expect(res.status()).toBe(401);
});
