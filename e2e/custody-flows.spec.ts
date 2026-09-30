import { expect, test, type Browser, type Page } from '@playwright/test';

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

async function userPage(browser: Browser, username: string, isMobile: boolean) {
  const context = await browser.newContext({ baseURL: 'http://localhost:4173', locale: 'ar', ...(isMobile ? { viewport: { width: 412, height: 915 }, isMobile: true } : {}) });
  const page = await context.newPage();
  await login(page, username);
  return { page, close: () => context.close() };
}

/** Creates an asset (responsible: ليلى حسن, EMP-1002) through the API; returns its id. */
async function newAsset(page: Page, name: string): Promise<string> {
  const cats = await (await page.request.get('/api/v1/lookups/categories')).json();
  const locs = await (await page.request.get('/api/v1/lookups/locations')).json();
  const loc = locs.find((l: { name: string }) => l.name === 'المقر الرئيسي');
  const res = await page.request.post('/api/v1/assets', {
    data: {
      name,
      subcategoryId: cats.find((c: { code: string }) => c.code === 'OFF').subcategories[0].id,
      locationId: loc.id,
      departmentId: loc.departments[0].id,
      responsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1002' },
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id;
}

/** A pending custody handing the asset to كريم يوسف (the viewer account). */
async function pendingCustody(page: Page, assetId: string): Promise<{ id: string; number: string }> {
  const res = await page.request.post('/api/v1/custodies', {
    data: { newResponsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1003' }, items: [{ assetId, condition: 'IN_USE' }] },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

const tag = () => Math.random().toString(36).slice(2, 6);

test('custody rejection: the receiver refuses with a reason and the asset stays with its responsible', async ({ browser }, info) => {
  const mobile = info.project.name === 'mobile';
  const manager = await userPage(browser, 'manager', mobile);
  const receiver = await userPage(browser, 'viewer', mobile);
  try {
    const assetId = await newAsset(manager.page, `خزانة ${tag()}`);
    const custody = await pendingCustody(manager.page, assetId);

    await receiver.page.goto(`/custodies/${custody.id}`);
    await receiver.page.getByRole('button', { name: 'رفض الاستلام' }).click();
    const dialog = receiver.page.getByRole('dialog');
    await dialog.getByLabel('السبب *').fill('الأصل غير مطابق للوصف');
    await dialog.getByRole('button', { name: 'رفض', exact: true }).click();
    await expect(receiver.page.getByText('مرفوض', { exact: true })).toBeVisible();
    await expect(receiver.page.getByText('الأصل غير مطابق للوصف')).toBeVisible();
    await expect(receiver.page.getByRole('button', { name: 'تأكيد الاستلام' })).toHaveCount(0);

    const asset = await (await manager.page.request.get(`/api/v1/assets/${assetId}`)).json();
    expect(asset.responsibleEmployee.fullName).toBe('ليلى حسن');
    // A final record cannot be confirmed afterwards.
    expect((await receiver.page.request.post(`/api/v1/custodies/${custody.id}/confirm`)).status()).toBe(409);
  } finally {
    await manager.close();
    await receiver.close();
  }
});

test('custody cancellation: the Asset Manager cancels a pending record, which can no longer be confirmed', async ({ browser }, info) => {
  const mobile = info.project.name === 'mobile';
  const manager = await userPage(browser, 'manager', mobile);
  const receiver = await userPage(browser, 'viewer', mobile);
  try {
    const assetId = await newAsset(manager.page, `مكتب ${tag()}`);
    const custody = await pendingCustody(manager.page, assetId);

    await manager.page.goto(`/custodies/${custody.id}`);
    await manager.page.getByRole('button', { name: 'إلغاء المحضر' }).click();
    const dialog = manager.page.getByRole('dialog');
    await dialog.getByLabel('السبب *').fill('أُنشئ بالخطأ');
    await dialog.getByRole('button', { name: 'إلغاء المحضر' }).click();
    await expect(manager.page.getByText('ملغى', { exact: true })).toBeVisible();
    await expect(manager.page.getByText('أُنشئ بالخطأ')).toBeVisible();

    // The receiver no longer sees it awaiting confirmation, and the API refuses it.
    await receiver.page.goto('/');
    await expect(receiver.page.getByText(custody.number)).toHaveCount(0);
    expect((await receiver.page.request.post(`/api/v1/custodies/${custody.id}/confirm`)).status()).toBe(409);
  } finally {
    await manager.close();
    await receiver.close();
  }
});

test('custody return: new responsible and condition apply at once, with an official PDF', async ({ page }, info) => {
  await login(page, 'manager');
  const assetId = await newAsset(page, `كرسي ${tag()}`);

  await page.goto(`/assets/${assetId}`);
  await page.getByRole('link', { name: 'إرجاع عهدة' }).click();
  await expect(page.getByRole('heading', { name: 'محضر إرجاع جديد' })).toBeVisible();
  await page.getByLabel('الحالة عند الإرجاع').selectOption({ label: 'تالف' });
  await page.getByLabel('ابحث عن موظف').fill('رنا');
  await page.getByRole('button', { name: 'بحث', exact: true }).last().click();
  await page.getByRole('listitem').filter({ hasText: 'رنا عمر' }).getByRole('button', { name: 'اختيار' }).click();
  await page.getByRole('button', { name: 'تسجيل الإرجاع' }).click();

  await expect(page.getByRole('heading', { name: /RET-\d+/ })).toBeVisible();
  const pdf = page.getByRole('link', { name: 'المستند الرسمي (PDF)' });
  await expect(pdf).toBeVisible();
  expect((await page.request.get((await pdf.getAttribute('href'))!)).headers()['content-type']).toBe('application/pdf');
  await page.screenshot({ path: `test-results/screens/custody-return-${info.project.name}.png`, fullPage: true });

  const asset = await (await page.request.get(`/api/v1/assets/${assetId}`)).json();
  expect(asset).toMatchObject({ status: 'DAMAGED', responsibleEmployee: { fullName: 'رنا عمر' } });
});
