import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { App } from '../../App';
import { meResponse, mockApi, renderApp } from '../../test/render';

const MANAGER = ['assets.view', 'assets.create', 'assets.edit', 'assets.change_category', 'assets.edit_serial', 'qr.print', 'documents.view', 'documents.upload'];

const categories = [
  { code: 'OFF', nameAr: 'الأصول المكتبية', subcategories: [{ id: 'sub-off', name: 'مكاتب' }] },
  { code: 'TEC', nameAr: 'الأصول التقنية', subcategories: [{ id: 'sub-tec', name: 'حواسيب محمولة' }] },
];
const locations = [{ id: 'loc-1', name: 'المقر الرئيسي', departments: [{ id: 'dep-1', name: 'تقنية المعلومات' }] }];
const lookups = {
  'GET /lookups/categories': () => ({ status: 200, body: categories }),
  'GET /lookups/locations': () => ({ status: 200, body: locations }),
  'GET /lookups/currencies': () => ({ status: 200, body: [{ code: 'USD', nameAr: 'دولار', symbol: '$' }] }),
};

const detail = {
  id: 'a1',
  assetNumber: 'TEC-000010',
  name: 'حاسوب محمول',
  mainCategory: 'TEC',
  serialNumber: 'INT-SN-000003',
  serialIsInternal: true,
  qrToken: 'tok_abcdefghijklmnop',
  status: 'NEW',
  notes: null,
  purchaseDate: null,
  supplier: null,
  invoiceNumber: null,
  purchaseValue: null,
  purchaseCurrency: null,
  warrantyExists: false,
  warrantyExpiresAt: null,
  warrantyDetails: null,
  version: 3,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
  category: { code: 'TEC', nameAr: 'الأصول التقنية' },
  subcategory: { id: 'sub-tec', name: 'حواسيب محمولة', status: 'ACTIVE' },
  locationDepartment: { status: 'ACTIVE', location: { id: 'loc-1', name: 'المقر الرئيسي', status: 'ACTIVE' }, department: { id: 'dep-1', name: 'تقنية المعلومات', status: 'ACTIVE' } },
  responsibleEmployee: { id: 'e1', eapEmployeeId: 'EMP-1002', fullName: 'ليلى حسن', jobTitle: null, isActive: true },
  responsibleExternal: null,
  technical: { manufacturer: 'Dell', model: null, macAddress: null, ipAddress: null, operatingSystem: null, specifications: null },
  realEstate: null,
  numberHistory: [{ id: 'n1', assetNumber: 'TEC-000010', mainCategory: 'TEC', assignedAt: '2026-09-01T08:00:00.000Z', retiredAt: null, reason: 'إنشاء الأصل' }],
  serialHistory: [],
  photos: [],
  sale: null,
  canDelete: false,
};

