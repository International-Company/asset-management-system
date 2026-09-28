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
  await prisma.employee.updateMany({ where: { eapEmployeeId: { in: ['EMP-1002', 'EMP-1003'] } }, data: { isActive: true } });
});

afterAll(async () => {
  await app.close();
});

/** An isolated location with two departments, so each test controls exactly what is in scope. */
async function site() {
  const t = randomUUID().slice(0, 6);
  const location = await prisma.location.create({ data: { name: `موقع جرد ${t}` } });
  const [depA, depB] = await Promise.all([
    prisma.department.create({ data: { name: `قسم جرد أ ${t}` } }),
    prisma.department.create({ data: { name: `قسم جرد ب ${t}` } }),
  ]);
  await prisma.locationDepartment.createMany({
    data: [
      { locationId: location.id, departmentId: depA.id },
      { locationId: location.id, departmentId: depB.id },
    ],
  });
  const sub = await prisma.subcategory.findFirstOrThrow({ where: { mainCategory: 'TEC', status: 'ACTIVE' } });
  const asset = async (departmentId = depA.id) => {
    const res = await api()
      .post('/api/v1/assets')
      .set('Cookie', manager)
      .send({ name: 'أصل جرد', subcategoryId: sub.id, locationId: location.id, departmentId, responsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1002' } })
      .expect(201);
    return (await api().get(`/api/v1/assets/${res.body.id}`).set('Cookie', manager).expect(200)).body;
  };
  return { location, depA, depB, asset };
}

async function start(scopes: object[]) {
  return (await api().post('/api/v1/inventories').set('Cookie', manager).send({ scopes }).expect(201)).body as { id: string; number: string; assetCount: number };
}
async function items(id: string, filter = 'all') {
  return (await api().get(`/api/v1/inventories/${id}/items?filter=${filter}&pageSize=250`).set('Cookie', manager).expect(200)).body.items as Array<{
    id: string;
    asset: { id: string; assetNumber: string };
    hasDiscrepancy: boolean;
    exists: boolean | null;
  }>;
}
const check = (invId: string, itemId: string, fields: Record<string, string>) => {
  const req = api().post(`/api/v1/inventories/${invId}/items/${itemId}/check`).set('Cookie', manager);
  for (const [k, v] of Object.entries(fields)) req.field(k, v);
  return req;
};

describe('Inventory creation (spec §33)', () => {
  it('freezes the expected assets of the scope, excluding sold ones', async () => {
    const s = await site();
    const [a, b] = await Promise.all([s.asset(), s.asset(s.depB.id)]);
    const sold = await s.asset();
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    await prisma.$transaction(async (tx) => {
      await tx.sale.create({
        data: { number: `SAL-T-${randomUUID().slice(0, 8)}`, assetId: sold.id, saleDate: new Date(), saleValue: 1, currency: 'USD', buyerName: 'x', buyerType: 'فرد', statusBeforeSale: 'NEW', assetSnapshot: {}, actorId: adminUser.id },
      });
      await tx.asset.update({ where: { id: sold.id }, data: { status: 'SOLD' } });
    });

    const whole = await start([{ locationId: s.location.id }]);
    expect(whole.number).toMatch(/^INV-\d+/);
    expect((await items(whole.id)).map((i) => i.asset.id).sort()).toEqual([a.id, b.id].sort());

    const narrowed = await start([{ locationId: s.location.id, departmentId: s.depB.id }]);
    expect((await items(narrowed.id)).map((i) => i.asset.id)).toEqual([b.id]);
  });

  it('refuses an empty scope; the viewer cannot create or view inventories', async () => {
    const s = await site();
    await api().post('/api/v1/inventories').set('Cookie', manager).send({ scopes: [{ locationId: s.location.id }] }).expect(400);
    await api().post('/api/v1/inventories').set('Cookie', manager).send({ scopes: [{}] }).expect(400);
    await api().get('/api/v1/inventories').set('Cookie', viewer).expect(403);
  });
});

describe('Counting, discrepancies and closing (spec §33–35)', () => {
  it('records found / discrepancy / not found, refuses early closing, then applies discrepancies on close', async () => {
    const s = await site();
    const [same, moved, handed, missing] = await Promise.all([s.asset(), s.asset(), s.asset(), s.asset()]);
    const inv = await start([{ locationId: s.location.id }]);
    const byAsset = new Map((await items(inv.id)).map((i) => [i.asset.id, i.id]));

    // Found as expected, via QR scan.
    const scan = (await api().post(`/api/v1/inventories/${inv.id}/scan`).set('Cookie', manager).send({ code: `https://assets.example/qr/${same.qrToken}` }).expect(200)).body;
    expect(scan).toMatchObject({ kind: 'ITEM', viaQr: true });
    const ok = (await check(inv.id, scan.item.id, { exists: 'true', confirmedByQr: 'true' }).attach('photo', PNG, 'p.png').expect(200)).body;
    expect(ok).toMatchObject({ exists: true, hasDiscrepancy: false, confirmedByQr: true });

    // Found in another department → discrepancy.
    await check(inv.id, byAsset.get(moved.id)!, { exists: 'true', actualLocationId: s.location.id, actualDepartmentId: s.depB.id }).expect(200);
    // Found with another person, and damaged → discrepancy.
    await check(inv.id, byAsset.get(handed.id)!, { exists: 'true', actualResponsibleType: 'EMPLOYEE', actualResponsibleEapEmployeeId: 'EMP-1003', actualStatus: 'DAMAGED' }).expect(200);

    const early = await api().post(`/api/v1/inventories/${inv.id}/close`).set('Cookie', manager).expect(409);
    expect(early.body.error.message).toContain('بقي 1');

    // Not found → recorded, status untouched.
    await check(inv.id, byAsset.get(missing.id)!, { exists: 'false', notes: 'لم يُعثر عليه' }).expect(200);
    expect((await items(inv.id, 'discrepancy')).map((i) => i.asset.id).sort()).toEqual([moved.id, handed.id].sort());
    expect((await items(inv.id, 'notFound')).map((i) => i.asset.id)).toEqual([missing.id]);

    // An unregistered asset found on site: recorded only.
    const assetsBefore = await prisma.asset.count();
    await api().post(`/api/v1/inventories/${inv.id}/unregistered`).set('Cookie', manager).field('description', 'طابعة بلا ملصق').field('locationId', s.location.id).attach('photo', PNG, 'u.png').expect(201);
    expect(await prisma.asset.count()).toBe(assetsBefore);

    await api().post(`/api/v1/inventories/${inv.id}/close`).set('Cookie', manager).expect(200);
    const detail = (await api().get(`/api/v1/inventories/${inv.id}`).set('Cookie', manager).expect(200)).body;
    expect(detail).toMatchObject({ status: 'CLOSED', counts: { total: 4, found: 3, notFound: 1, discrepancies: 2, unregistered: 1 } });
    expect(detail.officialFileId).toBeTruthy();

    const get = async (id: string) => (await api().get(`/api/v1/assets/${id}`).set('Cookie', manager).expect(200)).body;
    expect((await get(moved.id)).locationDepartment.department.id).toBe(s.depB.id);
    const h = await get(handed.id);
    expect(h.responsibleEmployee.eapEmployeeId).toBe('EMP-1003');
    expect(h.status).toBe('DAMAGED');
    expect((await get(missing.id)).status).toBe('NEW');
    const history = (await api().get(`/api/v1/assets/${missing.id}/history`).set('Cookie', manager).expect(200)).body;
    expect(history[0]).toMatchObject({ type: 'INVENTORY_CHECKED', summary: { result: 'NOT_FOUND' } });

    // Closed = immutable.
    await check(inv.id, byAsset.get(same.id)!, { exists: 'false' }).expect(409);
    await expect(prisma.inventoryItem.update({ where: { id: byAsset.get(same.id)! }, data: { notes: 'x' } })).rejects.toThrow();
  }, 60_000);

  it('scanning an asset from elsewhere offers to add it; unknown codes are reported', async () => {
    const s = await site();
    await s.asset();
    const other = await site();
    const stranger = await other.asset();
    const inv = await start([{ locationId: s.location.id }]);
    const out = (await api().post(`/api/v1/inventories/${inv.id}/scan`).set('Cookie', manager).send({ code: stranger.assetNumber }).expect(200)).body;
    expect(out).toMatchObject({ kind: 'OUT_OF_SCOPE', asset: { id: stranger.id } });
    await api().post(`/api/v1/inventories/${inv.id}/items`).set('Cookie', manager).send({ assetId: stranger.id }).expect(201);
    expect((await items(inv.id)).length).toBe(2);
    const unknown = (await api().post(`/api/v1/inventories/${inv.id}/scan`).set('Cookie', manager).send({ code: 'NOT-A-CODE-123' }).expect(200)).body;
    expect(unknown.kind).toBe('UNKNOWN');
  });

  it('a responsible discrepancy is not applied while a custody is pending, and the skip is reported', async () => {
    const s = await site();
    const a = await s.asset();
    const inv = await start([{ locationId: s.location.id }]);
    const [item] = await items(inv.id);
    await check(inv.id, item.id, { exists: 'true', actualResponsibleType: 'EMPLOYEE', actualResponsibleEapEmployeeId: 'EMP-1003' }).expect(200);
    await api().post('/api/v1/custodies').set('Cookie', manager).send({ newResponsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1005' }, items: [{ assetId: a.id, condition: 'NEW' }] }).expect(201);
    await api().post(`/api/v1/inventories/${inv.id}/close`).set('Cookie', manager).expect(200);
    const after = (await api().get(`/api/v1/assets/${a.id}`).set('Cookie', manager).expect(200)).body;
    expect(after.responsibleEmployee.eapEmployeeId).toBe('EMP-1002');
    const log = await prisma.auditLog.findFirst({ where: { entityId: inv.id, operation: 'INVENTORY_CLOSED' } });
    expect(JSON.stringify(log?.newData)).toContain('محضر عهدة بانتظار التأكيد');
  }, 60_000);
});

describe('Exceptional reopening (spec §34)', () => {
  it('only the System Administrator reopens, with a reason; closing again versions the official PDF', async () => {
    const s = await site();
    await s.asset();
    const inv = await start([{ locationId: s.location.id }]);
    const [item] = await items(inv.id);
    await check(inv.id, item.id, { exists: 'true' }).expect(200);
    await api().post(`/api/v1/inventories/${inv.id}/close`).set('Cookie', manager).expect(200);

    await api().post(`/api/v1/inventories/${inv.id}/reopen`).set('Cookie', manager).send({ reason: 'x' }).expect(403);
    await api().post(`/api/v1/inventories/${inv.id}/reopen`).set('Cookie', admin).send({ reason: '' }).expect(400);
    await api().post(`/api/v1/inventories/${inv.id}/reopen`).set('Cookie', admin).send({ reason: 'تصحيح نتيجة فحص' }).expect(200);
    const reopened = (await api().get(`/api/v1/inventories/${inv.id}`).set('Cookie', admin).expect(200)).body;
    expect(reopened.status).toBe('IN_PROGRESS');
    expect(reopened.reopenings[0]).toMatchObject({ reason: 'تصحيح نتيجة فحص', actorName: 'سامي الأحمد' });
    expect(await prisma.auditLog.count({ where: { entityId: inv.id, operation: 'INVENTORY_REOPENED' } })).toBe(1);

    await check(inv.id, item.id, { exists: 'true', notes: 'بعد التصحيح' }).expect(200);
    await api().post(`/api/v1/inventories/${inv.id}/close`).set('Cookie', manager).expect(200);
    const closed = (await api().get(`/api/v1/inventories/${inv.id}`).set('Cookie', manager).expect(200)).body;
    expect(closed.officialVersion).toBe(2);
    expect(await prisma.document.count({ where: { inventoryId: inv.id, isOfficial: true } })).toBe(1);
  }, 60_000);

  it('a closed inventory cannot be reopened without a reopening record, even directly in the database', async () => {
    const s = await site();
    await s.asset();
    const inv = await start([{ locationId: s.location.id }]);
    const [item] = await items(inv.id);
    await check(inv.id, item.id, { exists: 'true' }).expect(200);
    await api().post(`/api/v1/inventories/${inv.id}/close`).set('Cookie', manager).expect(200);
    await expect(prisma.inventory.update({ where: { id: inv.id }, data: { status: 'IN_PROGRESS' } })).rejects.toThrow();
  }, 60_000);
});

describe('Inventory photos', () => {
  it('are readable with inventory.view only', async () => {
    const s = await site();
    await s.asset();
    const inv = await start([{ locationId: s.location.id }]);
    const [item] = await items(inv.id);
    const checked = (await check(inv.id, item.id, { exists: 'true' }).attach('photo', PNG, 'p.png').expect(200)).body;
    await api().get(`/api/v1/files/${checked.photoId}`).set('Cookie', manager).expect(200);
    await api().get(`/api/v1/files/${checked.photoId}`).set('Cookie', viewer).expect(404);
  });
});
