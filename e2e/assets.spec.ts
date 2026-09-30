import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.MOCK_AUTH_PASSWORD ?? 'dev-password';
const FINGERPRINT = process.env.MOCK_AUTH_FINGERPRINT ?? '000000';
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0a80000000049454e44ae426082',
  'hex',
);

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

async function createAsset(page: Page, name: string) {
  await page.goto('/assets/new');
  await page.getByLabel('اسم الأصل *').fill(name);
  await page.getByLabel('الفئة الرئيسية *').selectOption('TEC');
  await page.getByLabel('الفئة الفرعية *').selectOption({ index: 1 });
  await page.getByLabel('الموقع *').selectOption({ label: 'المقر الرئيسي' });
  await page.getByLabel('القسم *').selectOption({ label: 'تقنية المعلومات' });
  await page.getByLabel('الشركة المصنعة').fill('Dell');
  await page.getByLabel('ابحث عن موظف').fill('ليلى');
  await page.getByRole('button', { name: 'بحث', exact: true }).click();
  await page.getByRole('listitem').filter({ hasText: 'ليلى حسن' }).getByRole('button', { name: 'اختيار' }).click();
  await page.getByRole('button', { name: 'حفظ الأصل' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
}

test('Asset Manager creates an asset, adds a photo, and edits it with an old → new review', async ({ page }, info) => {
  const name = `حاسوب اختبار ${Math.random().toString(36).slice(2, 6)}`;
  await login(page, 'manager');
  await createAsset(page, name);
  await expect(page.getByRole('heading', { name: /TEC-\d{6}/ })).toBeVisible();
  await expect(page.getByText('جديد', { exact: true })).toBeVisible();
  await expect(page.getByText('رقم داخلي')).toBeVisible();

  await page.getByRole('tab', { name: /الصور/ }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('الرئيسية', { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/screens/asset-photos-${info.project.name}.png`, fullPage: true });

  await page.getByRole('link', { name: 'تعديل البيانات' }).click();
  await page.getByLabel('الشركة المصنعة').fill('HP');
  await page.getByRole('button', { name: 'مراجعة وحفظ' }).click();
  const review = page.getByRole('dialog', { name: 'مراجعة التغييرات قبل الحفظ' });
  await expect(review.getByRole('row', { name: /الشركة المصنعة/ })).toContainText('Dell');
  await expect(review.getByRole('row', { name: /الشركة المصنعة/ })).toContainText('HP');
  await page.screenshot({ path: `test-results/screens/asset-review-${info.project.name}.png`, fullPage: true });
  await review.getByRole('button', { name: 'تأكيد الحفظ' }).click();

  await page.getByRole('tab', { name: 'السجل التاريخي' }).click();
  // Values are wrapped in Unicode isolation marks so the arrow keeps its RTL meaning (old ← new).
  await expect(page.getByText(/الشركة المصنعة: \u2068Dell\u2069 ← \u2068HP\u2069/)).toBeVisible();
  await expect(page.getByText('إضافة صورة')).toBeVisible();
  await page.screenshot({ path: `test-results/screens/asset-history-${info.project.name}.png`, fullPage: true });
});

test('category change gives a new number while the QR link keeps working', async ({ page }) => {
  const name = `أصل للتصنيف ${Math.random().toString(36).slice(2, 6)}`;
  await login(page, 'manager');
  await createAsset(page, name);
  const assetUrl = page.url();
  const oldNumber = (await page.getByRole('heading', { level: 1 }).textContent())!.match(/TEC-\d{6}/)![0];

  await page.getByRole('button', { name: 'تغيير الفئة' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('الفئة الرئيسية الجديدة').selectOption('OFF');
  await dialog.getByLabel('الفئة الفرعية الجديدة').selectOption({ index: 1 });
  await expect(dialog.getByText(/سيتغير رقم الأصل/)).toBeVisible();
  await dialog.getByRole('button', { name: 'تأكيد تغيير الفئة' }).click();
  await expect(page.getByRole('heading', { name: /OFF-\d{6}/ })).toBeVisible();

  await page.getByRole('tab', { name: 'الأرقام السابقة' }).click();
  await expect(page.getByRole('cell', { name: oldNumber })).toBeVisible();

  // The QR token did not change: resolve it through the /qr route.
  const id = assetUrl.split('/assets/')[1];
  const asset = await (await page.request.get(`/api/v1/assets/${id}`)).json();
  await page.goto(`/qr/${asset.qrToken}`);
  await expect(page.getByRole('heading', { name: /OFF-\d{6}/ })).toBeVisible();
});

test('searching the list finds an asset by its old number', async ({ page }, info) => {
  await login(page, 'manager');
  await page.goto('/assets');
  await expect(page.getByRole('table', { name: 'الأصول' })).toBeVisible();
  await page.screenshot({ path: `test-results/screens/assets-list-${info.project.name}.png`, fullPage: true });
  await page.getByLabel('بحث', { exact: true }).fill('DEMO');
  await expect(page.getByRole('row').nth(1)).toBeVisible();
});

test('the viewer role can open assets but not change them', async ({ page }) => {
  await login(page, 'viewer');
  await page.goto('/assets');
  await expect(page.getByRole('link', { name: 'أصل جديد' })).toHaveCount(0);
  const first = page.getByRole('row').nth(1).getByRole('link').first();
  await first.click();
  await expect(page.getByRole('link', { name: 'تعديل البيانات' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'طباعة ملصق QR' })).toHaveCount(0);
});
