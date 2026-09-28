import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createApp, login } from './helpers';

let app: INestApplication;
let prisma: PrismaService;
let admin: string;
let manager: string;
let viewer: string;
const api = () => request(app.getHttpServer());
const binary = (r: request.Test) =>
  r.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

beforeAll(async () => {
  ({ app, prisma } = await createApp());
  [admin, manager, viewer] = await Promise.all([login(app, 'admin'), login(app, 'manager'), login(app, 'viewer')]);
});

afterAll(async () => {
  await app.close();
});

async function asset(extra: Record<string, unknown> = {}) {
  const sub = await prisma.subcategory.findFirstOrThrow({ where: { mainCategory: 'TEC', status: 'ACTIVE' } });
  const ld = await prisma.locationDepartment.findFirstOrThrow({ where: { status: 'ACTIVE', location: { status: 'ACTIVE' }, department: { status: 'ACTIVE' } } });
  const res = await api()
    .post('/api/v1/assets')
    .set('Cookie', manager)
    .send({ name: 'أصل بحث', subcategoryId: sub.id, locationId: ld.locationId, departmentId: ld.departmentId, responsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1002' }, ...extra })
    .expect(201);
  return res.body as { id: string; assetNumber: string };
}
const ids = async (qs: string) => ((await api().get(`/api/v1/assets?${qs}&pageSize=250&sort=createdAt&order=desc`).set('Cookie', manager).expect(200)).body.items as Array<{ id: string }>).map((i) => i.id);

describe('Advanced search (spec §41)', () => {
  it('combines conditions: warranty expiry, internal serial, supplier, several statuses', async () => {
    const supplier = `مورد ${randomUUID().slice(0, 6)}`;
    const soon = await asset({ purchase: { supplier }, warranty: { exists: true, expiresAt: '2026-10-15' } });
    const later = await asset({ purchase: { supplier }, warranty: { exists: true, expiresAt: '2030-01-01' } });
    const serial = await asset({ purchase: { supplier }, serialNumber: `REAL-${randomUUID().slice(0, 8)}` });

    expect((await ids(`supplier=${encodeURIComponent(supplier)}&warrantyUntil=2026-12-31`))).toEqual([soon.id]);
    expect((await ids(`supplier=${encodeURIComponent(supplier)}&serialInternal=false`))).toEqual([serial.id]);
    expect((await ids(`supplier=${encodeURIComponent(supplier)}&statusIn=NEW,IN_USE`)).sort()).toEqual([soon.id, later.id, serial.id].sort());
    expect(await ids(`supplier=${encodeURIComponent(supplier)}&statusIn=SOLD`)).toEqual([]);
  });

  it('rejects invalid conditions', async () => {
    await api().get('/api/v1/assets?statusIn=NEW,FLYING').set('Cookie', manager).expect(400);
    await api().get('/api/v1/assets?createdFrom=yesterday').set('Cookie', manager).expect(400);
  });
});

describe('Saved searches (spec §42)', () => {
  it('are private by default; only users with the share permission can share them', async () => {
    const mine = (await api().post('/api/v1/saved-searches').set('Cookie', manager).send({ scope: 'assets', name: 'أجهزة جديدة', filters: { status: 'NEW' }, columns: ['number', 'name'] }).expect(201)).body;
    expect((await api().get('/api/v1/saved-searches?scope=assets').set('Cookie', manager).expect(200)).body.map((s: { id: string }) => s.id)).toContain(mine.id);
    expect((await api().get('/api/v1/saved-searches?scope=assets').set('Cookie', viewer).expect(200)).body.map((s: { id: string }) => s.id)).not.toContain(mine.id);
    await api().put(`/api/v1/saved-searches/${mine.id}/shares`).set('Cookie', manager).send({ roleIds: [], userIds: [] }).expect(403);
    await api().delete(`/api/v1/saved-searches/${mine.id}`).set('Cookie', viewer).expect(404);
    await api().delete(`/api/v1/saved-searches/${mine.id}`).set('Cookie', manager).expect(204);
  });

  it('the administrator shares a filter with a role', async () => {
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'ASSET_MANAGER' } });
    const shared = (await api().post('/api/v1/saved-searches').set('Cookie', admin).send({ scope: 'assets', name: `ضمان ينتهي ${randomUUID().slice(0, 4)}`, filters: { warrantyUntil: '2026-12-31' } }).expect(201)).body;
    await api().put(`/api/v1/saved-searches/${shared.id}/shares`).set('Cookie', admin).send({ roleIds: [managerRole.id], userIds: [] }).expect(200);
    const seen = (await api().get('/api/v1/saved-searches?scope=assets').set('Cookie', manager).expect(200)).body.find((s: { id: string }) => s.id === shared.id);
    expect(seen).toMatchObject({ mine: false, ownerName: 'سامي الأحمد', filters: { warrantyUntil: '2026-12-31' } });
    // A shared search cannot be changed by the people it is shared with.
    await api().patch(`/api/v1/saved-searches/${shared.id}`).set('Cookie', manager).send({ name: 'x' }).expect(404);
  });

  it('rejects malformed filters', async () => {
    await api().post('/api/v1/saved-searches').set('Cookie', manager).send({ scope: 'assets', name: 'x', filters: { 'bad key': 'v' } }).expect(400);
    await api().post('/api/v1/saved-searches').set('Cookie', manager).send({ scope: 'Bad Scope', name: 'x', filters: {} }).expect(400);
  });
});

