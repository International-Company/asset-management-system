import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { meResponse, mockApi, renderApp } from '../test/render';

const ADMIN = ['assets.view', 'custody.view', 'transfers.view', 'inventory.view', 'maintenance.view', 'sales.view', 'reports.view', 'dashboard.view', 'users.view', 'roles.manage', 'settings.manage', 'audit.view', 'security.view'];

function mocks() {
  mockApi({
    'GET /auth/me': meResponse(ADMIN, ['SYSTEM_ADMINISTRATOR']),
    'GET /notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
    'GET /users': () => ({ status: 200, body: { items: [], total: 0, page: 1, pageSize: 25 } }),
    'GET /roles': () => ({ status: 200, body: [] }),
  });
}

const toggle = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const body = (name: string) => document.getElementById(toggle(name).getAttribute('aria-controls')!)!;

describe('Sidebar groups', () => {
  it("opens the current page's group, keeps the others closed and out of reach, and remembers a choice", async () => {
    mocks();
    const user = userEvent.setup();
    renderApp(<App />, { route: '/admin/users' });
    const nav = await screen.findByRole('navigation');

    expect(toggle('الإدارة')).toHaveAttribute('aria-expanded', 'true');
    expect(within(nav).getByRole('link', { name: 'المستخدمون' })).toHaveAttribute('aria-current', 'page');
    expect(toggle('العمليات')).toHaveAttribute('aria-expanded', 'false');
    // Closed items are inert: not focusable, not announced.
    expect(body('العمليات')).toHaveAttribute('inert');
    // A one-item group is a plain link, with no toggle.
    expect(within(nav).getByRole('link', { name: 'التقارير' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^التقارير/ })).not.toBeInTheDocument();

    await user.click(toggle('العمليات'));
    expect(toggle('العمليات')).toHaveAttribute('aria-expanded', 'true');
    expect(body('العمليات')).not.toHaveAttribute('inert');
    expect(JSON.parse(localStorage.getItem('osooli.navGroups')!)).toMatchObject({ العمليات: true, الإدارة: true });

    await user.click(toggle('الإدارة'));
    expect(toggle('الإدارة')).toHaveAttribute('aria-expanded', 'false');
    // The closed group still shows it holds the current page.
    expect(within(toggle('الإدارة')).getByLabelText('تحتوي الصفحة الحالية')).toBeInTheDocument();
  });
});
