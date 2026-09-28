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

test('reports: preview, then export PDF and Excel as real downloads', async ({ page }, info) => {
  await login(page, 'manager');
  await page.goto('/reports');
  await page.getByRole('link', { name: /الأصول حسب الحالة/ }).click();
  await page.getByRole('button', { name: 'عرض التقرير' }).click();
  await expect(page.getByRole('cell', { name: 'قيد الاستخدام' })).toBeVisible();
  await expect(page.getByText(/إجمالي الأصول/)).toBeVisible();
  await page.screenshot({ path: `test-results/screens/report-${info.project.name}.png`, fullPage: true });

  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'تصدير PDF' }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/الأصول حسب الحالة .*\.pdf$/);
  await pdf.saveAs(`test-results/screens/report-${info.project.name}.pdf`);

  const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'تصدير Excel' }).click()]);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
});

test('the receiver of a custody sees an unread notification that links to the record', async ({ browser, page }) => {
  await login(page, 'manager');
  const cats = await (await page.request.get('/api/v1/lookups/categories')).json();
  const locs = await (await page.request.get('/api/v1/lookups/locations')).json();
  const loc = locs.find((l: { departments: unknown[] }) => l.departments.length);
  const asset = await (
    await page.request.post('/api/v1/assets', {
      data: { name: 'جهاز إشعار', subcategoryId: cats.find((c: { code: string }) => c.code === 'TEC').subcategories[0].id, locationId: loc.id, departmentId: loc.departments[0].id, responsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1002' } },
    })
  ).json();
  const custody = await (
    await page.request.post('/api/v1/custodies', { data: { newResponsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1003' }, items: [{ assetId: asset.id, condition: 'NEW' }] } })
  ).json();

  const context = await browser.newContext({ baseURL: 'http://localhost:4173' });
  const receiver = await context.newPage();
  await login(receiver, 'viewer');
  await receiver.getByRole('banner').getByRole('link', { name: /الإشعارات: \d+ غير مقروء/ }).click();
  await receiver.getByRole('link', { name: new RegExp(custody.number) }).click();
  await expect(receiver.getByRole('heading', { name: new RegExp(custody.number) })).toBeVisible();
  await context.close();
});

test('advanced search can be saved and re-applied', async ({ page }) => {
  const name = `بحث متقدم ${Math.random().toString(36).slice(2, 6)}`;
  await login(page, 'manager');
  await page.goto('/assets');
  await page.getByRole('button', { name: 'بحث متقدم' }).click();
  await page.getByRole('group', { name: 'بحث متقدم' }).getByRole('checkbox', { name: 'جديد' }).check();
  await page.getByRole('button', { name: 'حفظ البحث الحالي' }).click();
  await page.getByRole('dialog').getByLabel('اسم البحث').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click();

  await page.goto('/assets');
  await page.getByLabel('عمليات البحث المحفوظة').selectOption({ label: name });
  await expect(page).toHaveURL(/statusIn=NEW/);
});
