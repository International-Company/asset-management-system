import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { App } from '../App';
import { meResponse, mockApi, renderApp } from '../test/render';
import { enqueue, findAsset, getInventory, getMeta, listQueue, saveSnapshot, type Snapshot } from './db';
import { ensureOwner, processQueue } from './sync';

const MANAGER = ['assets.view', 'assets.edit', 'inventory.view', 'inventory.manage'];

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  generatedAt: '2026-09-27T08:00:00.000Z',
  userId: 'u1',
  truncated: false,
  assets: [
    {
      id: 'a1',
      assetNumber: 'TEC-000010',
      name: 'حاسوب محمول',
      qrToken: 'tok-a1',
      serialNumber: 'SN-1',
      status: 'IN_USE',
      version: 3,
      notes: null,
      locationId: 'loc-1',
      location: 'المقر الرئيسي',
      departmentId: 'dep-1',
      department: 'المالية',
      responsible: 'موظف تجريبي',
    },
  ],
  locations: [{ id: 'loc-1', name: 'المقر الرئيسي', departments: [{ id: 'dep-1', name: 'المالية' }] }],
  inventories: [
    {
      id: 'inv-1',
      number: 'INV-000003',
      scope: 'المقر الرئيسي / كل الأقسام',
      items: [
        {
          id: 'item-1',
          assetId: 'a1',
          assetNumber: 'TEC-000010',
          name: 'حاسوب محمول',
          qrToken: 'tok-a1',
          serialNumber: 'SN-1',
          expectedStatus: 'IN_USE',
          expectedLocationId: 'loc-1',
          expectedDepartmentId: 'dep-1',
          expectedPlace: 'المقر الرئيسي / المالية',
          checkedAt: null,
          exists: null,
        },
      ],
    },
  ],
  ...over,
});

const queueCheck = () =>
  enqueue({
    type: 'inventory.check',
    fields: { inventoryId: 'inv-1', itemId: 'item-1', baseCheckedAt: '', exists: 'true' },
    label: 'فحص TEC-000010 — INV-000003',
    target: 'check:item-1',
  });

const synced = (init: RequestInit | undefined, result: unknown = {}) => ({
  status: 200,
  body: { clientOperationId: (init?.body as FormData).get('clientOperationId'), status: 'SYNCED', result },
});

describe('Offline storage (spec §52–53)', () => {
  it('finds cached assets by QR URL, QR token, asset number or serial', async () => {
    await saveSnapshot(snapshot());
    expect((await findAsset('https://assets.example/qr/tok-a1'))?.id).toBe('a1');
    expect((await findAsset('tok-a1'))?.id).toBe('a1');
    expect((await findAsset('tec-000010'))?.id).toBe('a1');
    expect((await findAsset('SN-1'))?.id).toBe('a1');
    expect(await findAsset('غير موجود')).toBeUndefined();
  });

  it('wipes local data when another user signs in on the device', async () => {
    await saveSnapshot(snapshot());
    await queueCheck();
    await ensureOwner('u1');
    expect(await getMeta()).toBeDefined();
    await ensureOwner('someone-else');
    expect(await getMeta()).toBeUndefined();
    expect(await listQueue()).toEqual([]);
  });

  it('refreshing the snapshot keeps unsynced local results', async () => {
    await saveSnapshot(snapshot());
    const { markItemChecked } = await import('./db');
    await markItemChecked('inv-1', 'item-1', false);
    await saveSnapshot(snapshot());
    expect((await getInventory('inv-1'))!.items[0].localCheck?.exists).toBe(false);
  });
});

