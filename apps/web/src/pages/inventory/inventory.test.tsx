import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { meResponse, mockApi, renderApp } from '../../test/render';

const MANAGER = ['assets.view', 'inventory.view', 'inventory.manage'];

const item = {
  id: 'i1',
  exists: null,
  checkedAt: null,
  confirmedByQr: false,
  hasDiscrepancy: false,
  notes: null,
  photoId: null,
  expectedStatus: 'IN_USE',
  actualStatus: null,
  asset: { id: 'a1', assetNumber: 'TEC-000010', name: 'حاسوب', serialNumber: 'SN-1' },
  expectedLocation: { id: 'loc-1', name: 'المقر الرئيسي' },
  expectedDepartment: { id: 'dep-1', name: 'تقنية المعلومات' },
  actualLocation: null,
  actualDepartment: null,
  expectedResponsibleEmployee: { fullName: 'ليلى حسن' },
  expectedResponsibleExternal: null,
  actualResponsibleEmployee: null,
  actualResponsibleExternal: null,
};

const inventory = (unchecked: number) => ({
  id: 'inv1',
  number: 'INV-000003',
  status: 'IN_PROGRESS',
  notes: null,
  createdAt: '2026-09-27T08:00:00.000Z',
  createdByName: 'ليلى حسن',
  closedAt: null,
  closedByName: null,
  scopes: [{ locationId: 'loc-1', departmentId: null, location: { name: 'المقر الرئيسي' }, department: null }],
  reopenings: [],
  unregistered: [],
  counts: { total: 1, checked: 1 - unchecked, unchecked, found: 0, notFound: 0, discrepancies: 0, unregistered: 0 },
  officialFileId: null,
  officialVersion: null,
});

const routes = (unchecked = 1) => ({
  'GET /auth/me': meResponse(MANAGER),
  'GET /inventories/inv1': () => ({ status: 200, body: inventory(unchecked) }),
  'GET /inventories/inv1/items': () => ({ status: 200, body: { items: [item], total: 1, page: 1, pageSize: 25 } }),
  'GET /lookups/locations': () => ({ status: 200, body: [{ id: 'loc-1', name: 'المقر الرئيسي', departments: [{ id: 'dep-1', name: 'تقنية المعلومات' }] }] }),
});

describe('Inventory counting', () => {
  it('a scanned QR opens the check for that asset and records it as QR-confirmed', async () => {
    const calls = mockApi({
      ...routes(),
      'POST /inventories/inv1/scan': () => ({ status: 200, body: { kind: 'ITEM', item, viaQr: true } }),
      'POST /inventories/inv1/items/i1/check': () => ({ status: 200, body: { ...item, exists: true, checkedAt: '2026-09-27T09:00:00.000Z' } }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/inventories/inv1' });
    await user.click(await screen.findByRole('button', { name: 'مسح أصل' }));
    await user.type(screen.getByLabelText(/أو أدخل رقم الأصل/), 'https://x/qr/tok123');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'بحث' }));

    const dialog = await screen.findByRole('dialog', { name: /فحص TEC-000010/ });
    expect(within(dialog).getByText('تم التعرف على الأصل بمسح رمز QR.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'حفظ الفحص' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /inventories/inv1/items/i1/check')).toBe(true));
    const body = calls.find((c) => c.key === 'POST /inventories/inv1/items/i1/check')!.body as FormData;
    expect(body.get('exists')).toBe('true');
    expect(body.get('confirmedByQr')).toBe('true');
    expect(body.get('actualLocationId')).toBe('loc-1');
    expect(calls.find((c) => c.key === 'POST /inventories/inv1/scan')!.body).toEqual({ code: 'https://x/qr/tok123' });
  });

  it('marking an asset "not found" explains that its status will not change', async () => {
    mockApi(routes());
    const user = userEvent.setup();
    renderApp(<App />, { route: '/inventories/inv1' });
    await user.click(await screen.findByRole('button', { name: 'فحص' }));
    await user.click(screen.getByRole('radio', { name: /غير موجود/ }));
    expect(screen.getByText(/لا تتغير حالته تلقائيًا/)).toBeInTheDocument();
    expect(screen.queryByLabelText('الموقع الفعلي')).not.toBeInTheDocument();
  });

  it('an unknown code offers to record an unregistered asset, without creating one', async () => {
    const calls = mockApi({
      ...routes(),
      'POST /inventories/inv1/scan': () => ({ status: 200, body: { kind: 'UNKNOWN', code: 'XYZ-99' } }),
      'POST /inventories/inv1/unregistered': () => ({ status: 201, body: {} }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/inventories/inv1' });
    await user.click(await screen.findByRole('button', { name: 'مسح أصل' }));
    await user.type(screen.getByLabelText(/أو أدخل رقم الأصل/), 'XYZ-99');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'بحث' }));
    const dialog = await screen.findByRole('dialog', { name: 'أصل غير مسجل' });
    expect(within(dialog).getByText(/لا يُنشأ أصل جديد تلقائيًا/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('وصف الأصل *'), 'طابعة بلا ملصق');
    await user.click(within(dialog).getByRole('button', { name: 'تسجيل' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /inventories/inv1/unregistered')).toBe(true));
    expect((calls.find((c) => c.key === 'POST /inventories/inv1/unregistered')!.body as FormData).get('scannedCode')).toBe('XYZ-99');
  });

  it('closing explains that unchecked assets block it', async () => {
    mockApi(routes(1));
    const user = userEvent.setup();
    renderApp(<App />, { route: '/inventories/inv1' });
    await user.click(await screen.findByRole('button', { name: 'إغلاق الجرد' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('لم يُفحص 1 أصل بعد');
  });
});