describe('Notifications (spec §39)', () => {
  it('users read their own notifications; only the administrator sees all; nobody deletes', async () => {
    const managerUser = await prisma.user.findUniqueOrThrow({ where: { username: 'manager' } });
    await prisma.notification.create({ data: { userId: managerUser.id, typeKey: 'transfer.created', title: 'إشعار اختبار' } });
    const count = (await api().get('/api/v1/notifications/unread-count').set('Cookie', manager).expect(200)).body.count;
    expect(count).toBeGreaterThan(0);
    const list = (await api().get('/api/v1/notifications?unread=true').set('Cookie', manager).expect(200)).body;
    const n = list.items.find((i: { title: string }) => i.title === 'إشعار اختبار');
    expect(n.type.label).toBe('نقل أصل');
    await api().post(`/api/v1/notifications/${n.id}/read`).set('Cookie', manager).expect(200);
    await api().post(`/api/v1/notifications/${n.id}/read`).set('Cookie', viewer).expect(404);
    await api().post('/api/v1/notifications/read-all').set('Cookie', manager).expect(200);
    expect((await api().get('/api/v1/notifications/unread-count').set('Cookie', manager).expect(200)).body.count).toBe(0);

    await api().get('/api/v1/notifications?all=true').set('Cookie', manager).expect(403);
    const all = (await api().get('/api/v1/notifications?all=true').set('Cookie', admin).expect(200)).body;
    expect(all.items.some((i: { user?: { username: string } }) => i.user?.username === 'manager')).toBe(true);
    await api().delete(`/api/v1/notifications/${n.id}`).set('Cookie', admin).expect(404);
    await expect(prisma.notification.delete({ where: { id: n.id } })).rejects.toThrow();
  });

  it('a disabled type sends nothing; recipients are configurable (administrator only)', async () => {
    await api().get('/api/v1/notification-types').set('Cookie', manager).expect(403);
    const types = (await api().get('/api/v1/notification-types').set('Cookie', admin).expect(200)).body;
    expect(types.find((t: { key: string }) => t.key === 'custody.created')).toMatchObject({ targetResponsible: true });

    await api().patch('/api/v1/notification-types/custody.created').set('Cookie', admin).send({ isEnabled: false }).expect(200);
    try {
      const a = await asset();
      const c = (await api().post('/api/v1/custodies').set('Cookie', manager).send({ newResponsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1003' }, items: [{ assetId: a.id, condition: 'NEW' }] }).expect(201)).body;
      expect(await prisma.notification.count({ where: { entityId: c.id, typeKey: 'custody.created' } })).toBe(0);
    } finally {
      await api().patch('/api/v1/notification-types/custody.created').set('Cookie', admin).send({ isEnabled: true }).expect(200);
    }

    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'ASSET_MANAGER' } });
    await api().put('/api/v1/notification-types/transfer.created/recipients').set('Cookie', admin).send({ roleIds: [managerRole.id], userIds: [], targetResponsible: false }).expect(200);
    const after = (await api().get('/api/v1/notification-types').set('Cookie', admin).expect(200)).body.find((t: { key: string }) => t.key === 'transfer.created');
    expect(after.roles.map((r: { id: string }) => r.id)).toEqual([managerRole.id]);
    expect(await prisma.auditLog.count({ where: { entityId: 'transfer.created', operation: 'NOTIFICATION_RECIPIENTS_CHANGED' } })).toBeGreaterThan(0);
  });
});

