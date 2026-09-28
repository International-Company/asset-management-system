import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MOCK_DIRECTORY } from '../src/modules/eap/mock-eap.provider';
import { PrismaService } from '../src/prisma/prisma.service';
import { createApp, createAssetFixture, login } from './helpers';

let app: INestApplication;
let prisma: PrismaService;
let admin: string;
let manager: string;
const api = () => request(app.getHttpServer());
const tag = () => randomUUID().slice(0, 6);

beforeAll(async () => {
  ({ app, prisma } = await createApp());
  admin = await login(app, 'admin');
  manager = await login(app, 'manager');
});

afterAll(async () => {
  await app.close();
});

describe('Locations, departments and combinations (spec §12)', () => {
  it('creates, links, and exposes only active combinations in lookups', async () => {
    const t = tag();
    const loc = await api().post('/api/v1/locations').set('Cookie', admin).send({ name: `موقع ${t}` }).expect(201);
    const dep = await api().post('/api/v1/departments').set('Cookie', admin).send({ name: `قسم ${t}` }).expect(201);
    await api().post(`/api/v1/locations/${loc.body.id}/departments`).set('Cookie', admin).send({ departmentId: dep.body.id }).expect(201);

    const lookups = async () => (await api().get('/api/v1/lookups/locations').set('Cookie', manager).expect(200)).body;
    let found = (await lookups()).find((l: { id: string }) => l.id === loc.body.id);
    expect(found.departments.map((d: { id: string }) => d.id)).toContain(dep.body.id);

    await api()
      .patch(`/api/v1/locations/${loc.body.id}/departments/${dep.body.id}`)
      .set('Cookie', admin)
      .send({ status: 'INACTIVE' })
      .expect(200);
    found = (await lookups()).find((l: { id: string }) => l.id === loc.body.id);
    expect(found.departments).toEqual([]);

    await api().patch(`/api/v1/locations/${loc.body.id}`).set('Cookie', admin).send({ status: 'INACTIVE' }).expect(200);
    expect((await lookups()).some((l: { id: string }) => l.id === loc.body.id)).toBe(false);
  });

  it('rejects duplicate names case-insensitively', async () => {
    const name = `Branch ${tag()}`;
    await api().post('/api/v1/locations').set('Cookie', admin).send({ name }).expect(201);
    const res = await api().post('/api/v1/locations').set('Cookie', admin).send({ name: name.toUpperCase() }).expect(409);
    expect(res.body.error.code).toBe('DUPLICATE');
  });

  it('deletes an unused location but refuses one used by an asset, suggesting to disable it', async () => {
    const unused = await api().post('/api/v1/locations').set('Cookie', admin).send({ name: `مؤقت ${tag()}` }).expect(201);
    await api().delete(`/api/v1/locations/${unused.body.id}`).set('Cookie', admin).expect(204);

    const asset = await createAssetFixture(prisma);
    const res = await api().delete(`/api/v1/locations/${asset.locationId}`).set('Cookie', admin).expect(409);
    expect(res.body.error.message).toContain('تعطيله');
    expect(await prisma.location.findUnique({ where: { id: asset.locationId } })).not.toBeNull();
  });

  it('every change is written to the audit log', async () => {
    const name = `مدقق ${tag()}`;
    const loc = await api().post('/api/v1/locations').set('Cookie', admin).send({ name }).expect(201);
    const log = await prisma.auditLog.findFirst({ where: { entityType: 'Location', entityId: loc.body.id, operation: 'LOCATION_CREATED' } });
    expect(log?.actorName).toBe('سامي الأحمد');
  });
});

describe('Subcategories (spec §5)', () => {
  it('disabled subcategories disappear from pickers; used ones cannot be deleted', async () => {
    const sub = await api()
      .post('/api/v1/categories/subcategories')
      .set('Cookie', admin)
      .send({ mainCategory: 'OFF', name: `رفوف ${tag()}` })
      .expect(201);
    await api().patch(`/api/v1/categories/subcategories/${sub.body.id}`).set('Cookie', admin).send({ status: 'INACTIVE' }).expect(200);
    const cats = (await api().get('/api/v1/lookups/categories').set('Cookie', manager).expect(200)).body;
    const off = cats.find((c: { code: string }) => c.code === 'OFF');
    expect(off.subcategories.some((s: { id: string }) => s.id === sub.body.id)).toBe(false);

    const used = await createAssetFixture(prisma);
    await api().delete(`/api/v1/categories/subcategories/${used.subcategoryId}`).set('Cookie', admin).expect(409);
  });

  it('main categories are fixed: there is no endpoint to create one', async () => {
    await api().post('/api/v1/categories').set('Cookie', admin).send({ code: 'XYZ' }).expect(404);
  });
});

