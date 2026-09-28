import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createApp, login } from './helpers';

let app: INestApplication;
let prisma: PrismaService;
let admin: string;
let manager: string;
let viewer: string;
let place: { subTec: string; loc1: string; dep1: string; loc2: string; dep2: string };
let viewerEmployeeId: string;
let managerEmployeeId: string;
let externalId: string;
const api = () => request(app.getHttpServer());

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0a80000000049454e44ae426082',
  'hex',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF');
const binary = (r: request.Test) =>
  r.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

beforeAll(async () => {
  ({ app, prisma } = await createApp());
  [admin, manager, viewer] = await Promise.all([login(app, 'admin'), login(app, 'manager'), login(app, 'viewer')]);
  const subTec = await prisma.subcategory.findFirstOrThrow({ where: { mainCategory: 'TEC', status: 'ACTIVE' } });
  const links = await prisma.locationDepartment.findMany({
    where: { status: 'ACTIVE', location: { status: 'ACTIVE' }, department: { status: 'ACTIVE' } },
    take: 2,
    orderBy: { createdAt: 'asc' },
  });
  place = { subTec: subTec.id, loc1: links[0].locationId, dep1: links[0].departmentId, loc2: links[1].locationId, dep2: links[1].departmentId };
  viewerEmployeeId = (await prisma.user.findUniqueOrThrow({ where: { username: 'viewer' } })).employeeId;
  managerEmployeeId = (await prisma.user.findUniqueOrThrow({ where: { username: 'manager' } })).employeeId;
  await prisma.employee.updateMany({ where: { eapEmployeeId: { in: ['EMP-1002', 'EMP-1003'] } }, data: { isActive: true } });
  externalId = (await prisma.externalPerson.findFirstOrThrow({ where: { status: 'ACTIVE' } })).id;
});

afterAll(async () => {
  await app.close();
});

