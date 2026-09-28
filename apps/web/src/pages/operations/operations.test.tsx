import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { meResponse, mockApi, renderApp } from '../../test/render';

const MANAGER = ['assets.view', 'custody.view', 'custody.create', 'custody.cancel', 'custody.confirm_external', 'sales.create', 'sales.view'];

const custody = {
  id: 'c1',
  number: 'CUS-000009',
  status: 'PENDING',
  notes: null,
  createdAt: '2026-09-27T08:00:00.000Z',
  createdByName: 'ليلى حسن',
  confirmedAt: null,
  confirmedByName: null,
  rejectedAt: null,
  rejectedByName: null,
  rejectionReason: null,
  cancelledAt: null,
  cancelledByName: null,
  cancellationReason: null,
  officialFileId: null,
  canAct: true,
  newResponsibleEmployee: { fullName: 'كريم يوسف' },
  newResponsibleExternal: null,
  items: [
    {
      id: 'i1',
      conditionAtHandover: 'NEW',
      notes: 'مع الشاحن',
      asset: { id: 'a1', assetNumber: 'TEC-000010', name: 'حاسوب', status: 'NEW' },
      previousResponsibleEmployee: { fullName: 'ليلى حسن' },
      previousResponsibleExternal: null,
    },
  ],
};

