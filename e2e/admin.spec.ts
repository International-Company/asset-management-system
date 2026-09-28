import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.MOCK_AUTH_PASSWORD ?? 'dev-password';
const FINGERPRINT = process.env.MOCK_AUTH_FINGERPRINT ?? '000000';

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('اسم المستخدم').fill(username);
  await page.getByRole('button', { name: 'متابعة' }).click();
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'متابعة' }).click();
  await page.getByLabel('رمز محاكاة البصمة').fill(FINGERPRINT);
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByRole('heading', { name: /مرحبًا/ })).toBeVisible();
}

const unique = () => Math.random().toString(36).slice(2, 7);

test('administrator registers a location and links a department to it', async ({ page }, info) => {
  const name = `فرع اختبار ${unique()}`;
  await login(page, 'admin');
  await page.goto('/admin/locations');
  await page.getByRole('button', { name: 'إضافة موقع' }).click();
  await page.getByRole('dialog').getByLabel('الاسم').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click();
  // The page behind a native modal is inert until it closes.
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByLabel('بحث', { exact: true }).fill(name);
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'الأقسام' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('إضافة قسم').selectOption({ label: 'تقنية المعلومات' });
  await dialog.getByRole('button', { name: 'ربط' }).click();
  await expect(dialog.getByRole('cell', { name: 'تقنية المعلومات' })).toBeVisible();
  await page.screenshot({ path: `test-results/screens/locations-${info.project.name}.png`, fullPage: true });
  await dialog.getByRole('button', { name: 'إغلاق' }).click();
  await expect(row.getByText('تقنية المعلومات')).toBeVisible();
});

test('administrator creates a custom role, and it appears in the audit log', async ({ page }, info) => {
  const roleName = `دور اختبار ${unique()}`;
  await login(page, 'admin');
  await page.goto('/admin/roles');
  await page.getByRole('button', { name: 'إنشاء دور' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('اسم الدور').fill(roleName);
  await dialog.getByRole('checkbox', { name: 'عرض الأصول' }).check();
  await dialog.getByRole('checkbox', { name: 'عرض الجرد' }).check();
  await page.screenshot({ path: `test-results/screens/role-editor-${info.project.name}.png`, fullPage: true });
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByRole('row', { name: new RegExp(roleName) })).toBeVisible();

  await page.goto('/admin/audit');
  await expect(page.getByRole('cell', { name: 'إنشاء دور' }).first()).toBeVisible();
});

test('company name set in settings appears in the top bar', async ({ page }, info) => {
  const company = `شركة الأمل ${unique()}`;
  await login(page, 'admin');
  await page.goto('/admin/settings');
  const input = page.getByLabel('اسم الشركة بالعربية');
  await input.fill(company);
  await page.getByRole('button', { name: 'حفظ التغييرات' }).click();
  await expect(page.getByText('تم حفظ الإعدادات.')).toBeVisible();
  await expect(page.locator('.topbar .company')).toHaveText(company);
  await page.screenshot({ path: `test-results/screens/settings-${info.project.name}.png`, fullPage: true });
});

test('users page lists accounts with roles and state', async ({ page }, info) => {
  await login(page, 'admin');
  await page.goto('/admin/users');
  await expect(page.getByRole('link', { name: 'سامي الأحمد' })).toBeVisible();
  await page.screenshot({ path: `test-results/screens/users-${info.project.name}.png`, fullPage: true });
});

test('Asset Manager is refused administrator pages', async ({ page }) => {
  await login(page, 'manager');
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'لا تملك صلاحية الوصول' })).toBeVisible();
  const res = await page.request.get('/api/v1/users');
  expect(res.status()).toBe(403);
});