describe('New asset', () => {
  it('validates in the browser, then sends the asset with its responsible person; status is never sent', async () => {
    const calls = mockApi({
      'GET /auth/me': meResponse(MANAGER),
      ...lookups,
      'GET /employees/directory': () => ({
        status: 200,
        body: [
          { eapEmployeeId: 'EMP-1007', fullName: 'موظف سابق', jobTitle: null, isActive: false },
          { eapEmployeeId: 'EMP-1002', fullName: 'ليلى حسن', jobTitle: 'مديرة', isActive: true },
        ],
      }),
      'POST /assets': () => ({ status: 201, body: { id: 'a1', assetNumber: 'TEC-000010' } }),
      'GET /assets/a1': () => ({ status: 200, body: detail }),
      'GET /assets/a1/qr.svg': () => ({ status: 200, body: '' }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/assets/new' });

    await user.click(await screen.findByRole('button', { name: 'حفظ الأصل' }));
    expect(screen.getByText('يرجى مراجعة الحقول المحددة.')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /assets')).toBe(false);

    await user.type(screen.getByLabelText('اسم الأصل *'), 'حاسوب محمول');
    await user.selectOptions(screen.getByLabelText('الفئة الرئيسية *'), 'TEC');
    await user.selectOptions(screen.getByLabelText('الفئة الفرعية *'), 'sub-tec');
    await user.selectOptions(screen.getByLabelText('الموقع *'), 'loc-1');
    await user.selectOptions(screen.getByLabelText('القسم *'), 'dep-1');
    expect(screen.getByRole('heading', { name: 'البيانات التقنية' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('الشركة المصنعة'), 'Dell');

    await user.type(screen.getByLabelText('ابحث عن موظف'), 'ليلى');
    await user.click(screen.getByRole('button', { name: 'بحث' }));
    const items = await screen.findAllByRole('listitem');
    const inactive = items.find((li) => within(li).queryByText('موظف سابق'))!;
    expect(within(inactive).getByRole('button', { name: 'اختيار' })).toBeDisabled();
    await user.click(within(items.find((li) => within(li).queryByText('ليلى حسن'))!).getByRole('button', { name: 'اختيار' }));

    await user.click(screen.getByRole('button', { name: 'حفظ الأصل' }));
    expect(await screen.findByRole('heading', { name: /TEC-000010/ })).toBeInTheDocument();
    const body = calls.find((c) => c.key === 'POST /assets')!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      name: 'حاسوب محمول',
      subcategoryId: 'sub-tec',
      locationId: 'loc-1',
      departmentId: 'dep-1',
      responsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1002' },
      technical: { manufacturer: 'Dell' },
    });
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('realEstate');
  });

  it('rejects an invalid MAC address before submitting', async () => {
    mockApi({ 'GET /auth/me': meResponse(MANAGER), ...lookups });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/assets/new' });
    await screen.findByRole('option', { name: /الأصول التقنية/ });
    await user.selectOptions(screen.getByLabelText('الفئة الرئيسية *'), 'TEC');
    await user.type(screen.getByLabelText('عنوان MAC'), 'not-a-mac');
    await user.click(screen.getByRole('button', { name: 'حفظ الأصل' }));
    expect(screen.getByText('عنوان MAC غير صالح.')).toBeInTheDocument();
  });
});

describe('Editing an asset', () => {
  it('shows old → new for each change before saving, and sends the version', async () => {
    const calls = mockApi({
      'GET /auth/me': meResponse(MANAGER),
      ...lookups,
      'GET /assets/a1': () => ({ status: 200, body: detail }),
      'GET /assets/a1/qr.svg': () => ({ status: 200, body: '' }),
      'PATCH /assets/a1': () => ({ status: 200, body: { id: 'a1', version: 4, changes: {} } }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/assets/a1/edit' });
    const manufacturer = await screen.findByLabelText('الشركة المصنعة');
    await user.clear(manufacturer);
    await user.type(manufacturer, 'HP');
    await user.click(screen.getByRole('button', { name: 'مراجعة وحفظ' }));

    const dialog = screen.getByRole('dialog', { name: 'مراجعة التغييرات قبل الحفظ' });
    const row = within(dialog).getByRole('row', { name: /الشركة المصنعة/ });
    expect(within(row).getByText('Dell')).toBeInTheDocument();
    expect(within(row).getByText('HP')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'PATCH /assets/a1')).toBe(false);

    await user.click(within(dialog).getByRole('button', { name: 'تأكيد الحفظ' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /assets/a1')).toBe(true));
    expect(calls.find((c) => c.key === 'PATCH /assets/a1')!.body).toMatchObject({ version: 3, technical: { manufacturer: 'HP' } });
  });
});

describe('Asset page', () => {
  it('shows the expected new number before a category change', async () => {
    mockApi({
      'GET /auth/me': meResponse(MANAGER),
      ...lookups,
      'GET /assets/a1': () => ({ status: 200, body: detail }),
      'GET /assets/a1/qr.svg': () => ({ status: 200, body: '' }),
      'GET /assets/a1/category-change': () => ({
        status: 200,
        body: { currentNumber: 'TEC-000010', expectedNumber: 'OFF-000042', numberChanges: true, fromCategory: 'TEC', toCategory: 'OFF' },
      }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/assets/a1' });
    await user.click(await screen.findByRole('button', { name: 'تغيير الفئة' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('الفئة الرئيسية الجديدة'), 'OFF');
    await user.selectOptions(within(dialog).getByLabelText('الفئة الفرعية الجديدة'), 'sub-off');
    expect(await within(dialog).findByText('OFF-000042')).toBeInTheDocument();
    expect(within(dialog).getByText(/لا يتغير رمز QR/)).toBeInTheDocument();
  });

  it('a sold asset shows a banner and offers no changes', async () => {
    mockApi({
      'GET /auth/me': meResponse(MANAGER),
      'GET /assets/a1': () => ({ status: 200, body: { ...detail, status: 'SOLD', sale: { id: 's1', number: 'SAL-000001', saleDate: '2026-09-20' } } }),
      'GET /assets/a1/qr.svg': () => ({ status: 200, body: '' }),
    });
    renderApp(<App />, { route: '/assets/a1' });
    expect(await screen.findByText(/تم بيع هذا الأصل/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'تعديل البيانات' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'تغيير الفئة' })).not.toBeInTheDocument();
    // QR printing remains available for sold assets (historical QR).
    expect(screen.getByRole('button', { name: 'طباعة ملصق QR' })).toBeInTheDocument();
  });

  it('warns when the responsible employee became inactive in EAP', async () => {
    mockApi({
      'GET /auth/me': meResponse(MANAGER),
      'GET /assets/a1': () => ({ status: 200, body: { ...detail, responsibleEmployee: { ...detail.responsibleEmployee, isActive: false } } }),
      'GET /assets/a1/qr.svg': () => ({ status: 200, body: '' }),
    });
    renderApp(<App />, { route: '/assets/a1' });
    expect(await screen.findByText(/أصبح غير فعّال في EAP/)).toBeInTheDocument();
  });
});

describe('Assets list', () => {
  it('prints QR labels for the selected assets', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({ location: { href: '' }, close: vi.fn() } as unknown as Window);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:labels');
    const calls = mockApi({
      'GET /auth/me': meResponse(MANAGER),
      ...lookups,
      'GET /assets': () => ({
        status: 200,
        body: {
          items: [
            { ...detail, id: 'a1', assetNumber: 'TEC-000010', mainPhotoFileId: null, technical: null },
            { ...detail, id: 'a2', assetNumber: 'TEC-000011', mainPhotoFileId: null, technical: null },
          ],
          total: 2,
          page: 1,
          pageSize: 25,
        },
      }),
      'POST /qr/labels': () => ({ status: 201, body: {} }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/assets' });
    await user.click(await screen.findByRole('checkbox', { name: 'تحديد TEC-000011' }));
    await user.click(screen.getByRole('button', { name: 'طباعة ملصقات QR (1)' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /qr/labels')).toBe(true));
    expect(calls.find((c) => c.key === 'POST /qr/labels')!.body).toEqual({ assetIds: ['a2'], perPage: 24 });
    expect(open).toHaveBeenCalled();
  });

  it('remembers hidden columns', async () => {
    mockApi({ 'GET /auth/me': meResponse(MANAGER), ...lookups, 'GET /assets': () => ({ status: 200, body: { items: [], total: 0, page: 1, pageSize: 25 } }) });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/assets' });
    await user.click(await screen.findByRole('button', { name: 'الأعمدة' }));
    await user.click(screen.getByRole('checkbox', { name: 'الرقم التسلسلي' }));
    expect(screen.queryByRole('columnheader', { name: 'الرقم التسلسلي' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('osooli.assets.hiddenColumns')!)).toContain('serial');
  });
});

describe('QR route', () => {
  it('/qr/{token} opens the asset page', async () => {
    mockApi({
      'GET /auth/me': meResponse(MANAGER),
      'GET /qr/resolve/tok_abcdefghijklmnop': () => ({ status: 200, body: { id: 'a1' } }),
      'GET /assets/a1': () => ({ status: 200, body: detail }),
      'GET /assets/a1/qr.svg': () => ({ status: 200, body: '' }),
    });
    renderApp(<App />, { route: '/qr/tok_abcdefghijklmnop' });
    expect(await screen.findByRole('heading', { name: /TEC-000010/ })).toBeInTheDocument();
  });
});
