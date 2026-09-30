import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { App } from '../App';
import { meResponse, mockApi, renderApp } from '../test/render';

const MANAGER = ['assets.view', 'reports.view', 'reports.export'];
const empty = () => ({ status: 200, body: { items: [], total: 0, page: 1, pageSize: 25 } });
const lookups = {
  'GET /lookups/categories': () => ({ status: 200, body: [] }),
  'GET /lookups/locations': () => ({ status: 200, body: [{ id: 'loc-1', name: 'المقر الرئيسي', departments: [] }] }),
};

describe('Advanced search & saved searches', () => {
  it('sends combined advanced conditions and saves them with the chosen name', async () => {
    const calls = mockApi({
      'GET /auth/me': meResponse(MANAGER),
      ...lookups,
      'GET /assets': empty,
      'GET /saved-searches': () => ({ status: 200, body: [] }),
      'POST /saved-searches': () => ({ status: 201, body: { id: 's1', name: 'ضمانات تنتهي', filters: {}, mine: true, isShared: false, ownerName: 'ليلى حسن', columns: null, sort: null } }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/assets' });
    await user.click(await screen.findByRole('button', { name: 'بحث متقدم' }));
    const panel = screen.getByRole('group', { name: 'بحث متقدم' });
    await screen.findByRole('group', { name: 'الحالات' });
    await user.click(within(panel).getByRole('checkbox', { name: 'جديد' }));
    await user.click(within(panel).getByRole('checkbox', { name: 'تالف' }));
    await user.type(within(panel).getByLabelText('ضمان ينتهي قبل'), '2026-12-31');

    await waitFor(() => {
      const last = calls.filter((c) => c.key.startsWith('GET /assets?')).at(-1)!.key;
      expect(last).toContain('statusIn=NEW%2CDAMAGED');
      expect(last).toContain('warrantyUntil=2026-12-31');
    });

    await user.click(screen.getByRole('button', { name: 'حفظ البحث الحالي' }));
    await user.type(within(screen.getByRole('dialog')).getByLabelText('اسم البحث'), 'ضمانات تنتهي');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /saved-searches')).toBe(true));
    expect(calls.find((c) => c.key === 'POST /saved-searches')!.body).toMatchObject({
      scope: 'assets',
      name: 'ضمانات تنتهي',
      filters: { statusIn: 'NEW,DAMAGED', warrantyUntil: '2026-12-31' },
    });
  });

  it('applying a shared saved search restores its filters', async () => {
    const calls = mockApi({
      'GET /auth/me': meResponse(MANAGER),
      ...lookups,
      'GET /assets': empty,
      'GET /saved-searches': () => ({
        status: 200,
        body: [{ id: 's9', name: 'أصول مقفلة', filters: { status: 'LOST' }, columns: null, sort: null, mine: false, isShared: true, ownerName: 'سامي الأحمد' }],
      }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/assets' });
    await screen.findByRole('option', { name: /أصول مقفلة/ });
    await user.selectOptions(screen.getByLabelText('عمليات البحث المحفوظة'), 's9');
    await waitFor(() => expect(calls.some((c) => c.key.startsWith('GET /assets?') && c.key.includes('status=LOST'))).toBe(true));
    // Not the owner: no delete/share controls.
    expect(screen.queryByRole('button', { name: 'حذف' })).not.toBeInTheDocument();
  });
});

describe('Notifications', () => {
  it('shows the unread count in the top bar and marks notifications read', async () => {
    let unread = 2;
    const calls = mockApi({
      'GET /auth/me': meResponse([]),
      'GET /notifications/unread-count': () => ({ status: 200, body: { count: unread } }),
      'GET /notifications': () => ({
        status: 200,
        body: {
          items: [{ id: 'n1', title: 'محضر عهدة CUS-000009 بانتظار تأكيدك', body: null, entityType: 'Custody', entityId: 'c1', readAt: null, createdAt: '2026-09-27T08:00:00.000Z', type: { label: 'إنشاء محضر عهدة' } }],
          total: 1,
          page: 1,
          pageSize: 25,
        },
      }),
      'POST /notifications/read-all': () => {
        unread = 0;
        return { status: 200, body: { updated: 2 } };
      },
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/notifications' });
    const topBar = await screen.findByRole('banner');
    expect(await within(topBar).findByRole('button', { name: 'الإشعارات: 2 غير مقروء' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /CUS-000009/ })).toHaveAttribute('href', '/custodies/c1');
    // No delete control exists.
    expect(screen.queryByRole('button', { name: /حذف/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'تعليم الكل كمقروء' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /notifications/read-all')).toBe(true));
    expect(await within(topBar).findByRole('button', { name: 'الإشعارات' })).toBeInTheDocument();
  });
});

describe('Reports', () => {
  const catalogue = [
    {
      key: 'sales',
      title: 'تقرير المبيعات',
      description: 'الأصول المباعة وقيم البيع.',
      filters: [
        { key: 'from', label: 'من تاريخ', type: 'date' },
        { key: 'to', label: 'إلى تاريخ', type: 'date' },
      ],
      columns: [
        { key: 'number', label: 'رقم العملية' },
        { key: 'value', label: 'القيمة', type: 'money' },
      ],
    },
  ];

  it('previews with filters and exports Excel with the same filters', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const calls = mockApi({
      'GET /auth/me': meResponse(MANAGER),
      ...lookups,
      'GET /reports': () => ({ status: 200, body: catalogue }),
      'GET /saved-searches': () => ({ status: 200, body: [] }),
      'POST /reports/sales/preview': () => ({
        status: 200,
        body: { columns: catalogue[0].columns, rows: [{ number: 'SAL-000001', value: 1250.5 }], total: 1, truncated: false, summary: [{ label: 'إجمالي المبيعات', value: '1,250.50 USD' }] },
      }),
      'POST /reports/sales/export': () => ({ status: 200, body: {} }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/reports' });
    await user.click(await screen.findByRole('link', { name: /تقرير المبيعات/ }));
    await user.type(await screen.findByLabelText('من تاريخ'), '2026-01-01');
    await user.click(screen.getByRole('button', { name: 'عرض التقرير' }));
    expect(await screen.findByText('SAL-000001')).toBeInTheDocument();
    expect(screen.getByText('1,250.50')).toBeInTheDocument();
    expect(screen.getByText('1,250.50 USD')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'تصدير Excel' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /reports/sales/export')).toBe(true));
    expect(calls.find((c) => c.key === 'POST /reports/sales/export')!.body).toEqual({ filters: { from: '2026-01-01' }, format: 'xlsx' });
    expect(click).toHaveBeenCalled();
  });

  it('hides export buttons without reports.export', async () => {
    mockApi({ 'GET /auth/me': meResponse(['reports.view']), ...lookups, 'GET /reports': () => ({ status: 200, body: catalogue }), 'GET /saved-searches': () => ({ status: 200, body: [] }) });
    renderApp(<App />, { route: '/reports/sales' });
    expect(await screen.findByRole('heading', { name: 'تقرير المبيعات' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'تصدير PDF' })).not.toBeInTheDocument();
  });
});
