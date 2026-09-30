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

test('Asset Manager runs an inventory: scan, check, not found, close with official PDF', async ({ browser, page }, info) => {
  const tag = Math.random().toString(36).slice(2, 6);
  const locationName = `مخزن جرد ${tag}`;

  // Set up an isolated location with the administrator's API access.
  const adminContext = await browser.newContext({ baseURL: 'http://localhost:4173' });
  const admin = await adminContext.newPage();
  await login(admin, 'admin');
  const loc = await (await admin.request.post('/api/v1/locations', { data: { name: locationName } })).json();
  const dep = (await (await admin.request.get('/api/v1/lookups/locations')).json()).flatMap((l: { departments: Array<{ id: string }> }) => l.departments)[0];
  await admin.request.post(`/api/v1/locations/${loc.id}/departments`, { data: { departmentId: dep.id } });
  await adminContext.close();

  await login(page, 'manager');
  const cats = await (await page.request.get('/api/v1/lookups/categories')).json();
  const numbers: string[] = [];
  for (const name of ['رف تخزين', 'عربة نقل']) {
    const res = await page.request.post('/api/v1/assets', {
      data: { name, subcategoryId: cats.find((c: { code: string }) => c.code === 'OPR').subcategories[0].id, locationId: loc.id, departmentId: dep.id, responsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1002' } },
    });
    numbers.push((await res.json()).assetNumber);
  }

  await page.goto('/inventories/new');
  await page.getByLabel('الموقع').selectOption({ label: locationName });
  await page.getByRole('button', { name: 'بدء الجرد' }).click();
  await expect(page.getByRole('heading', { name: /جرد INV-\d+/ })).toBeVisible();
  await expect(page.getByText('فُحص 0 من 2')).toBeVisible();

  // First asset: "scanned" by typing its number.
  await page.getByRole('button', { name: 'مسح أصل' }).click();
  await page.getByLabel(/أو أدخل رقم الأصل/).fill(numbers[0]);
  await page.getByRole('dialog').getByRole('button', { name: 'بحث', exact: true }).click();
  await page.getByRole('dialog', { name: new RegExp(numbers[0]) }).getByRole('button', { name: 'حفظ الفحص' }).click();
  await expect(page.getByText('فُحص 1 من 2')).toBeVisible();

  // Second asset: not found.
  await page.getByRole('row', { name: new RegExp(numbers[1]) }).getByRole('button', { name: 'فحص' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /غير موجود/ }).check();
  await dialog.getByLabel('ملاحظات').fill('لم يُعثر عليها');
  await dialog.getByRole('button', { name: 'حفظ الفحص' }).click();
  await expect(page.getByText('فُحص 2 من 2')).toBeVisible();
  await page.getByRole('tab', { name: /غير موجود/ }).click();
  await expect(page.getByRole('row', { name: new RegExp(numbers[1]) })).toBeVisible();
  await page.screenshot({ path: `test-results/screens/inventory-${info.project.name}.png`, fullPage: true });

  await page.getByRole('button', { name: 'إغلاق الجرد' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'إغلاق الجرد نهائيًا' }).click();
  await expect(page.getByText('مغلق', { exact: true })).toBeVisible();
  const pdf = page.getByRole('link', { name: 'محضر الجرد (PDF)' });
  await expect(pdf).toBeVisible();
  expect((await page.request.get((await pdf.getAttribute('href'))!)).headers()['content-type']).toBe('application/pdf');
  await expect(page.getByRole('button', { name: 'مسح أصل' })).toHaveCount(0);
});

test('inventory discrepancy: a different department and status are shown, then applied to the asset on close', async ({ browser, page }) => {
  const tag = Math.random().toString(36).slice(2, 6);
  const adminContext = await browser.newContext({ baseURL: 'http://localhost:4173' });
  const admin = await adminContext.newPage();
  await login(admin, 'admin');
  const loc = await (await admin.request.post('/api/v1/locations', { data: { name: `مخزن فروقات ${tag}` } })).json();
  const deps = (await (await admin.request.get('/api/v1/lookups/locations')).json()).find((l: { name: string }) => l.name === 'المقر الرئيسي').departments as Array<{ id: string; name: string }>;
  const [expected, actual] = deps;
  for (const d of [expected, actual]) await admin.request.post(`/api/v1/locations/${loc.id}/departments`, { data: { departmentId: d.id } });
  await adminContext.close();

  await login(page, 'manager');
  const cats = await (await page.request.get('/api/v1/lookups/categories')).json();
  const asset = await (
    await page.request.post('/api/v1/assets', {
      data: { name: 'خزانة ملفات', subcategoryId: cats.find((c: { code: string }) => c.code === 'OFF').subcategories[0].id, locationId: loc.id, departmentId: expected.id, responsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1002' } },
    })
  ).json();
  const inv = await (await page.request.post('/api/v1/inventories', { data: { scopes: [{ locationId: loc.id }] } })).json();

  await page.goto(`/inventories/${inv.id}`);
  await page.getByRole('row', { name: new RegExp(asset.assetNumber) }).getByRole('button', { name: 'فحص' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('القسم الفعلي').selectOption({ label: actual.name });
  await dialog.getByLabel('الحالة الفعلية').selectOption({ label: 'تالف' });
  await dialog.getByRole('button', { name: 'حفظ الفحص' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('tab', { name: 'فروقات (1)' }).click();
  const row = page.getByRole('row', { name: new RegExp(asset.assetNumber) });
  await expect(row).toContainText(actual.name);
  await expect(row).toContainText('تالف');
  // Nothing changes on the asset until the inventory is closed.
  expect((await (await page.request.get(`/api/v1/assets/${asset.id}`)).json()).status).toBe('NEW');

  await page.getByRole('button', { name: 'إغلاق الجرد' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'إغلاق الجرد نهائيًا' }).click();
  await expect(page.getByText('مغلق', { exact: true })).toBeVisible();
  const after = await (await page.request.get(`/api/v1/assets/${asset.id}`)).json();
  expect(after.status).toBe('DAMAGED');
  expect(after.department?.id ?? after.locationDepartment?.department?.id).toBe(actual.id);
});
