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

/** An isolated location with two assets and an open inventory over it. */
async function setUp(browser: Browser) {
  const tag = Math.random().toString(36).slice(2, 6);
  const context = await browser.newContext({ baseURL: 'http://localhost:4173' });
  const admin = await context.newPage();
  await login(admin, 'admin');
  const loc = await (await admin.request.post('/api/v1/locations', { data: { name: `مخزن بدون اتصال ${tag}` } })).json();
  const dep = (await (await admin.request.get('/api/v1/lookups/locations')).json()).flatMap((l: { departments: Array<{ id: string }> }) => l.departments)[0];
  await admin.request.post(`/api/v1/locations/${loc.id}/departments`, { data: { departmentId: dep.id } });
  const cats = await (await admin.request.get('/api/v1/lookups/categories')).json();
  const numbers: string[] = [];
  for (const name of ['طابعة ميدانية', 'ماسح ضوئي']) {
    const res = await admin.request.post('/api/v1/assets', {
      data: { name, subcategoryId: cats.find((c: { code: string }) => c.code === 'TEC').subcategories[0].id, locationId: loc.id, departmentId: dep.id, responsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1002' } },
    });
    numbers.push((await res.json()).assetNumber);
  }
  const inv = await (await admin.request.post('/api/v1/inventories', { data: { scopes: [{ locationId: loc.id }] } })).json();
  const items = (await (await admin.request.get(`/api/v1/inventories/${inv.id}/items`)).json()).items as Array<{ id: string; asset: { assetNumber: string } }>;
  return { admin, context, inv, numbers, items };
}

test('offline inventory: check without network, survive a reload, sync on reconnect; a conflict needs review', async ({ browser, page, context }, info) => {
  const { admin, context: adminContext, inv, numbers, items } = await setUp(browser);

  await login(page, 'manager');
  // The app shell must be cached by the service worker before going offline.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.goto('/offline');
  await page.getByRole('button', { name: 'تنزيل البيانات للعمل بدون اتصال' }).click();
  await expect(page.getByText(/تم تنزيل \d+ أصلًا/)).toBeVisible();
  await page.getByRole('link', { name: inv.number }).click();
  await expect(page.getByRole('heading', { name: new RegExp(inv.number) })).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText('أنت غير متصل بالشبكة')).toBeVisible();

  // First asset: found by its number.
  await page.getByRole('button', { name: 'مسح QR' }).click();
  await page.getByLabel(/أو أدخل رقم الأصل/).fill(numbers[0]);
  await page.getByRole('dialog').getByRole('button', { name: 'بحث', exact: true }).click();
  await page.getByRole('dialog', { name: new RegExp(numbers[0]) }).getByRole('button', { name: 'حفظ الفحص' }).click();
  // Second asset: recorded as not found.
  await page.getByRole('row', { name: new RegExp(numbers[1]) }).getByRole('button', { name: 'فحص' }).click();
  await page.getByRole('dialog').getByRole('radio', { name: /غير موجود/ }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ الفحص' }).click();
  await expect(page.getByText(`فُحص 2 من 2`)).toBeVisible();
  await expect(page.getByRole('link', { name: 'المزامنة: 2 بانتظار المزامنة' })).toBeVisible();

  // Meanwhile another user checks the second asset online.
  const second = items.find((i) => i.asset.assetNumber === numbers[1])!;
  expect((await admin.request.post(`/api/v1/inventories/${inv.id}/items/${second.id}/check`, { multipart: { exists: 'true', notes: 'وُجد في المكتب' } })).ok()).toBe(true);

  // A reload while offline still opens the app and keeps the queue.
  await page.reload();
  await expect(page.getByRole('heading', { name: new RegExp(inv.number) })).toBeVisible();
  await expect(page.getByRole('link', { name: 'المزامنة: 2 بانتظار المزامنة' })).toBeVisible();
  await page.screenshot({ path: `test-results/screens/offline-inventory-${info.project.name}.png`, fullPage: true });

  await context.setOffline(false);
  await expect(page.getByRole('link', { name: 'المزامنة: 0 بانتظار المزامنة، 1 تحتاج مراجعة' })).toBeVisible({ timeout: 15_000 });

  // The first check reached the server; the other user's result was not overwritten.
  const serverItems = (await (await admin.request.get(`/api/v1/inventories/${inv.id}/items`)).json()).items as Array<{ id: string; exists: boolean; notes: string | null; asset: { assetNumber: string } }>;
  expect(serverItems.find((i) => i.asset.assetNumber === numbers[0])!.exists).toBe(true);
  expect(serverItems.find((i) => i.id === second.id)).toMatchObject({ exists: true, notes: 'وُجد في المكتب' });

  await page.getByRole('link', { name: /المزامنة:/ }).click();
  const row = page.getByRole('row', { name: new RegExp(numbers[1]) });
  await expect(row.getByText('تحتاج مراجعة')).toBeVisible();
  await expect(row).toContainText('فُحص هذا الأصل من مستخدم آخر');
  await expect(page.getByRole('row', { name: new RegExp(numbers[0]) }).getByText('تمت المزامنة')).toBeVisible();
  await page.screenshot({ path: `test-results/screens/offline-queue-${info.project.name}.png`, fullPage: true });
  await row.getByRole('button', { name: 'تمت المراجعة' }).click();
  await expect(page.getByRole('link', { name: /المزامنة:/ })).toHaveCount(0);
  await adminContext.close();
});

test('offline start in a new tab, QR lookup with photo and note, failed sync then retry, and clearing local data', async ({ page, context }, info) => {
  await login(page, 'manager');
  const cats = await (await page.request.get('/api/v1/lookups/categories')).json();
  const locs = await (await page.request.get('/api/v1/lookups/locations')).json();
  const loc = locs.find((l: { name: string }) => l.name === 'المقر الرئيسي');
  const created = await (
    await page.request.post('/api/v1/assets', {
      data: { name: 'جهاز عرض ميداني', subcategoryId: cats.find((c: { code: string }) => c.code === 'TEC').subcategories[0].id, locationId: loc.id, departmentId: loc.departments[0].id, responsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1002' } },
    })
  ).json();
  const asset = await (await page.request.get(`/api/v1/assets/${created.id}`)).json();

  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.goto('/offline');
  await page.getByRole('button', { name: 'تنزيل البيانات للعمل بدون اتصال' }).click();
  await expect(page.getByText(/تم تنزيل \d+ أصلًا/)).toBeVisible();

  // Offline start: a brand-new tab opens the app with no network at all.
  await context.setOffline(true);
  await page.close();
  const tab = await context.newPage();
  await tab.goto('/offline/lookup');
  await expect(tab.getByRole('heading', { name: 'البحث عن أصل بدون اتصال' })).toBeVisible();

  // The scanned QR content is the /qr/{token} link printed on the label.
  await tab.getByLabel(/أو أدخل رقم الأصل/).fill(`https://assets.example/qr/${asset.qrToken}`);
  await tab.getByRole('button', { name: 'بحث', exact: true }).click();
  await expect(tab.getByRole('heading', { name: /جهاز عرض ميداني/ })).toBeVisible();
  await tab.getByLabel('ملاحظات الأصل').fill('الملصق باهت ويحتاج استبدالًا');
  await tab.getByRole('button', { name: 'حفظ الملاحظات' }).click();
  await expect(tab.getByText(/حُفظت الملاحظات على الجهاز/)).toBeVisible();
  await tab.getByLabel('إضافة صورة').setInputFiles({ name: 'ملصق.png', mimeType: 'image/png', buffer: PNG });
  await tab.getByRole('button', { name: 'حفظ الصورة' }).click();
  await expect(tab.getByRole('link', { name: 'المزامنة: 2 بانتظار المزامنة' })).toBeVisible();

  // Failed sync: the server is unavailable when the connection returns.
  await tab.route('**/api/v1/sync/operations/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await context.setOffline(false);
  await tab.goto('/offline');
  // One attempt when the connection returns and another when the page opens: either order is fine.
  await expect(tab.getByText(/محاولات: [1-9]/).first()).toBeVisible({ timeout: 15_000 });
  await expect(tab.getByRole('link', { name: 'المزامنة: 2 بانتظار المزامنة' })).toBeVisible();

  // Retry once the server is back: both operations go through.
  await tab.unroute('**/api/v1/sync/operations/**');
  await tab.getByRole('button', { name: 'مزامنة الآن' }).click();
  await expect(tab.getByText('تمت مزامنة 2.')).toBeVisible();
  await expect(tab.getByRole('link', { name: /المزامنة:/ })).toHaveCount(0);
  const server = await (await tab.request.get(`/api/v1/assets/${created.id}`)).json();
  expect(server.notes).toBe('الملصق باهت ويحتاج استبدالًا');
  expect(server.photos ?? server.assetPhotos).toHaveLength(1);
  await tab.screenshot({ path: `test-results/screens/offline-center-${info.project.name}.png`, fullPage: true });

  // Clear local data.
  await tab.getByRole('button', { name: 'حذف البيانات المحلية' }).click();
  await tab.getByRole('dialog').getByRole('button', { name: 'حذف البيانات المحلية' }).click();
  await expect(tab.getByText('حُذفت البيانات المحلية من هذا الجهاز.')).toBeVisible();
  await expect(tab.getByText('لم تُنزَّل بيانات بعد')).toBeVisible();
  await expect(tab.getByText('لا توجد عمليات محفوظة على هذا الجهاز.')).toBeVisible();
  await tab.goto('/offline/lookup');
  await expect(tab.getByText(/لا توجد بيانات محلية/)).toBeVisible();
});