describe('Sync queue (spec §54)', () => {
  it('syncs a queued operation once and updates the local base, so a re-check is not a false conflict', async () => {
    await saveSnapshot(snapshot());
    const op = await queueCheck();
    const calls = mockApi({ 'POST /sync/operations/inventory.check': (init) => synced(init, { itemId: 'item-1', checkedAt: '2026-09-27T09:00:00.000Z' }) });
    expect(await processQueue()).toEqual({ synced: 1, review: 0 });
    expect(calls).toHaveLength(1);
    const sent = calls[0].body as FormData;
    expect(sent.get('clientOperationId')).toBe(op.id);
    expect(sent.get('baseCheckedAt')).toBe('');
    expect((await listQueue())[0]).toMatchObject({ status: 'SYNCED', attempts: 1 });
    expect((await getInventory('inv-1'))!.items[0]).toMatchObject({ checkedAt: '2026-09-27T09:00:00.000Z', exists: true });

    // Nothing left to send.
    await processQueue();
    expect(calls).toHaveLength(1);
  });

  it('keeps operations pending on network or server failure and retries with the same id', async () => {
    const op = await queueCheck();
    let fail: 'network' | 'server' | null = 'network';
    const calls = mockApi({
      'POST /sync/operations/inventory.check': (init) => {
        if (fail === 'network') throw new TypeError('Failed to fetch');
        if (fail === 'server') return { status: 503, body: {} };
        return synced(init);
      },
    });
    expect((await processQueue()).stoppedBy).toBe('offline');
    expect((await listQueue())[0]).toMatchObject({ status: 'PENDING', attempts: 1 });
    fail = 'server';
    expect((await processQueue()).stoppedBy).toBe('server');
    expect((await listQueue())[0]).toMatchObject({ status: 'PENDING', attempts: 2 });
    fail = null;
    expect((await processQueue()).synced).toBe(1);
    expect(calls.map((c) => (c.body as FormData).get('clientOperationId'))).toEqual([op.id, op.id, op.id]);
  });

  it('marks server-rejected operations Needs Review and pauses when the session ended', async () => {
    await saveSnapshot(snapshot());
    await queueCheck();
    await enqueue({ type: 'asset.notes', fields: { assetId: 'a1', baseVersion: '3', notes: 'x' }, label: 'ملاحظات TEC-000010' });
    let sessionEnded = true;
    mockApi({
      'POST /sync/operations/inventory.check': () =>
        sessionEnded
          ? { status: 401, body: { error: { code: 'SESSION_EXPIRED', message: 'انتهت الجلسة.' } } }
          : { status: 200, body: { status: 'NEEDS_REVIEW', errorCode: 'CONFLICT', message: 'فُحص هذا الأصل من مستخدم آخر.' } },
      'POST /sync/operations/asset.notes': (init) => synced(init, { version: 4 }),
    });
    expect((await processQueue()).stoppedBy).toBe('session');
    expect((await listQueue()).map((o) => o.status)).toEqual(['PENDING', 'PENDING']);

    sessionEnded = false;
    expect(await processQueue()).toEqual({ synced: 1, review: 1 });
    const [check, notes] = await listQueue();
    expect(check).toMatchObject({ status: 'NEEDS_REVIEW', errorCode: 'CONFLICT', message: 'فُحص هذا الأصل من مستخدم آخر.' });
    expect(notes.status).toBe('SYNCED');
    expect((await findAsset('tok-a1'))!.version).toBe(4);
    // The rejected local result is no longer shown as recorded.
    expect((await getInventory('inv-1'))!.items[0].localCheck).toBeUndefined();
  });

  it('sends operations strictly in the order recorded, even within the same millisecond', async () => {
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-09-27T09:00:00.000Z');
    const labels = ['أولى', 'ثانية', 'ثالثة', 'رابعة'];
    for (const label of labels) await enqueue({ type: 'asset.photo', fields: { assetId: 'a1' }, label });
    expect((await listQueue()).map((o) => o.label)).toEqual(labels);
  });

  it('a re-check replaces a still-pending check of the same item', async () => {
    const first = await queueCheck();
    const second = await queueCheck();
    const queue = await listQueue();
    expect(queue.map((o) => o.id)).toEqual([second.id]);
    expect(second.id).not.toBe(first.id);
  });
});

