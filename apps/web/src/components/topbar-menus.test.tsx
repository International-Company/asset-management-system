import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { meResponse, mockApi, renderApp } from '../test/render';

const notifications = [
  { id: 'n1', title: 'بانتظار تأكيدك: محضر عهدة CUS-000009', body: 'حاسوب محمول', entityType: 'Custody', entityId: 'c1', readAt: null, createdAt: '2026-09-30T08:00:00Z' },
  { id: 'n2', title: 'اكتملت صيانة MNT-000003', body: null, entityType: 'Maintenance', entityId: 'm3', readAt: '2026-09-29T08:00:00Z', createdAt: '2026-09-29T07:00:00Z' },
];

function mocks() {
  let unread = 1;
  const calls = mockApi({
    'GET /auth/me': meResponse(['assets.view'], ['ASSET_MANAGER']),
    'GET /notifications/unread-count': () => ({ status: 200, body: { count: unread } }),
    'GET /notifications': () => ({ status: 200, body: { items: notifications, total: 2, page: 1, pageSize: 25 } }),
    'POST /notifications/n1/read': () => {
      unread = 0;
      return { status: 200, body: {} };
    },
    'GET /custodies/c1': () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'غير موجود' } } }),
    'GET /custodies/pending-for-me': () => ({ status: 200, body: [] }),
  });
  return calls;
}

describe('Top bar menus', () => {
  it('user menu: name and role, keyboard navigation, theme switch, Escape returns focus', async () => {
    mocks();
    const user = userEvent.setup();
    renderApp(<App />, { route: '/' });
    const trigger = await screen.findByRole('button', { name: 'قائمة المستخدم: ليلى حسن' });
    expect(within(trigger.closest('header')!).getByText('مدير الأصول')).toBeInTheDocument();

    await user.click(trigger);
    const menu = screen.getByRole('menu', { name: 'قائمة المستخدم' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // Focus moves into the menu; arrows move between items and wrap.
    expect(within(menu).getByRole('menuitem', { name: 'جلساتي وبصماتي' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    const themeItem = within(menu).getByRole('menuitemcheckbox', { name: 'المظهر الداكن' });
    expect(themeItem).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'جلساتي وبصماتي' })).toHaveFocus();

    await user.click(themeItem);
    expect(themeItem).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.dataset.theme).toBe('dark');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('notifications panel: latest items, opening one marks it read and goes to its record', async () => {
    const calls = mocks();
    const user = userEvent.setup();
    renderApp(<App />, { route: '/' });
    const bell = await screen.findByRole('button', { name: 'الإشعارات: 1 غير مقروء' });
    await user.click(bell);
    const panel = screen.getByRole('dialog', { name: 'الإشعارات' });
    const first = await within(panel).findByRole('button', { name: /CUS-000009/ });
    expect(first).toHaveTextContent('غير مقروء');
    expect(within(panel).getByRole('link', { name: 'عرض كل الإشعارات' })).toHaveAttribute('href', '/notifications');

    await user.click(first);
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /notifications/n1/read')).toBe(true));
    expect(screen.queryByRole('dialog', { name: 'الإشعارات' })).not.toBeInTheDocument();
    await screen.findByRole('button', { name: 'الإشعارات' });
  });

  it('closes when clicking outside', async () => {
    mocks();
    const user = userEvent.setup();
    renderApp(<App />, { route: '/' });
    await user.click(await screen.findByRole('button', { name: /قائمة المستخدم/ }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByRole('main'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