describe('External people & maintenance providers', () => {
  it('Asset Manager can register external people; the viewer cannot see them', async () => {
    const res = await api()
      .post('/api/v1/external-people')
      .set('Cookie', manager)
      .send({ name: `مقاول ${tag()}`, phone: '0599000000', organization: '' })
      .expect(201);
    expect(res.body.organization).toBeNull();
    const viewer = await login(app, 'viewer');
    await api().get('/api/v1/external-people').set('Cookie', viewer).expect(403);
  });

  it('maintenance providers are managed in settings (admin only)', async () => {
    await api().post('/api/v1/maintenance-providers').set('Cookie', manager).send({ type: 'COMPANY', name: 'x' }).expect(403);
    await api()
      .post('/api/v1/maintenance-providers')
      .set('Cookie', admin)
      .send({ type: 'EMPLOYEE', name: 'employees come from EAP' })
      .expect(400);
    await api().post('/api/v1/maintenance-providers').set('Cookie', admin).send({ type: 'COMPANY', name: `ورشة ${tag()}` }).expect(201);
    await api().get('/api/v1/maintenance-providers').set('Cookie', manager).expect(200);
  });
});

describe('Administration endpoints refuse non-administrators (spec §82)', () => {
  it.each([
    ['post', '/api/v1/locations', { name: 'x' }],
    ['post', '/api/v1/categories/subcategories', { mainCategory: 'OFF', name: 'x' }],
    ['get', '/api/v1/users', undefined],
    ['post', '/api/v1/roles', { name: 'x', permissionKeys: [] }],
    ['get', '/api/v1/settings', undefined],
    ['patch', '/api/v1/settings', { values: {} }],
    ['get', '/api/v1/audit', undefined],
    ['get', '/api/v1/security/logs', undefined],
    ['post', '/api/v1/employees/sync', undefined],
  ] as const)('%s %s → 403 for Asset Manager', async (method, path, body) => {
    const req = api()[method](path).set('Cookie', manager);
    await (body ? req.send(body) : req).expect(403);
  });
});

describe('Roles (spec §44)', () => {
  it('creates a custom role and logs the permission change', async () => {
    const res = await api()
      .post('/api/v1/roles')
      .set('Cookie', admin)
      .send({ name: `أمين مستودع ${tag()}`, permissionKeys: ['assets.view', 'inventory.view'] })
      .expect(201);
    const log = await prisma.securityLog.findFirst({ where: { type: 'PERMISSION_CHANGED', details: { path: ['roleId'], equals: res.body.id } } });
    expect(log).not.toBeNull();

    await api().patch(`/api/v1/roles/${res.body.id}`).set('Cookie', admin).send({ permissionKeys: ['assets.view'] }).expect(200);
    const roles = (await api().get('/api/v1/roles').set('Cookie', admin).expect(200)).body;
    expect(roles.find((r: { id: string }) => r.id === res.body.id).permissionKeys).toEqual(['assets.view']);
  });

  it('rejects unknown permission keys', async () => {
    await api().post('/api/v1/roles').set('Cookie', admin).send({ name: 'x', permissionKeys: ['assets.fly'] }).expect(400);
  });

  it('the System Administrator role can be neither reduced nor disabled', async () => {
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: 'SYSTEM_ADMINISTRATOR' } });
    await api().patch(`/api/v1/roles/${adminRole.id}`).set('Cookie', admin).send({ permissionKeys: ['assets.view'] }).expect(409);
    await api().patch(`/api/v1/roles/${adminRole.id}`).set('Cookie', admin).send({ status: 'INACTIVE' }).expect(409);
  });
});