describe('Offline pages', () => {
  it('records an inventory check offline, shows it pending, and syncs it when the connection returns', async () => {
    await saveSnapshot(snapshot());
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const calls = mockApi({
      'GET /auth/me': () => {
        throw new TypeError('Failed to fetch');
      },
      'GET /notifications/unread-count': () => {
        throw new TypeError('Failed to fetch');
      },
      'POST /sync/operations/inventory.check': (init) => synced(init, { checkedAt: '2026-09-27T09:00:00.000Z' }),
    });
    // The last signed-in user was cached while online.
    localStorage.setItem('osooli.me', JSON.stringify(meResponse(MANAGER)().body));
    const user = userEvent.setup();
    renderApp(<App />, { route: '/offline/inventories/inv-1' });

    await screen.findByRole('heading', { name: /INV-000003/ });
    expect(screen.getByRole('status')).toHaveTextContent('أنت غير متصل بالشبكة');
    await user.click(screen.getByRole('button', { name: 'فحص' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('ملاحظات'), 'بدون شبكة');
    await user.click(within(dialog).getByRole('button', { name: 'حفظ الفحص' }));

    await user.click(screen.getByRole('tab', { name: 'فُحص' }));
    expect(await screen.findByText('موجود — على الجهاز')).toBeInTheDocument();
    const indicator = await screen.findByRole('link', { name: 'المزامنة: 1 بانتظار المزامنة' });
    expect(calls.some((c) => c.key.startsWith('POST /sync'))).toBe(false);

    // Logging out needs the network.
    await user.click(screen.getByRole('button', { name: /قائمة المستخدم/ }));
    await user.click(screen.getByRole('menuitem', { name: 'تسجيل الخروج' }));
    expect(within(screen.getByRole('dialog')).getByText(/يتطلب اتصالًا بالشبكة/)).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'إغلاق' }));

    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(indicator).not.toBeInTheDocument());
    const sent = calls.find((c) => c.key === 'POST /sync/operations/inventory.check')!.body as FormData;
    expect(sent.get('notes')).toBe('بدون شبكة');
    expect(sent.get('actualDepartmentId')).toBe('dep-1');
    expect(sent.get('actualResponsibleType')).toBeNull();
  });

  it('warns before logging out with unsynced operations', async () => {
    await queueCheck();
    mockApi({
      'GET /auth/me': meResponse(MANAGER),
      'GET /notifications/unread-count': () => ({ status: 200, body: { count: 0 } }),
      'GET /custodies/pending-for-me': () => ({ status: 200, body: [] }),
      'POST /sync/operations/inventory.check': () => {
        throw new TypeError('Failed to fetch');
      },
      'POST /auth/logout': () => ({ status: 204, body: null }),
    });
    const user = userEvent.setup();
    renderApp(<App />, { route: '/offline' });
    await screen.findByRole('link', { name: 'المزامنة: 1 بانتظار المزامنة' });
    await user.click(screen.getByRole('button', { name: /قائمة المستخدم/ }));
    await user.click(screen.getByRole('menuitem', { name: 'تسجيل الخروج' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('توجد 1 عملية على هذا الجهاز لم تصل إلى الخادم');
    await user.click(within(dialog).getByRole('button', { name: 'تسجيل الخروج وحذفها' }));
    await waitFor(async () => expect(await listQueue()).toEqual([]));
    expect(localStorage.getItem('osooli.me')).toBeNull();
  });

  it('looks up an asset offline and queues a note based on its version', async () => {
    await saveSnapshot(snapshot());
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mockApi({
      'GET /auth/me': () => {
        throw new TypeError('Failed to fetch');
      },
      'GET /notifications/unread-count': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    localStorage.setItem('osooli.me', JSON.stringify(meResponse(MANAGER)().body));
    const user = userEvent.setup();
    renderApp(<App />, { route: '/offline/lookup' });
    await user.type(await screen.findByLabelText(/أو أدخل رقم الأصل/), 'TEC-000010{Enter}');
    expect(await screen.findByRole('heading', { name: /حاسوب محمول/ })).toBeInTheDocument();
    await user.type(screen.getByLabelText('ملاحظات الأصل'), 'الملصق تالف');
    await user.click(screen.getByRole('button', { name: 'حفظ الملاحظات' }));
    await screen.findByText(/حُفظت الملاحظات على الجهاز/);
    const [op] = await listQueue();
    expect(op).toMatchObject({ type: 'asset.notes', status: 'PENDING', fields: { assetId: 'a1', baseVersion: '3', notes: 'الملصق تالف' } });
  });
});
