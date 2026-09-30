import { expect, test, type Browser, type Page } from '@playwright/test';

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

async function userPage(browser: Browser, username: string, isMobile: boolean) {
  const context = await browser.newContext({ baseURL: 'http://localhost:4173', locale: 'ar', ...(isMobile ? { viewport: { width: 412, height: 915 }, isMobile: true } : {}) });
  const page = await context.newPage();
  await login(page, username);
  return { page, close: () => context.close() };
}

/** Creates an asset through the API as the signed-in user; returns its page URL. */
async function newAsset(page: Page, name: string): Promise<string> {
  const cats = await (await page.request.get('/api/v1/lookups/categories')).json();
  const locs = await (await page.request.get('/api/v1/lookups/locations')).json();
  const loc = locs.find((l: { name: string }) => l.name === 'المقر الرئيسي');
  const res = await page.request.post('/api/v1/assets', {
    data: {
      name,
      subcategoryId: cats.find((c: { code: string }) => c.code === 'TEC').subcategories[0].id,
      locationId: loc.id,
      departmentId: loc.departments[0].id,
      responsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1002' },
    },
  });
  expect(res.status()).toBe(201);
  return `/assets/${(await res.json()).id}`;
}

test('custody: manager hands over, receiver confirms from the home page, official PDF is issued', async ({ browser }, info) => {
  const mobile = info.project.name === 'mobile';
  const manager = await userPage(browser, 'manager', mobile);
  const receiver = await userPage(browser, 'viewer', mobile);
  try {
    const url = await newAsset(manager.page, `جهاز عهدة ${Math.random().toString(36).slice(2, 6)}`);
    await manager.page.goto(url);
    await manager.page.getByRole('link', { name: 'تسليم عهدة' }).click();
    await manager.page.getByLabel('ابحث عن موظف').fill('كريم');
    await manager.page.getByRole('button', { name: 'بحث', exact: true }).first().click();
    await manager.page.getByRole('listitem').filter({ hasText: 'كريم يوسف' }).getByRole('button', { name: 'اختيار' }).click();
    await manager.page.getByRole('button', { name: 'إنشاء المحضر' }).click();
    await expect(manager.page.getByText(/بانتظار تأكيد كريم يوسف/)).toBeVisible();
    const number = (await manager.page.getByRole('heading', { level: 1 }).textContent())!.match(/CUS-\d+/)![0];

    await receiver.page.goto('/');
    const pending = receiver.page.getByRole('region', { name: /بانتظار تأكيدك/ });
    await pending.getByRole('listitem').filter({ hasText: number }).getByRole('link', { name: 'مراجعة' }).click();
    const confirmButton = receiver.page.getByRole('button', { name: 'تأكيد الاستلام' });
    await expect(confirmButton).toBeVisible();
    await receiver.page.screenshot({ path: `test-results/screens/custody-pending-${info.project.name}.png`, fullPage: true });
    await confirmButton.click();
    await receiver.page.getByRole('dialog').getByRole('button', { name: 'تأكيد' }).click();
    await expect(receiver.page.getByText('مؤكد', { exact: true })).toBeVisible();
    const pdfLink = receiver.page.getByRole('link', { name: 'المستند الرسمي (PDF)' });
    await expect(pdfLink).toBeVisible();
    const pdf = await receiver.page.request.get((await pdfLink.getAttribute('href'))!);
    expect(pdf.headers()['content-type']).toBe('application/pdf');

    await manager.page.goto(url);
    await expect(manager.page.getByRole('heading', { name: 'العهدة الحالية' })).toBeVisible();
    await expect(manager.page.locator('.card', { hasText: 'العهدة الحالية' }).getByText('كريم يوسف')).toBeVisible();
    await manager.page.screenshot({ path: `test-results/screens/asset-custody-${info.project.name}.png`, fullPage: true });
  } finally {
    await manager.close();
    await receiver.close();
  }
});

test('transfer, maintenance lifecycle and sale from the asset page', async ({ page }, info) => {
  await login(page, 'manager');
  const url = await newAsset(page, `جهاز عمليات ${Math.random().toString(36).slice(2, 6)}`);
  await page.goto(url);

  await page.getByRole('button', { name: 'نقل', exact: true }).click();
  const transfer = page.getByRole('dialog');
  await transfer.getByLabel('الموقع الجديد').selectOption({ label: 'فرع الشمال' });
  await transfer.getByLabel('القسم الجديد').selectOption({ index: 1 });
  await transfer.getByRole('button', { name: 'تنفيذ النقل' }).click();
  await expect(page.getByText('فرع الشمال').first()).toBeVisible();

  await page.getByRole('link', { name: 'صيانة', exact: true }).click();
  await page.getByLabel('الشركة *').selectOption({ index: 1 });
  await page.getByLabel('صورة ما قبل الصيانة *').setInputFiles({ name: 'before.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'فتح طلب الصيانة' }).click();
  await expect(page.getByRole('heading', { name: /MNT-\d+/ })).toBeVisible();
  await page.getByRole('button', { name: 'بدء الصيانة' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'بدء' }).click();
  await page.getByRole('button', { name: 'إكمال الصيانة' }).click();
  const complete = page.getByRole('dialog');
  await complete.getByLabel('ما تم إصلاحه *').fill('تنظيف وتبديل المروحة');
  await complete.getByLabel('صورة ما بعد الصيانة *').setInputFiles({ name: 'after.png', mimeType: 'image/png', buffer: PNG });
  await complete.getByRole('button', { name: 'إكمال' }).click();
  await page.getByRole('button', { name: 'انتهاء الصيانة' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'تأكيد الانتهاء' }).click();
  await expect(page.getByText('انتهت الصيانة. الطلب نهائي والتكلفة نهائية.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'تقرير الصيانة (PDF)' })).toBeVisible();
  await page.screenshot({ path: `test-results/screens/maintenance-${info.project.name}.png`, fullPage: true });

  await page.goto(url);
  await page.getByRole('link', { name: 'بيع', exact: true }).click();
  await page.getByLabel('قيمة البيع *').fill('300');
  await page.getByLabel('العملة *').selectOption('USD');
  await page.getByLabel('اسم المشتري *').fill('مؤسسة تجريبية');
  await page.getByRole('button', { name: 'مراجعة البيع' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'تأكيد البيع' }).click();
  await expect(page.getByRole('heading', { name: /SAL-\d+/ })).toBeVisible();

  await page.goto(url);
  await expect(page.getByText(/تم بيع هذا الأصل/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'نقل', exact: true })).toHaveCount(0);
});