describe('Users (spec §43, §46)', () => {
  it('creates an account for an EAP employee, who can then sign in; deactivation ends their sessions', async () => {
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'ASSET_MANAGER' } });
    const existing = await prisma.user.findUnique({ where: { username: 'staff2' } });
    let userId = existing?.id;
    if (!existing) {
      const res = await api()
        .post('/api/v1/users')
        .set('Cookie', admin)
        .send({ eapEmployeeId: 'EMP-1006', username: 'Staff2', roleIds: [managerRole.id] })
        .expect(201);
      expect(res.body.username).toBe('staff2');
      userId = res.body.id;
    } else {
      await api().patch(`/api/v1/users/${userId}`).set('Cookie', admin).send({ isActive: true }).expect(200);
      await api().put(`/api/v1/users/${userId}/roles`).set('Cookie', admin).send({ roleIds: [managerRole.id] }).expect(200);
    }

    const staff = await login(app, 'staff2');
    await api().get('/api/v1/auth/me').set('Cookie', staff).expect(200);

    await api().patch(`/api/v1/users/${userId}`).set('Cookie', admin).send({ isActive: false }).expect(200);
    await api().get('/api/v1/auth/me').set('Cookie', staff).expect(401);
    const log = await prisma.securityLog.findFirst({ where: { userId, type: 'USER_DEACTIVATED' }, orderBy: { id: 'desc' } });
    expect(log).not.toBeNull();
  });

  it('refuses a second account for the same employee and accounts for inactive employees', async () => {
    const res = await api().post('/api/v1/users').set('Cookie', admin).send({ eapEmployeeId: 'EMP-1001', username: 'other', roleIds: [] }).expect(409);
    expect(res.body.error.code).toBe('DUPLICATE');
    await api().post('/api/v1/users').set('Cookie', admin).send({ eapEmployeeId: 'EMP-1007', username: 'former', roleIds: [] }).expect(409);
  });

  it('an administrator cannot deactivate themselves or remove the last System Administrator', async () => {
    const me = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    await api().patch(`/api/v1/users/${me.id}`).set('Cookie', admin).send({ isActive: false }).expect(409);
    const res = await api().put(`/api/v1/users/${me.id}/roles`).set('Cookie', admin).send({ roleIds: [] }).expect(409);
    expect(res.body.error.message).toContain('مدير النظام');
    const roles = await prisma.userRole.count({ where: { userId: me.id } });
    expect(roles).toBeGreaterThan(0);
  });

  it('role changes are logged in the security log and apply immediately', async () => {
    const viewer = await prisma.user.findUniqueOrThrow({ where: { username: 'viewer' } });
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'VIEWER' } });
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'ASSET_MANAGER' } });
    const viewerSession = await login(app, 'viewer');

    await api().put(`/api/v1/users/${viewer.id}/roles`).set('Cookie', admin).send({ roleIds: [viewerRole.id, managerRole.id] }).expect(200);
    await api().get('/api/v1/external-people').set('Cookie', viewerSession).expect(200);

    await api().put(`/api/v1/users/${viewer.id}/roles`).set('Cookie', admin).send({ roleIds: [viewerRole.id] }).expect(200);
    await api().get('/api/v1/external-people').set('Cookie', viewerSession).expect(403);

    const logs = await prisma.securityLog.count({ where: { userId: viewer.id, type: 'ROLE_CHANGED' } });
    expect(logs).toBeGreaterThanOrEqual(2);
  });

  it('unlocks a locked account', async () => {
    const staff1 = await prisma.user.findUnique({ where: { username: 'staff1' } });
    if (!staff1) return; // created by auth.test.ts
    await prisma.user.update({ where: { id: staff1.id }, data: { lockedUntil: new Date(Date.now() + 3_600_000) } });
    const res = await api().post(`/api/v1/users/${staff1.id}/unlock`).set('Cookie', admin).expect(200);
    expect(res.body.lockedUntil).toBeNull();
  });
});

