import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createApp, login } from './helpers';

let app: INestApplication;
let prisma: PrismaService;
let admin: string;
let manager: string;
let viewer: string;
const api = () => request(app.getHttpServer());
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0a80000000049454e44ae426082',
  'hex',
);

beforeAll(async () => {
  ({ app, prisma } = await createApp());
  [admin, manager, viewer] = await Promise.all([login(app, 'admin'), login(app, 'manager'), login(app, 'viewer')]);
});

afterAll(async () => {
  await app.close();
});

async function inventoryWithOneAsset() {
  const t = randomUUID().slice(0, 6);
  const location = await prisma.location.create({ data: { name: `موقع مزامنة ${t}` } });
  const dep = await prisma.department.findFirstOrThrow({ where: { status: 'ACTIVE' } });
  await prisma.locationDepartment.create({ data: { locationId: location.id, departmentId: dep.id } });
  const sub = await prisma.subcategory.findFirstOrThrow({ where: { mainCategory: 'TEC', status: 'ACTIVE' } });
  const asset = (
    await api().post('/api/v1/assets').set('Cookie', manager).send({ name: 'أصل مزامنة', subcategoryId: sub.id, locationId: location.id, departmentId: dep.id, responsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1002' } }).expect(201)
  ).body;
  const inv = (await api().post('/api/v1/inventories').set('Cookie', manager).send({ scopes: [{ locationId: location.id }] }).expect(201)).body;
  const item = (await api().get(`/api/v1/inventories/${inv.id}/items`).set('Cookie', manager).expect(200)).body.items[0];
  return { asset, inv, item };
}

function submit(cookie: string, type: string, fields: Record<string, string>, photo?: Buffer) {
  const req = api().post(`/api/v1/sync/operations/${type}`).set('Cookie', cookie).field('clientCreatedAt', new Date().toISOString());
  for (const [k, v] of Object.entries(fields)) req.field(k, v);
  if (photo) req.attach('photo', photo, 'offline.png');
  return req;
}

describe('Offline snapshot (spec §52–53)', () => {
  it('contains what offline work needs and nothing sensitive', async () => {
    const { asset, inv } = await inventoryWithOneAsset();
    const snap = (await api().get('/api/v1/sync/snapshot').set('Cookie', manager).expect(200)).body;
    const a = snap.assets.find((x: { id: string }) => x.id === asset.id);
    expect(a).toMatchObject({ assetNumber: asset.assetNumber, qrToken: expect.any(String), version: 1, location: expect.any(String) });
    expect(Object.keys(a)).not.toEqual(expect.arrayContaining(['purchaseValue', 'supplier', 'invoiceNumber', 'warrantyDetails']));
    expect(snap.inventories.find((i: { id: string }) => i.id === inv.id).items).toHaveLength(1);

    // The viewer (no inventory.manage) gets no inventories.
    const viewerSnap = (await api().get('/api/v1/sync/snapshot').set('Cookie', viewer).expect(200)).body;
    expect(viewerSnap.inventories).toEqual([]);
  });
});

describe('Offline operations (spec §54)', () => {
  it('applies a queued inventory check with its photo, and a retry of the same operation is not applied twice', async () => {
    const { inv, item } = await inventoryWithOneAsset();
    const id = randomUUID();
    const fields = { clientOperationId: id, inventoryId: inv.id, itemId: item.id, baseCheckedAt: '', exists: 'true', confirmedByQr: 'true', notes: 'بدون اتصال' };
    const first = (await submit(manager, 'inventory.check', fields, PNG).expect(200)).body;
    expect(first).toMatchObject({ clientOperationId: id, status: 'SYNCED' });
    const retry = (await submit(manager, 'inventory.check', fields, PNG).expect(200)).body;
    expect(retry.status).toBe('SYNCED');
    expect(await prisma.auditLog.count({ where: { entityId: inv.id, operation: 'INVENTORY_ITEM_CHECKED' } })).toBe(1);

    const stored = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(stored).toMatchObject({ exists: true, confirmedByQr: true, notes: 'بدون اتصال' });
    expect(stored.photoId).not.toBeNull();
    const recent = (await api().get('/api/v1/sync/operations').set('Cookie', manager).expect(200)).body;
    expect(recent.find((r: { clientOperationId: string }) => r.clientOperationId === id).status).toBe('SYNCED');
  });

  it('rejects a stale check as Needs Review when someone else checked the asset meanwhile — nothing is overwritten', async () => {
    const { inv, item } = await inventoryWithOneAsset();
    // Another user checks the asset online after our offline snapshot.
    await api().post(`/api/v1/inventories/${inv.id}/items/${item.id}/check`).set('Cookie', admin).field('exists', 'false').field('notes', 'رأي آخر').expect(200);
    const res = (
      await submit(manager, 'inventory.check', { clientOperationId: randomUUID(), inventoryId: inv.id, itemId: item.id, baseCheckedAt: '', exists: 'true' }).expect(200)
    ).body;
    expect(res).toMatchObject({ status: 'NEEDS_REVIEW', errorCode: 'CONFLICT' });
    const stored = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(stored).toMatchObject({ exists: false, notes: 'رأي آخر' });
  });

  it('a check queued before the inventory was closed needs review', async () => {
    const { inv, item } = await inventoryWithOneAsset();
    await api().post(`/api/v1/inventories/${inv.id}/items/${item.id}/check`).set('Cookie', manager).field('exists', 'true').expect(200);
    const checked = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    await api().post(`/api/v1/inventories/${inv.id}/close`).set('Cookie', manager).expect(200);
    const res = (
      await submit(manager, 'inventory.check', { clientOperationId: randomUUID(), inventoryId: inv.id, itemId: item.id, baseCheckedAt: checked.checkedAt!.toISOString(), exists: 'false' }).expect(200)
    ).body;
    expect(res).toMatchObject({ status: 'NEEDS_REVIEW', errorCode: 'INVALID_STATE' });
  }, 60_000);

  it('responsible changes are refused offline (sensitive, online-only)', async () => {
    const { inv, item } = await inventoryWithOneAsset();
    const res = (
      await submit(manager, 'inventory.check', {
        clientOperationId: randomUUID(),
        inventoryId: inv.id,
        itemId: item.id,
        baseCheckedAt: '',
        exists: 'true',
        actualResponsibleType: 'EMPLOYEE',
        actualResponsibleEapEmployeeId: 'EMP-1003',
      }).expect(200)
    ).body;
    expect(res).toMatchObject({ status: 'NEEDS_REVIEW', errorCode: 'VALIDATION_ERROR' });
  });

  it('asset notes carry the version they were based on; a stale version needs review', async () => {
    const { asset } = await inventoryWithOneAsset();
    const ok = (await submit(manager, 'asset.notes', { clientOperationId: randomUUID(), assetId: asset.id, baseVersion: '1', notes: 'ملاحظة ميدانية' }).expect(200)).body;
    expect(ok.status).toBe('SYNCED');
    const stale = (await submit(manager, 'asset.notes', { clientOperationId: randomUUID(), assetId: asset.id, baseVersion: '1', notes: 'قديمة' }).expect(200)).body;
    expect(stale).toMatchObject({ status: 'NEEDS_REVIEW', errorCode: 'STALE_VERSION' });
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).notes).toBe('ملاحظة ميدانية');
  });

  it('offline photos and unregistered assets sync; permissions still apply', async () => {
    const { asset, inv } = await inventoryWithOneAsset();
    expect((await submit(manager, 'asset.photo', { clientOperationId: randomUUID(), assetId: asset.id }, PNG).expect(200)).body.status).toBe('SYNCED');
    expect((await submit(manager, 'inventory.unregistered', { clientOperationId: randomUUID(), inventoryId: inv.id, description: 'جهاز بلا ملصق' }, PNG).expect(200)).body.status).toBe('SYNCED');
    const denied = (await submit(viewer, 'asset.photo', { clientOperationId: randomUUID(), assetId: asset.id }, PNG).expect(200)).body;
    expect(denied).toMatchObject({ status: 'NEEDS_REVIEW', errorCode: 'FORBIDDEN' });
  });

  it('only offline-safe operation types exist', async () => {
    await submit(manager, 'sale.create', { clientOperationId: randomUUID() }).expect(400);
    await submit(manager, 'custody.create', { clientOperationId: randomUUID() }).expect(400);
    await submit(manager, 'asset.notes', { clientOperationId: 'not-a-uuid' }).expect(400);
  });
});
