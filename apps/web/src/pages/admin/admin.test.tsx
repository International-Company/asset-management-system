import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { meResponse, mockApi, renderApp } from '../../test/render';

const ADMIN = [
  'dashboard.view',
  'users.view',
  'users.manage',
  'roles.manage',
  'categories.manage',
  'locations.manage',
  'departments.manage',
  'external_people.view',
  'external_people.manage',
  'settings.manage',
  'audit.view',
  'security.view',
];

const page = <T,>(items: T[]) => () => ({ status: 200, body: { items, total: items.length, page: 1, pageSize: 25 } });

const roles = [
  { id: 'r-admin', key: 'SYSTEM_ADMINISTRATOR', name: 'مدير النظام', status: 'ACTIVE', isSystem: true, description: null, permissionKeys: ['assets.view', 'users.view'], activeUserCount: 1 },
  { id: 'r-mgr', key: 'ASSET_MANAGER', name: 'مدير الأصول', status: 'ACTIVE', isSystem: true, description: null, permissionKeys: ['assets.view'], activeUserCount: 2 },
];

describe('Navigation by permission', () => {
  it('Asset Manager sees external people but none of the administrator screens', async () => {
    mockApi({ 'GET /auth/me': meResponse(['assets.view', 'external_people.view']) });
    renderApp(<App />);
    await screen.findByRole('heading', { name: /مرحبًا/ });
    expect(screen.getByRole('link', { name: 'المسؤولون الخارجيون' })).toBeInTheDocument();
    for (const name of ['المستخدمون', 'الأدوار والصلاحيات', 'الإعدادات', 'سجل التدقيق']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
  });

  it('opening an admin URL without permission shows permission denied', async () => {
    mockApi({ 'GET /auth/me': meResponse(['assets.view']) });
    renderApp(<App />, { route: '/admin/settings' });
    expect(await screen.findByRole('heading', { name: 'لا تملك صلاحية الوصول' })).toBeInTheDocument();
  });
});

describe('Users', () => {
  it('adds a user from the EAP directory with the chosen roles', async () => {
    const calls = mockApi({
      'GET /auth/me': meResponse(ADMIN, ['SYSTEM_ADMINISTRATOR']),
      'GET /users': page([]),
      'GET /roles': () => ({ status: 200, body: roles }),
      'GET /employees/directory': () => ({
        status: 200,
        body: [
          { eapEmployeeId: 'EMP-1', fullName: 'موظف له حساب', jobTitle: null, email: null, isActive: true, employeeId: 'e1', user: { id: 'u1', username: 'x' } },
          { eapEmployeeId: 'EMP-2', fullName: 'رنا عمر', jobTitle: 'منسقة', email: null, isActive: true, employeeId: null, user: null },
        ],
      }),
      'POST /users': () => ({ status: 201, body: { id: 'new-user' } }),
      'GET /users/new-user': () => ({
        status: 200,
        body: {
          id: 'new-user',
          username: 'rana',
          isActive: true,
          lockedUntil: null,
          lastLoginAt: null,
          createdAt: new Date().toISOString(),
          employee: { id: 'e2', eapEmployeeId: 'EMP-2', fullName: 'رنا عمر', jobTitle: 'منسقة', email: null, isActive: true },
          roles: [roles[1]],
        },
      }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/admin/users' });

    await user.click(await screen.findByRole('button', { name: 'إضافة مستخدم' }));
    await user.type(screen.getByLabelText('ابحث عن موظف في EAP'), 'رنا');
    await user.click(screen.getByRole('button', { name: 'بحث' }));

    const rows = await screen.findAllByRole('row');
    const existing = rows.find((r) => within(r).queryByText('موظف له حساب'))!;
    expect(within(existing).getByRole('button', { name: 'اختيار' })).toBeDisabled();
    const target = rows.find((r) => within(r).queryByText('رنا عمر'))!;
    await user.click(within(target).getByRole('button', { name: 'اختيار' }));

    await user.type(screen.getByLabelText('اسم المستخدم في EAP'), 'rana');
    await user.click(screen.getByRole('checkbox', { name: 'مدير الأصول' }));
    await user.click(screen.getByRole('button', { name: 'إنشاء الحساب' }));

    expect(await screen.findByRole('heading', { name: 'رنا عمر' })).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /users')?.body).toEqual({ eapEmployeeId: 'EMP-2', username: 'rana', roleIds: ['r-mgr'] });
  });

  it('shows the server field error next to the username', async () => {
    mockApi({
      'GET /auth/me': meResponse(ADMIN, ['SYSTEM_ADMINISTRATOR']),
      'GET /users': page([]),
      'GET /roles': () => ({ status: 200, body: roles }),
      'GET /employees/directory': () => ({
        status: 200,
        body: [{ eapEmployeeId: 'EMP-2', fullName: 'رنا عمر', jobTitle: null, email: null, isActive: true, employeeId: null, user: null }],
      }),
      'POST /users': () => ({
        status: 400,
        body: { error: { code: 'VALIDATION_ERROR', message: 'البيانات المدخلة غير صحيحة.', fields: { username: ['الصيغة غير صحيحة.'] } } },
      }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/admin/users' });
    await user.click(await screen.findByRole('button', { name: 'إضافة مستخدم' }));
    await user.type(screen.getByLabelText('ابحث عن موظف في EAP'), 'رنا');
    await user.click(screen.getByRole('button', { name: 'بحث' }));
    await user.click(await screen.findByRole('button', { name: 'اختيار' }));
    await user.type(screen.getByLabelText('اسم المستخدم في EAP'), 'bad name');
    await user.click(screen.getByRole('button', { name: 'إنشاء الحساب' }));
    expect(await screen.findByText('الصيغة غير صحيحة.')).toBeInTheDocument();
    expect(screen.getByLabelText('اسم المستخدم في EAP')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('Roles', () => {
  it('the System Administrator role is read-only', async () => {
    mockApi({
      'GET /auth/me': meResponse(ADMIN, ['SYSTEM_ADMINISTRATOR']),
      'GET /roles': () => ({ status: 200, body: roles }),
      'GET /roles/permissions': () => ({
        status: 200,
        body: [
          { key: 'assets.view', label: 'عرض الأصول', group: 'assets' },
          { key: 'users.view', label: 'عرض المستخدمين', group: 'users' },
        ],
      }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/admin/roles' });
    await user.click(await screen.findByRole('button', { name: 'عرض' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: 'عرض الأصول' })).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'حفظ' })).not.toBeInTheDocument();
  });

  it('saves the chosen permissions for a role', async () => {
    const calls = mockApi({
      'GET /auth/me': meResponse(ADMIN, ['SYSTEM_ADMINISTRATOR']),
      'GET /roles': () => ({ status: 200, body: roles }),
      'GET /roles/permissions': () => ({
        status: 200,
        body: [
          { key: 'assets.view', label: 'عرض الأصول', group: 'assets' },
          { key: 'assets.create', label: 'إنشاء أصل', group: 'assets' },
        ],
      }),
      'PATCH /roles/r-mgr': () => ({ status: 200, body: {} }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/admin/roles' });
    await user.click(await screen.findByRole('button', { name: 'تعديل' }));
    await user.click(screen.getByRole('checkbox', { name: 'إنشاء أصل' }));
    await user.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /roles/r-mgr')).toBe(true));
    expect(calls.find((c) => c.key === 'PATCH /roles/r-mgr')?.body).toMatchObject({ permissionKeys: ['assets.view', 'assets.create'] });
  });
});

describe('Categories', () => {
  it('lists the subcategories of the selected main category only', async () => {
    const calls = mockApi({
      'GET /auth/me': meResponse(ADMIN, ['SYSTEM_ADMINISTRATOR']),
      'GET /categories': () => ({ status: 200, body: [] }),
      'GET /categories/subcategories': page([{ id: 's1', name: 'مكاتب', mainCategory: 'OFF', status: 'ACTIVE', assetCount: 3 }]),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/admin/categories' });
    expect(await screen.findByText('مكاتب')).toBeInTheDocument();
    expect(calls.some((c) => c.key.startsWith('GET /categories/subcategories') && c.key.includes('mainCategory=OFF'))).toBe(true);
    // A used subcategory offers disabling, not deletion.
    expect(screen.queryByRole('button', { name: 'حذف' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /الأصول التقنية/ }));
    await waitFor(() => expect(calls.some((c) => c.key.includes('mainCategory=TEC'))).toBe(true));
  });
});

describe('Settings', () => {
  it('validates in the browser first, then sends only the changed values and shows server field errors', async () => {
    const values = {
      'company.nameAr': 'شركة',
      'company.nameEn': 'Co',
      'currency.default': 'ILS',
      'files.maxSizeMb': 10,
      'files.allowedExtensions': ['pdf'],
      'security.maxFailedAttempts': 5,
      'security.lockoutMinutes': 15,
      'security.sessionIdleMinutes': 30,
      'security.sessionMaxHours': 12,
    };
    const calls = mockApi({
      'GET /auth/me': meResponse(ADMIN, ['SYSTEM_ADMINISTRATOR']),
      'GET /settings': () => ({ status: 200, body: { values, allowableExtensions: ['pdf', 'png'] } }),
      'PATCH /settings': () => ({
        status: 400,
        body: { error: { code: 'VALIDATION_ERROR', message: 'البيانات المدخلة غير صحيحة.', fields: { 'security.maxFailedAttempts': ['رفض الخادم هذه القيمة.'] } } },
      }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/admin/settings?tab=security' });
    const input = await screen.findByLabelText('عدد محاولات الدخول الفاشلة قبل القفل');
    await user.clear(input);
    await user.type(input, '2');
    await user.click(screen.getByRole('button', { name: 'حفظ التغييرات' }));
    expect(await screen.findByText('رقم صحيح من 3 إلى 20.')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'PATCH /settings')).toBe(false);

    await user.clear(input);
    await user.type(input, '6');
    await user.click(screen.getByRole('button', { name: 'حفظ التغييرات' }));
    expect(await screen.findByText('رفض الخادم هذه القيمة.')).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'PATCH /settings')?.body).toEqual({ values: { 'security.maxFailedAttempts': 6 } });
  });
});

describe('Audit log', () => {
  it('shows Arabic operation names and the old → new values', async () => {
    mockApi({
      'GET /auth/me': meResponse(ADMIN, ['SYSTEM_ADMINISTRATOR']),
      'GET /audit/facets': () => ({ status: 200, body: { entityTypes: ['Location'], operations: ['LOCATION_UPDATED'] } }),
      'GET /audit': page([
        {
          id: '1',
          actorId: 'u1',
          actorName: 'سامي الأحمد',
          operation: 'LOCATION_UPDATED',
          entityType: 'Location',
          entityId: 'loc-1',
          oldData: { name: 'فرع قديم' },
          newData: { name: 'فرع جديد' },
          metadata: {},
          createdAt: new Date().toISOString(),
        },
      ]),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/admin/audit' });
    expect(await screen.findByRole('cell', { name: 'تعديل موقع' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'التفاصيل' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('فرع قديم')).toBeInTheDocument();
    expect(within(dialog).getByText('فرع جديد')).toBeInTheDocument();
  });
});