describe('Settings (spec §64)', () => {
  it('validates each value and records security changes in both logs', async () => {
    const bad = await api()
      .patch('/api/v1/settings')
      .set('Cookie', admin)
      .send({ values: { 'security.maxFailedAttempts': 1, 'files.allowedExtensions': ['exe'], unknown: 1 } })
      .expect(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['files.allowedExtensions', 'security.maxFailedAttempts', 'unknown']);

    const current = (await api().get('/api/v1/settings').set('Cookie', admin).expect(200)).body.values['security.lockoutMinutes'];
    const next = current === 15 ? 20 : 15;
    await api().patch('/api/v1/settings').set('Cookie', admin).send({ values: { 'security.lockoutMinutes': next } }).expect(200);
    const sec = await prisma.securityLog.findFirst({ where: { type: 'SECURITY_SETTING_CHANGED' }, orderBy: { id: 'desc' } });
    expect(sec?.details).toMatchObject({ key: 'security.lockoutMinutes', old: current, new: next });
    // Restore the default so other tests see 15 minutes.
    await api().patch('/api/v1/settings').set('Cookie', admin).send({ values: { 'security.lockoutMinutes': 15 } }).expect(200);
  });

  it('company name changes appear on the login screen', async () => {
    const name = `شركة الاختبار ${tag()}`;
    await api().patch('/api/v1/settings').set('Cookie', admin).send({ values: { 'company.nameAr': name } }).expect(200);
    const cfg = await api().get('/api/v1/auth/config').expect(200);
    expect(cfg.body.company.nameAr).toBe(name);
  });

  it('number sequences only move forward (numbers are never reused)', async () => {
    const seqs = (await api().get('/api/v1/settings/sequences').set('Cookie', admin).expect(200)).body;
    const inv = seqs.find((s: { key: string }) => s.key === 'OP:INV');
    await api()
      .patch(`/api/v1/settings/sequences/${encodeURIComponent('OP:INV')}`)
      .set('Cookie', admin)
      .send({ nextValue: inv.nextValue - 1 < 1 ? 0 : inv.nextValue - 1 })
      .expect(400);
    const res = await api()
      .patch(`/api/v1/settings/sequences/${encodeURIComponent('OP:INV')}`)
      .set('Cookie', admin)
      .send({ nextValue: inv.nextValue + 10, digits: 7 })
      .expect(200);
    expect(res.body.preview).toBe(`INV-${String(inv.nextValue + 10).padStart(7, '0')}`);
  });

  it('adds currencies and refuses to disable the default currency', async () => {
    const code = `X${tag().replace(/[^A-Za-z]/g, 'Q').slice(0, 2).toUpperCase().padEnd(2, 'Q')}`;
    await api().post('/api/v1/settings/currencies').set('Cookie', admin).send({ code, nameAr: 'عملة تجريبية' }).expect((r) => {
      if (r.status !== 201 && r.status !== 409) throw new Error(`unexpected ${r.status}`);
    });
    const def = (await api().get('/api/v1/settings').set('Cookie', admin).expect(200)).body.values['currency.default'];
    await api().patch(`/api/v1/settings/currencies/${def}`).set('Cookie', admin).send({ status: 'INACTIVE' }).expect(409);
  });
});

describe('Log viewers (spec §50, §51)', () => {
  it('audit log is searchable and filterable; there is no way to modify it', async () => {
    const res = await api().get('/api/v1/audit?entityType=Location&pageSize=25').set('Cookie', admin).expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((i: { entityType: string }) => i.entityType === 'Location')).toBe(true);
    await api().delete('/api/v1/audit').set('Cookie', admin).expect(404);
  });

  it('security log filters by event type', async () => {
    const res = await api().get('/api/v1/security/logs?type=LOGIN_SUCCESS').set('Cookie', admin).expect(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.items.every((i: { type: string }) => i.type === 'LOGIN_SUCCESS')).toBe(true);
  });

  it('rejects invalid page sizes', async () => {
    await api().get('/api/v1/audit?pageSize=33').set('Cookie', admin).expect(400);
  });
});

describe('EAP employee sync (spec §46)', () => {
  it('an employee who becomes inactive while responsible for assets raises an alert; history is untouched', async () => {
    const person = MOCK_DIRECTORY.find((p) => p.eapEmployeeId === 'EMP-1005')!;
    const employee = await prisma.employee.findUniqueOrThrow({ where: { eapEmployeeId: 'EMP-1005' } });
    await prisma.employee.update({ where: { id: employee.id }, data: { isActive: true } });

    await createAssetFixture(prisma, { responsibleEmployeeId: employee.id });
    const before = await prisma.notification.count({ where: { typeKey: 'employee.inactive_responsible' } });

    person.isActive = false;
    try {
      const res = await api().post('/api/v1/employees/sync').set('Cookie', admin).expect(200);
      expect(res.body.deactivated).toBeGreaterThanOrEqual(1);
    } finally {
      person.isActive = true;
    }

    const after = await prisma.notification.count({ where: { typeKey: 'employee.inactive_responsible' } });
    expect(after).toBeGreaterThan(before);
    const inactive = (await api().get('/api/v1/employees/inactive-responsibles').set('Cookie', admin).expect(200)).body;
    expect(inactive.some((e: { id: string }) => e.id === employee.id)).toBe(true);

    // Reactivate for other tests.
    await api().post('/api/v1/employees/sync').set('Cookie', admin).expect(200);
  });

  it('directory search marks employees who already have an account', async () => {
    const res = await api().get('/api/v1/employees/directory?q=سامي').set('Cookie', admin).expect(200);
    expect(res.body[0].user.username).toBe('admin');
  });
});