describe('Custody confirmation (receiver)', () => {
  it('the receiver, without custody permissions, confirms receipt from the home page', async () => {
    let confirmed = false;
    const calls = mockApi({
      'GET /auth/me': meResponse(['assets.view'], ['VIEWER']),
      'GET /custodies/pending-for-me': () => ({ status: 200, body: confirmed ? [] : [{ ...custody, items: [{ asset: custody.items[0].asset }] }] }),
      'GET /custodies/c1': () => ({ status: 200, body: confirmed ? { ...custody, status: 'CONFIRMED', canAct: false, officialFileId: 'f1' } : custody }),
      'POST /custodies/c1/confirm': () => {
        confirmed = true;
        return { status: 200, body: { id: 'c1', status: 'CONFIRMED' } };
      },
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/' });
    await user.click(await screen.findByRole('link', { name: 'مراجعة' }));
    expect(await screen.findByText(/بانتظار تأكيد كريم يوسف/)).toBeInTheDocument();
    // No cancel button: the receiver lacks custody.cancel.
    expect(screen.queryByRole('button', { name: 'إلغاء المحضر' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'تأكيد الاستلام' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'تأكيد' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /custodies/c1/confirm')).toBe(true));
    expect(await screen.findByRole('link', { name: 'المستند الرسمي (PDF)' })).toHaveAttribute('href', '/api/v1/files/f1');
  });

  it('rejection requires a reason', async () => {
    const calls = mockApi({
      'GET /auth/me': meResponse(['assets.view'], ['VIEWER']),
      'GET /custodies/c1': () => ({ status: 200, body: custody }),
      'POST /custodies/c1/reject': () => ({ status: 200, body: {} }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/custodies/c1' });
    await user.click(await screen.findByRole('button', { name: 'رفض الاستلام' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'رفض' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('السبب *'), 'الجهاز تالف');
    await user.click(within(dialog).getByRole('button', { name: 'رفض' }));
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /custodies/c1/reject')?.body).toEqual({ reason: 'الجهاز تالف' }));
  });

  it('an external person is confirmed on their behalf by an authorised user', async () => {
    mockApi({
      'GET /auth/me': meResponse(MANAGER),
      'GET /custodies/c1': () => ({ status: 200, body: { ...custody, newResponsibleEmployee: null, newResponsibleExternal: { name: 'نادر سليم', organization: null } } }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/custodies/c1' });
    await user.click(await screen.findByRole('button', { name: 'تأكيد الاستلام بالنيابة' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('بالنيابة عن نادر سليم');
  });
});

describe('New custody record', () => {
  it('collects assets with per-asset condition and notes, then the receiver', async () => {
    const calls = mockApi({
      'GET /auth/me': meResponse(MANAGER),
      'GET /assets': () => ({
        status: 200,
        body: {
          items: [
            { id: 'a1', assetNumber: 'TEC-000010', name: 'حاسوب', status: 'IN_USE', responsibleEmployee: { fullName: 'ليلى حسن' }, responsibleExternal: null },
            { id: 'a2', assetNumber: 'TEC-000011', name: 'حاسوب مباع', status: 'SOLD', responsibleEmployee: null, responsibleExternal: null },
          ],
          total: 2,
          page: 1,
          pageSize: 25,
        },
      }),
      'GET /employees/directory': () => ({ status: 200, body: [{ eapEmployeeId: 'EMP-1003', fullName: 'كريم يوسف', jobTitle: null, isActive: true }] }),
      'POST /custodies': () => ({ status: 201, body: { id: 'c1', number: 'CUS-000009' } }),
      'GET /custodies/c1': () => ({ status: 200, body: custody }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/custodies/new' });

    await user.click(await screen.findByRole('button', { name: 'إنشاء المحضر' }));
    expect(screen.getByText('أضف أصلًا واحدًا على الأقل.')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/ابحث برقم الأصل/), 'TEC');
    await user.click(screen.getAllByRole('button', { name: 'بحث' })[1]);
    const items = await screen.findAllByRole('listitem');
    expect(within(items.find((li) => within(li).queryByText(/حاسوب مباع/))!).getByRole('button', { name: 'إضافة' })).toBeDisabled();
    await user.click(within(items.find((li) => within(li).queryByText(/TEC-000010/))!).getByRole('button', { name: 'إضافة' }));
    await user.type(screen.getByLabelText('ملاحظات TEC-000010'), 'مع الشاحن');

    await user.type(screen.getByLabelText('ابحث عن موظف'), 'كريم');
    await user.click(screen.getAllByRole('button', { name: 'بحث' })[0]);
    await user.click(await screen.findByRole('button', { name: 'اختيار' }));

    await user.click(screen.getByRole('button', { name: 'إنشاء المحضر' }));
    expect(await screen.findByRole('heading', { name: /CUS-000009/ })).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /custodies')?.body).toEqual({
      newResponsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1003' },
      items: [{ assetId: 'a1', condition: 'IN_USE', notes: 'مع الشاحن' }],
      notes: '',
    });
  });
});

describe('Sale', () => {
  it('asks for a final confirmation before selling', async () => {
    const asset = {
      id: 'a1',
      assetNumber: 'TEC-000010',
      name: 'حاسوب',
      status: 'IN_USE',
      responsibleEmployee: null,
      responsibleExternal: null,
    };
    const calls = mockApi({
      'GET /auth/me': meResponse(MANAGER),
      'GET /assets/a1': () => ({ status: 200, body: asset }),
      'GET /lookups/currencies': () => ({ status: 200, body: [{ code: 'USD', nameAr: 'دولار', symbol: '$' }] }),
      'POST /sales': () => ({ status: 201, body: { id: 's1', number: 'SAL-000001' } }),
      'GET /sales/s1': () => ({
        status: 200,
        body: {
          id: 's1',
          number: 'SAL-000001',
          saleDate: '2026-09-27',
          saleValue: '100.00',
          currency: 'USD',
          buyerName: 'مشترٍ',
          buyerType: 'فرد',
          referenceNumber: null,
          notes: null,
          statusBeforeSale: 'IN_USE',
          createdAt: '2026-09-27T08:00:00.000Z',
          actorName: 'ليلى حسن',
          asset,
          documents: [],
        },
      }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/sales/new?assetId=a1' });
    await screen.findByRole('option', { name: /دولار/ });
    await user.type(screen.getByLabelText('قيمة البيع *'), '100.00');
    await user.selectOptions(screen.getByLabelText('العملة *'), 'USD');
    await user.type(screen.getByLabelText('اسم المشتري *'), 'مشترٍ');
    await user.click(screen.getByRole('button', { name: 'مراجعة البيع' }));

    const dialog = screen.getByRole('dialog', { name: 'تأكيد البيع النهائي' });
    expect(dialog).toHaveTextContent('البيع نهائي');
    expect(calls.some((c) => c.key === 'POST /sales')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'تأكيد البيع' }));
    expect(await screen.findByRole('heading', { name: /SAL-000001/ })).toBeInTheDocument();
  });
});