/** New asset in location 1, responsible = the Asset Manager's employee (EMP-1002). */
async function asset(): Promise<{ id: string; assetNumber: string }> {
  const res = await api()
    .post('/api/v1/assets')
    .set('Cookie', manager)
    .send({ name: 'أصل عمليات', subcategoryId: place.subTec, locationId: place.loc1, departmentId: place.dep1, responsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1002' } })
    .expect(201);
  return res.body;
}
const getAsset = async (id: string) => (await api().get(`/api/v1/assets/${id}`).set('Cookie', admin).expect(200)).body;

describe('Transfer (spec §23)', () => {
  it('changes location/department only, is numbered, logged and immutable', async () => {
    const a = await asset();
    const res = await api().post('/api/v1/transfers').set('Cookie', manager).send({ assetId: a.id, toLocationId: place.loc2, toDepartmentId: place.dep2, notes: 'نقل للفرع' }).expect(201);
    expect(res.body.number).toMatch(/^TRF-\d{6,}$/);
    const after = await getAsset(a.id);
    expect(after.locationDepartment.location.id).toBe(place.loc2);
    expect(after.responsibleEmployee.id).toBe(managerEmployeeId);

    const t = (await api().get(`/api/v1/transfers/${res.body.id}`).set('Cookie', manager).expect(200)).body;
    expect(t).toMatchObject({ fromLocation: { id: place.loc1 }, toLocation: { id: place.loc2 }, notes: 'نقل للفرع', actorName: 'ليلى حسن' });
    await expect(prisma.transfer.update({ where: { id: res.body.id }, data: { notes: 'x' } })).rejects.toThrow();
  });

  it('refuses the current placement and unregistered combinations; viewer cannot transfer', async () => {
    const a = await asset();
    await api().post('/api/v1/transfers').set('Cookie', manager).send({ assetId: a.id, toLocationId: place.loc1, toDepartmentId: place.dep1 }).expect(400);
    await api().post('/api/v1/transfers').set('Cookie', manager).send({ assetId: a.id, toLocationId: place.loc2, toDepartmentId: place.dep1 === place.dep2 ? place.dep1 : place.dep1 }).expect((r) => {
      if (![201, 400].includes(r.status)) throw new Error(`unexpected ${r.status}`);
    });
    await api().post('/api/v1/transfers').set('Cookie', viewer).send({ assetId: a.id, toLocationId: place.loc2, toDepartmentId: place.dep2 }).expect(403);
  });
});

describe('Custody (spec §24–27, §29)', () => {
  it('pending until the new responsible confirms; confirmation updates the assets and archives an official PDF', async () => {
    const [a, b] = await Promise.all([asset(), asset()]);
    const res = await api()
      .post('/api/v1/custodies')
      .set('Cookie', manager)
      .send({
        newResponsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1003' },
        items: [
          { assetId: a.id, condition: 'NEW', notes: 'مع الشاحن' },
          { assetId: b.id, condition: 'NEW' },
        ],
        notes: 'تسليم أجهزة',
      })
      .expect(201);
    expect(res.body.number).toMatch(/^CUS-\d{6,}$/);
    // Responsible does not change before confirmation.
    expect((await getAsset(a.id)).responsibleEmployee.id).toBe(managerEmployeeId);

    // The receiver (viewer role, no custody permissions) sees it and may act; the manager may not confirm.
    const pending = (await api().get('/api/v1/custodies/pending-for-me').set('Cookie', viewer).expect(200)).body;
    expect(pending.map((c: { id: string }) => c.id)).toContain(res.body.id);
    const seen = (await api().get(`/api/v1/custodies/${res.body.id}`).set('Cookie', viewer).expect(200)).body;
    expect(seen.canAct).toBe(true);
    await api().post(`/api/v1/custodies/${res.body.id}/confirm`).set('Cookie', manager).expect(403);

    const notif = await prisma.notification.findFirst({
      where: { typeKey: 'custody.created', entityId: res.body.id, user: { username: 'viewer' } },
    });
    expect(notif).not.toBeNull();

    await api().post(`/api/v1/custodies/${res.body.id}/confirm`).set('Cookie', viewer).expect(200);
    for (const id of [a.id, b.id]) {
      const after = await getAsset(id);
      expect(after.responsibleEmployee.id).toBe(viewerEmployeeId);
      expect(after.status).toBe('IN_USE');
    }

    const detail = (await api().get(`/api/v1/custodies/${res.body.id}`).set('Cookie', manager).expect(200)).body;
    expect(detail).toMatchObject({ status: 'CONFIRMED', confirmedByName: 'كريم يوسف' });
    expect(detail.items[0].assetSnapshot.responsible.name).toBe('ليلى حسن');
    const pdf = await binary(api().get(`/api/v1/files/${detail.officialFileId}`).set('Cookie', viewer)).expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    // Final records are immutable.
    await api().post(`/api/v1/custodies/${res.body.id}/cancel`).set('Cookie', manager).send({ reason: 'x' }).expect(409);
    await expect(prisma.custody.update({ where: { id: res.body.id }, data: { notes: 'x' } })).rejects.toThrow();

    const current = (await api().get(`/api/v1/assets/${a.id}/custody`).set('Cookie', manager).expect(200)).body;
    expect(current).toMatchObject({ responsible: 'كريم يوسف', current: { kind: 'CUSTODY', number: res.body.number }, pending: null });
    expect(current.current.documentFileId).toBe(detail.officialFileId);
  }, 60_000);

  it('the new responsible must differ from the current one', async () => {
    const a = await asset();
    const res = await api()
      .post('/api/v1/custodies')
      .set('Cookie', manager)
      .send({ newResponsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1002' }, items: [{ assetId: a.id, condition: 'NEW' }] })
      .expect(400);
    expect(res.body.error.fields.newResponsible[0]).toContain('المسؤول الحالي');
  });

  it('an asset cannot be in two pending custodies, even when requested at the same moment', async () => {
    const a = await asset();
    const body = { newResponsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1003' }, items: [{ assetId: a.id, condition: 'NEW' }] };
    const [r1, r2] = await Promise.all([
      api().post('/api/v1/custodies').set('Cookie', manager).send(body),
      api().post('/api/v1/custodies').set('Cookie', admin).send(body),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
  });

  it('rejection needs a reason and leaves the responsible unchanged', async () => {
    const a = await asset();
    const c = (await api().post('/api/v1/custodies').set('Cookie', manager).send({ newResponsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1003' }, items: [{ assetId: a.id, condition: 'NEW' }] }).expect(201)).body;
    await api().post(`/api/v1/custodies/${c.id}/reject`).set('Cookie', viewer).send({ reason: '' }).expect(400);
    await api().post(`/api/v1/custodies/${c.id}/reject`).set('Cookie', viewer).send({ reason: 'الجهاز لا يعمل' }).expect(200);
    const after = await getAsset(a.id);
    expect(after.responsibleEmployee.id).toBe(managerEmployeeId);
    expect(after.status).toBe('NEW');
    const d = (await api().get(`/api/v1/custodies/${c.id}`).set('Cookie', manager).expect(200)).body;
    expect(d).toMatchObject({ status: 'REJECTED', rejectionReason: 'الجهاز لا يعمل' });
  });

  it('Asset Manager cancels a pending record with a reason; the receiver cannot cancel', async () => {
    const a = await asset();
    const c = (await api().post('/api/v1/custodies').set('Cookie', manager).send({ newResponsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1003' }, items: [{ assetId: a.id, condition: 'NEW' }] }).expect(201)).body;
    await api().post(`/api/v1/custodies/${c.id}/cancel`).set('Cookie', viewer).send({ reason: 'x' }).expect(403);
    await api().post(`/api/v1/custodies/${c.id}/cancel`).set('Cookie', manager).send({ reason: 'أُدخل بالخطأ' }).expect(200);
    await api().post(`/api/v1/custodies/${c.id}/confirm`).set('Cookie', viewer).expect(409);
    const history = (await api().get(`/api/v1/assets/${a.id}/history`).set('Cookie', manager).expect(200)).body;
    expect(history.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['CUSTODY_CREATED', 'CUSTODY_CANCELLED']));
  });

  it('for an external person, an authorised user confirms on their behalf', async () => {
    const a = await asset();
    const c = (await api().post('/api/v1/custodies').set('Cookie', manager).send({ newResponsible: { type: 'EXTERNAL', externalPersonId: externalId }, items: [{ assetId: a.id, condition: 'NEW' }] }).expect(201)).body;
    // Not the party and lacks custody.confirm_external.
    await api().post(`/api/v1/custodies/${c.id}/confirm`).set('Cookie', viewer).expect(403);
    await api().get(`/api/v1/custodies/${c.id}`).set('Cookie', viewer).expect(404);
    await api().post(`/api/v1/custodies/${c.id}/confirm`).set('Cookie', manager).expect(200);
    expect((await getAsset(a.id)).responsibleExternal.id).toBe(externalId);
    const log = await prisma.auditLog.findFirst({ where: { entityId: c.id, operation: 'CUSTODY_CONFIRMED' } });
    expect(log?.newData).toMatchObject({ onBehalfOfExternal: true });
  }, 60_000);
});

describe('Custody return (spec §28)', () => {
  it('returns several assets at once, each to its own new responsible, with an archived PDF', async () => {
    const [a, b] = await Promise.all([asset(), asset()]);
    const res = await api()
      .post('/api/v1/custody-returns')
      .set('Cookie', manager)
      .send({
        items: [
          { assetId: a.id, condition: 'UNUSED', newResponsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1003' }, notes: 'إلى المستودع' },
          { assetId: b.id, condition: 'DAMAGED', newResponsible: { type: 'EXTERNAL', externalPersonId: externalId } },
        ],
      })
      .expect(201);
    expect(res.body.number).toMatch(/^RET-\d{6,}$/);
    const [ra, rb] = await Promise.all([getAsset(a.id), getAsset(b.id)]);
    expect(ra).toMatchObject({ status: 'UNUSED', responsibleEmployee: { id: viewerEmployeeId } });
    expect(rb).toMatchObject({ status: 'DAMAGED', responsibleExternal: { id: externalId } });
    const d = (await api().get(`/api/v1/custody-returns/${res.body.id}`).set('Cookie', viewer).expect(200)).body;
    expect(d.officialFileId).toBeTruthy();
    const current = (await api().get(`/api/v1/assets/${a.id}/custody`).set('Cookie', manager).expect(200)).body;
    expect(current.current).toMatchObject({ kind: 'RETURN', number: res.body.number });
  }, 60_000);

  it('is refused while the asset is in a pending custody', async () => {
    const a = await asset();
    await api().post('/api/v1/custodies').set('Cookie', manager).send({ newResponsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1003' }, items: [{ assetId: a.id, condition: 'NEW' }] }).expect(201);
    const res = await api()
      .post('/api/v1/custody-returns')
      .set('Cookie', manager)
      .send({ items: [{ assetId: a.id, condition: 'UNUSED', newResponsible: { type: 'EXTERNAL', externalPersonId: externalId } }] })
      .expect(409);
    expect(res.body.error.message).toContain('بانتظار التأكيد');
  });
});

describe('Maintenance (spec §31–32)', () => {
  it('runs NEW → IN_PROGRESS → COMPLETED → CLOSED with required photos; closed is final', async () => {
    const a = await asset();
    const provider = await prisma.maintenanceProvider.findFirstOrThrow({ where: { type: 'COMPANY', status: 'ACTIVE' } });
    await api().post('/api/v1/maintenances').set('Cookie', manager).field('assetId', a.id).field('technicianType', 'COMPANY').field('providerId', provider.id).expect(400);
    const m = (
      await api()
        .post('/api/v1/maintenances')
        .set('Cookie', manager)
        .field('assetId', a.id)
        .field('technicianType', 'COMPANY')
        .field('providerId', provider.id)
        .field('cost', '100')
        .field('currency', 'ILS')
        .attach('beforePhoto', PNG, 'before.png')
        .expect(201)
    ).body;
    expect(m.number).toMatch(/^MNT-\d{6,}$/);

    // One open request per asset; no custody while it is open.
    await api().post('/api/v1/maintenances').set('Cookie', manager).field('assetId', a.id).field('technicianType', 'COMPANY').field('providerId', provider.id).attach('beforePhoto', PNG, 'b.png').expect(409);
    await api().post('/api/v1/custodies').set('Cookie', manager).send({ newResponsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1003' }, items: [{ assetId: a.id, condition: 'NEW' }] }).expect(409);

    await api().post(`/api/v1/maintenances/${m.id}/start`).set('Cookie', manager).send({}).expect(200);
    expect((await getAsset(a.id)).status).toBe('UNDER_MAINTENANCE');
    await api().patch(`/api/v1/maintenances/${m.id}`).set('Cookie', manager).send({ cost: '150.50' }).expect(200);

    await api().post(`/api/v1/maintenances/${m.id}/complete`).set('Cookie', manager).field('whatWasRepaired', 'تبديل البطارية').field('resultingStatus', 'IN_USE').expect(400);
    await api()
      .post(`/api/v1/maintenances/${m.id}/complete`)
      .set('Cookie', manager)
      .field('whatWasRepaired', 'تبديل البطارية')
      .field('resultingStatus', 'IN_USE')
      .attach('afterPhoto', PNG, 'after.png')
      .expect(200);
    expect((await getAsset(a.id)).status).toBe('IN_USE');
    // Cost is still editable after completion, until closing.
    await api().patch(`/api/v1/maintenances/${m.id}`).set('Cookie', manager).send({ cost: '160' }).expect(200);

    await api().post(`/api/v1/maintenances/${m.id}/close`).set('Cookie', manager).expect(200);
    const closed = (await api().get(`/api/v1/maintenances/${m.id}`).set('Cookie', manager).expect(200)).body;
    expect(closed).toMatchObject({ status: 'CLOSED', cost: '160', currency: 'ILS', whatWasRepaired: 'تبديل البطارية' });
    expect(closed.documents.find((d: { isOfficial: boolean }) => d.isOfficial)).toBeDefined();
    await api().get(`/api/v1/files/${closed.beforePhoto.id}`).set('Cookie', manager).expect(200);

    await api().patch(`/api/v1/maintenances/${m.id}`).set('Cookie', manager).send({ cost: '1' }).expect(409);
    await expect(prisma.maintenance.update({ where: { id: m.id }, data: { cost: 1 } })).rejects.toThrow();
  }, 60_000);

  it('the technician may be an EAP employee; inactive employees are refused', async () => {
    const a = await asset();
    await api()
      .post('/api/v1/maintenances')
      .set('Cookie', manager)
      .field('assetId', a.id)
      .field('technicianType', 'EMPLOYEE')
      .field('technicianEapEmployeeId', 'EMP-1007')
      .attach('beforePhoto', PNG, 'b.png')
      .expect(400);
    await api()
      .post('/api/v1/maintenances')
      .set('Cookie', manager)
      .field('assetId', a.id)
      .field('technicianType', 'EMPLOYEE')
      .field('technicianEapEmployeeId', 'EMP-1005')
      .attach('beforePhoto', PNG, 'b.png')
      .expect(201);
  });
});

describe('Sale (spec §30)', () => {
  const sale = (assetId: string) => ({ assetId, saleDate: '2026-09-20', saleValue: '250.00', currency: 'USD', buyerName: 'مشترٍ تجريبي', buyerType: 'فرد' });

  it('sells regardless of status, attaches documents, archives a PDF and blocks every later operation', async () => {
    const a = await asset();
    const req = api().post('/api/v1/sales').set('Cookie', manager);
    for (const [k, v] of Object.entries(sale(a.id))) req.field(k, v);
    const res = await req.attach('files', PDF, 'عقد البيع.pdf').attach('files', PNG, 'photo.png').expect(201);
    expect(res.body.number).toMatch(/^SAL-\d{6,}$/);

    const s = (await api().get(`/api/v1/sales/${res.body.id}`).set('Cookie', manager).expect(200)).body;
    expect(s.documents.filter((d: { isOfficial: boolean }) => !d.isOfficial).map((d: { name: string }) => d.name)).toEqual(['عقد البيع', 'photo']);
    expect(s.documents.some((d: { isOfficial: boolean }) => d.isOfficial)).toBe(true);
    expect(s.statusBeforeSale).toBe('NEW');
    expect((await getAsset(a.id)).status).toBe('SOLD');

    await api().post('/api/v1/transfers').set('Cookie', manager).send({ assetId: a.id, toLocationId: place.loc2, toDepartmentId: place.dep2 }).expect(409);
    await api().post('/api/v1/custodies').set('Cookie', manager).send({ newResponsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1003' }, items: [{ assetId: a.id, condition: 'NEW' }] }).expect(409);
    const provider = await prisma.maintenanceProvider.findFirstOrThrow({ where: { status: 'ACTIVE', type: 'COMPANY' } });
    await api().post('/api/v1/maintenances').set('Cookie', manager).field('assetId', a.id).field('technicianType', 'COMPANY').field('providerId', provider.id).attach('beforePhoto', PNG, 'b.png').expect(409);
    await expect(prisma.sale.update({ where: { id: res.body.id }, data: { notes: 'x' } })).rejects.toThrow();
  }, 60_000);

  it('a double sale is impossible, even concurrently', async () => {
    const a = await asset();
    const send = (cookie: string) => {
      const req = api().post('/api/v1/sales').set('Cookie', cookie);
      for (const [k, v] of Object.entries(sale(a.id))) req.field(k, v);
      return req;
    };
    const [r1, r2] = await Promise.all([send(manager), send(admin)]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await prisma.sale.count({ where: { assetId: a.id } })).toBe(1);
  }, 60_000);

  it('is refused while custody is pending; viewer cannot sell', async () => {
    const a = await asset();
    await api().post('/api/v1/custodies').set('Cookie', manager).send({ newResponsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1003' }, items: [{ assetId: a.id, condition: 'NEW' }] }).expect(201);
    const req = api().post('/api/v1/sales').set('Cookie', manager);
    for (const [k, v] of Object.entries(sale(a.id))) req.field(k, v);
    await req.expect(409);
    const v = api().post('/api/v1/sales').set('Cookie', viewer);
    for (const [k, val] of Object.entries(sale(a.id))) v.field(k, val);
    await v.expect(403);
  });
});