describe('Reports (spec §40)', () => {
  it('the catalogue follows permissions', async () => {
    await api().get('/api/v1/reports').set('Cookie', viewer).expect(403);
    const managerKeys = (await api().get('/api/v1/reports').set('Cookie', manager).expect(200)).body.map((r: { key: string }) => r.key);
    expect(managerKeys).toEqual(expect.arrayContaining(['assets', 'custody', 'transfers', 'inventory', 'maintenance', 'sales', 'by-location', 'by-department', 'by-category', 'by-status']));
    expect(managerKeys).not.toContain('audit');
    const adminKeys = (await api().get('/api/v1/reports').set('Cookie', admin).expect(200)).body.map((r: { key: string }) => r.key);
    expect(adminKeys).toEqual(expect.arrayContaining(['audit', 'security']));
    await api().post('/api/v1/reports/audit/preview').set('Cookie', manager).send({ filters: {} }).expect(403);
  });

  it('previews with validated filters', async () => {
    const res = (await api().post('/api/v1/reports/assets/preview').set('Cookie', manager).send({ filters: { status: 'NEW' } }).expect(200)).body;
    expect(res.columns[0]).toMatchObject({ key: 'assetNumber', label: 'رقم الأصل' });
    expect(res.rows.every((r: { status: string }) => r.status === 'جديد')).toBe(true);
    await api().post('/api/v1/reports/assets/preview').set('Cookie', manager).send({ filters: { status: 'FLYING' } }).expect(400);
    await api().post('/api/v1/reports/assets/preview').set('Cookie', manager).send({ filters: { unknown: 'x' } }).expect(400);
    const byStatus = (await api().post('/api/v1/reports/by-status/preview').set('Cookie', manager).send({ filters: {} }).expect(200)).body;
    const total = byStatus.rows.reduce((n: number, r: { count: number }) => n + r.count, 0);
    expect(total).toBe(await prisma.asset.count());
  });

  it('exports Arabic Excel (RTL) and PDF, and logs each export in the audit log', async () => {
    const xlsx = await binary(api().post('/api/v1/reports/assets/export').set('Cookie', manager).send({ filters: { status: 'NEW' }, format: 'xlsx' })).expect(200);
    expect(xlsx.headers['content-disposition']).toContain(encodeURIComponent('تقرير الأصول'));
    const wb = new ExcelJS.Workbook();
    // exceljs types expect an older Buffer type; the runtime accepts a Node Buffer.
    await wb.xlsx.load(xlsx.body as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    expect(ws.views[0].rightToLeft).toBe(true);
    expect(ws.getRow(2).getCell(1).value).toBe('تقرير الأصول');
    expect(ws.getRow(6).getCell(1).value).toBe('رقم الأصل');

    const pdf = await binary(api().post('/api/v1/reports/sales/export').set('Cookie', manager).send({ filters: { from: '2026-01-01' }, format: 'pdf' })).expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const logs = await prisma.auditLog.findMany({ where: { operation: 'REPORT_EXPORTED', actorName: 'ليلى حسن' }, orderBy: { id: 'desc' }, take: 2 });
    expect(logs.map((l) => (l.metadata as { format: string }).format).sort()).toEqual(['pdf', 'xlsx']);
    expect(logs.find((l) => l.entityId === 'assets')?.metadata).toMatchObject({ report: 'تقرير الأصول', filters: { status: 'NEW' }, format: 'xlsx' });
  }, 60_000);
});
