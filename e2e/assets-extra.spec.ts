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

const tag = () => Math.random().toString(36).slice(2, 8).toUpperCase();

async function apiAsset(page: Page, name: string, serialNumber: string | null = null) {
  const cats = await (await page.request.get('/api/v1/lookups/categories')).json();
  const locs = await (await page.request.get('/api/v1/lookups/locations')).json();
  const loc = locs.find((l: { name: string }) => l.name === 'المقر الرئيسي');
  const res = await page.request.post('/api/v1/assets', {
    data: {
      name,
      serialNumber,
      subcategoryId: cats.find((c: { code: string }) => c.code === 'TEC').subcategories[0].id,
      locationId: loc.id,
      departmentId: loc.departments[0].id,
      responsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1002' },
    },
  });
  expect(res.status()).toBe(201);
  return res.json() as Promise<{ id: string; assetNumber: string; qrToken: string }>;
}

/** A minimal valid one-page PDF. */
function pdf(text: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>',
    `<< /Length ${text.length + 20} >>\nstream\nBT 72 760 Td (${text}) Tj ET\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

test('serial numbers are unique: creating or changing to a used serial shows an Arabic error', async ({ page }) => {
  await login(page, 'manager');
  const serial = `SN-${tag()}`;
  await apiAsset(page, 'جهاز أصلي', serial);

  await page.goto('/assets/new');
  await page.getByLabel('اسم الأصل *').fill('جهاز مكرر');
  await page.getByLabel('الفئة الرئيسية *').selectOption('TEC');
  await page.getByLabel('الفئة الفرعية *').selectOption({ index: 1 });
  await page.getByLabel('الرقم التسلسلي').fill(serial);
  await page.getByLabel('الموقع *').selectOption({ label: 'المقر الرئيسي' });
  await page.getByLabel('القسم *').selectOption({ label: 'تقنية المعلومات' });
  await page.getByLabel('ابحث عن موظف').fill('ليلى');
  await page.getByRole('button', { name: 'بحث', exact: true }).click();
  await page.getByRole('listitem').filter({ hasText: 'ليلى حسن' }).getByRole('button', { name: 'اختيار' }).click();
  await page.getByRole('button', { name: 'حفظ الأصل' }).click();
  // Shown in the form alert and next to the field.
  await expect(page.getByText('الرقم التسلسلي مستخدم لأصل آخر.').first()).toBeVisible();
  await expect(page).toHaveURL(/\/assets\/new$/);

  // Changing another asset's serial to the used one is refused the same way.
  const other = await apiAsset(page, 'جهاز آخر');
  await page.goto(`/assets/${other.id}`);
  await page.getByRole('button', { name: 'تعديل الرقم التسلسلي' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('الرقم التسلسلي الجديد').fill(serial);
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog.getByText('الرقم التسلسلي مستخدم لأصل آخر.').first()).toBeVisible();
});

test('QR: the label prints as a PDF, the code opens the asset, and an unknown code is explained', async ({ page }) => {
  await login(page, 'manager');
  const created = await apiAsset(page, 'جهاز بملصق');
  const asset = await (await page.request.get(`/api/v1/assets/${created.id}`)).json();

  await page.goto(`/assets/${asset.id}`);
  await expect(page.getByRole('img', { name: `رمز QR للأصل ${asset.assetNumber}` })).toBeVisible();
  // The QR identity is a random token, never the asset number (spec §9).
  expect(asset.qrToken).not.toContain(asset.assetNumber);
  const labelResponse = page.waitForResponse((r) => r.url().endsWith('/api/v1/qr/labels'));
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'طباعة ملصق QR' }).click();
  const res = await labelResponse;
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toBe('application/pdf');
  await (await popup).close();

  await page.goto(`/qr/${asset.qrToken}`);
  await expect(page.getByRole('heading', { name: new RegExp(asset.assetNumber) })).toBeVisible();
  await page.goto('/qr/not-a-real-token');
  await expect(page.getByRole('heading', { name: 'رمز QR غير معروف' })).toBeVisible();
});

test('documents: upload, add a new version (old one kept), and unsafe files are rejected', async ({ page }, info) => {
  await login(page, 'manager');
  const asset = await apiAsset(page, 'جهاز بمستندات');
  await page.goto(`/assets/${asset.id}`);
  await page.getByRole('tab', { name: /المستندات/ }).click();

  await page.getByRole('button', { name: 'إضافة مستند' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('اسم المستند').fill('عقد الضمان');
  await dialog.getByLabel('الملف').setInputFiles({ name: 'عقد.pdf', mimeType: 'application/pdf', buffer: pdf('v1') });
  await dialog.getByRole('button', { name: 'رفع' }).click();
  await expect(page.getByRole('link', { name: 'عقد.pdf' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'رفع نسخة جديدة' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('الملف').setInputFiles({ name: 'عقد-محدث.pdf', mimeType: 'application/pdf', buffer: pdf('v2') });
  await dialog.getByRole('button', { name: 'رفع' }).click();
  await expect(page.getByRole('row', { name: /v2.*الحالية/ })).toContainText('عقد-محدث.pdf');
  await expect(page.getByRole('row', { name: /v1/ })).toContainText('عقد.pdf');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const href = await page.getByRole('link', { name: 'عقد.pdf' }).getAttribute('href');
  expect((await page.request.get(href!)).headers()['content-type']).toBe('application/pdf');
  await page.screenshot({ path: `test-results/screens/asset-documents-${info.project.name}.png`, fullPage: true });

  // A program disguised as a PDF is refused by content, not by its name.
  await page.getByRole('button', { name: 'إضافة مستند' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('اسم المستند').fill('ملف مشبوه');
  await dialog.getByLabel('الملف').setInputFiles({ name: 'فاتورة.pdf', mimeType: 'application/pdf', buffer: Buffer.from('MZ\x90\x00 not really a pdf', 'latin1') });
  await dialog.getByRole('button', { name: 'رفع' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(page.getByText('ملف مشبوه')).toHaveCount(0);
});
