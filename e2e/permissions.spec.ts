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

/**
 * Spec §82 through the deployed stack: hidden buttons are not the protection.
 * The viewer (assets.view only) calls sensitive endpoints directly with its
 * own session and must get 403 each time. The full route-by-route matrix is
 * in apps/api/test/permissions-matrix.test.ts.
 */
test('the viewer calling sensitive endpoints directly receives 403', async ({ page }) => {
  await login(page, 'viewer');
  const assets = await (await page.request.get('/api/v1/assets')).json();
  const asset = assets.items[0];
  const id = asset.id;
  const calls: Array<[string, string, unknown?]> = [
    ['POST', '/api/v1/assets', { name: 'x' }],
    ['PATCH', `/api/v1/assets/${id}`, { version: 1, name: 'تغيير غير مصرح' }],
    ['POST', `/api/v1/assets/${id}/category-change`, {}],
    ['POST', `/api/v1/assets/${id}/serial`, { serialNumber: 'X', version: 1 }],
    ['DELETE', `/api/v1/assets/${id}`],
    ['POST', '/api/v1/transfers', { assetId: id }],
    ['POST', '/api/v1/custodies', { items: [{ assetId: id }] }],
    ['POST', '/api/v1/custody-returns', { items: [] }],
    ['POST', '/api/v1/maintenances', {}],
    ['POST', '/api/v1/sales', { assetId: id }],
    ['POST', '/api/v1/inventories', { scopes: [] }],
    ['POST', '/api/v1/qr/labels', { assetIds: [id] }],
    ['GET', '/api/v1/users'],
    ['POST', '/api/v1/roles', { key: 'X', name: 'x' }],
    ['GET', '/api/v1/audit'],
    ['GET', '/api/v1/security/logs'],
    ['GET', '/api/v1/health/details'],
    ['GET', '/api/v1/reports'],
  ];
  const results: string[] = [];
  for (const [method, url, data] of calls) {
    const res = await page.request.fetch(url, { method, data });
    const body = await res.json().catch(() => ({}));
    if (res.status() !== 403 || body.error?.code !== 'FORBIDDEN') results.push(`${method} ${url} → ${res.status()}`);
  }
  expect(results).toEqual([]);

  // And nothing changed.
  const after = await (await page.request.get(`/api/v1/assets/${id}`)).json();
  expect(after.name).toBe(asset.name);
});

test('an account without the asset system is refused at sign-in, and a signed-out request gets 401', async ({ page }) => {
  expect((await page.request.get('/api/v1/assets')).status()).toBe(401);
  await page.goto('/login');
  await page.getByLabel('اسم المستخدم').fill('noaccess');
  await page.getByRole('button', { name: 'متابعة' }).click();
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'متابعة' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('رمز محاكاة البصمة')).toHaveCount(0);
});

test('key pages never scroll sideways at phone width', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Phone layout check');
  await login(page, 'manager');
  const asset = (await (await page.request.get('/api/v1/assets')).json()).items[0];
  const inventory = (await (await page.request.get('/api/v1/inventories')).json()).items[0];
  const pages = ['/', '/assets', `/assets/${asset.id}`, '/custodies', '/custody-returns', '/transfers', '/maintenances', '/sales', '/inventories', '/reports', '/offline', '/notifications', '/account/sessions'];
  if (inventory) pages.push(`/inventories/${inventory.id}`);
  const tabs = ['البيانات الأساسية', 'الصور', 'المستندات', 'السجل التاريخي'];
  const overflowing: string[] = [];
  const check = async (label: string) => {
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (wide > 1) overflowing.push(`${label} (+${wide}px)`);
  };
  for (const url of pages) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await check(url);
    if (url === `/assets/${asset.id}`) {
      for (const name of tabs) {
        const tab = page.getByRole('tab', { name: new RegExp(name) });
        if (await tab.count()) {
          await tab.first().click();
          await page.waitForLoadState('networkidle');
          await check(`${url} › ${name}`);
        }
      }
    }
  }
  expect(overflowing).toEqual([]);
});
