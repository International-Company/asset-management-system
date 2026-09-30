import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { meResponse, mockApi, renderApp } from '../test/render';
import { resolveCode } from './TopbarSearch';

const PERMS = ['assets.view', 'custody.view'];
const asset = (id: string, assetNumber: string, name: string, serialNumber: string) => ({
  id,
  assetNumber,
  name,
  serialNumber,
  status: 'IN_USE',
  locationDepartment: { location: { name: 'المقر الرئيسي' }, department: { name: 'المالية' } },
});
const list = (items: unknown[]) => ({ status: 200, body: { items, total: items.length, page: 1, pageSize: 25 } });
const notFound = () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'غير موجود' } } });

function mocks() {
  return mockApi({
    'GET /auth/me': meResponse(PERMS),
    'GET /notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
    'GET /custodies/pending-for-me': () => ({ status: 200, body: [] }),
    'GET /assets?q=%D8%AD%D8%A7%D8%B3%D9%88%D8%A8&pageSize=25': () => list([asset('a1', 'TEC-000010', 'حاسوب محمول', 'SN-1'), asset('a2', 'TEC-000011', 'حاسوب مكتبي', 'SN-2')]),
    'GET /custodies?q=CUS-000031&pageSize=25': () => list([{ id: 'c31', number: 'CUS-000031' }]),
    'GET /assets?q=CUS-000031&pageSize=25': () => list([]),
    'GET /assets/a2': notFound,
    'GET /custodies/c31': notFound,
  });
}

describe('Global search', () => {
  it('opens with Ctrl+K, lists matching assets, and Enter opens the highlighted one', async () => {
    const calls = mocks();
    const user = userEvent.setup();
    renderApp(<App />, { route: '/' });
    await screen.findByRole('button', { name: 'البحث في النظام' });
    await user.keyboard('{Control>}k{/Control}');
    const box = screen.getByRole('combobox', { name: 'ابحث عن أصل أو محضر أو صفحة' });
    expect(box).toHaveFocus();

    await user.type(box, 'حاسوب');
    const results = screen.getByRole('listbox', { name: 'نتائج البحث' });
    const first = await within(results).findByRole('option', { name: /TEC-000010/ });
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveTextContent('المقر الرئيسي / المالية');
    expect(first).toHaveTextContent('قيد الاستخدام');

    await user.keyboard('{ArrowDown}');
    expect(within(results).getByRole('option', { name: /TEC-000011/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /assets/a2')).toBe(true));
  });

  it('finds a record by its number', async () => {
    const calls = mocks();
    const user = userEvent.setup();
    renderApp(<App />, { route: '/' });
    await user.click(await screen.findByRole('button', { name: 'البحث في النظام' }));
    await user.type(screen.getByRole('combobox'), 'CUS-000031');
    const option = await screen.findByRole('option', { name: /CUS-000031/ });
    expect(option).toHaveTextContent('محضر عهدة');
    await user.click(option);
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /custodies/c31')).toBe(true));
  });

  it('lists pages the user may open, filtered by what is typed', async () => {
    mocks();
    const user = userEvent.setup();
    renderApp(<App />, { route: '/' });
    await user.click(await screen.findByRole('button', { name: 'البحث في النظام' }));
    await user.type(screen.getByRole('combobox'), 'العهدة');
    expect(await screen.findByRole('option', { name: /محاضر العهدة/ })).toBeInTheDocument();
    // No permission for the users page, so it is never offered.
    expect(screen.queryByRole('option', { name: /المستخدمون/ })).not.toBeInTheDocument();
  });
});

describe('QR scan button', () => {
  it('resolves label links, exact numbers or serials, and falls back to a filtered list', async () => {
    mockApi({
      'GET /assets?q=sn-1&pageSize=25': () => list([asset('a1', 'TEC-000010', 'حاسوب', 'SN-1'), asset('a9', 'TEC-000090', 'طابعة', 'SN-10')]),
      'GET /assets?q=TEC&pageSize=25': () => list([asset('a1', 'TEC-000010', 'حاسوب', 'SN-1'), asset('a9', 'TEC-000090', 'طابعة', 'SN-10')]),
    });
    expect(await resolveCode('https://assets.example/qr/abc123')).toBe('/qr/abc123');
    expect(await resolveCode('sn-1')).toBe('/assets/a1');
    expect(await resolveCode('TEC')).toBe('/assets?q=TEC');
  });

  it('opens the scanner, and a typed code goes to the asset', async () => {
    const calls = mockApi({
      'GET /auth/me': meResponse(PERMS),
      'GET /notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /custodies/pending-for-me': () => ({ status: 200, body: [] }),
      'GET /assets?q=TEC-000011&pageSize=25': () => list([asset('a2', 'TEC-000011', 'حاسوب مكتبي', 'SN-2')]),
      'GET /assets/a2': notFound,
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/' });
    await user.click(await screen.findByRole('button', { name: 'مسح رمز QR' }));
    const dialog = screen.getByRole('dialog', { name: 'مسح رمز QR' });
    await user.type(within(dialog).getByLabelText(/أو أدخل رقم الأصل/), 'TEC-000011');
    await user.click(within(dialog).getByRole('button', { name: 'بحث' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /assets/a2')).toBe(true));
  });

  it('is not offered without permission to view assets', async () => {
    mockApi({
      'GET /auth/me': meResponse([]),
      'GET /notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /custodies/pending-for-me': () => ({ status: 200, body: [] }),
    });
    renderApp(<App />, { route: '/' });
    await screen.findByRole('button', { name: 'البحث في النظام' });
    expect(screen.queryByRole('button', { name: 'مسح رمز QR' })).not.toBeInTheDocument();
  });
});
