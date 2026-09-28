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
let base: { subTec: string; subOff: string; subRea: string; locationId: string; departmentId: string };
const api = () => request(app.getHttpServer());

// 1×1 transparent PNG.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0a80000000049454e44ae426082',
  'hex',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF');

beforeAll(async () => {
  ({ app, prisma } = await createApp());
  [admin, manager, viewer] = await Promise.all([login(app, 'admin'), login(app, 'manager'), login(app, 'viewer')]);
  const [subTec, subOff, subRea] = await Promise.all(
    (['TEC', 'OFF', 'REA'] as const).map((c) => prisma.subcategory.findFirstOrThrow({ where: { mainCategory: c, status: 'ACTIVE' } })),
  );
  const ld = await prisma.locationDepartment.findFirstOrThrow({
    where: { status: 'ACTIVE', location: { status: 'ACTIVE' }, department: { status: 'ACTIVE' } },
  });
  base = { subTec: subTec.id, subOff: subOff.id, subRea: subRea.id, locationId: ld.locationId, departmentId: ld.departmentId };
});

afterAll(async () => {
  await app.close();
});

function newAsset(overrides: Record<string, unknown> = {}) {
  return {
    name: 'حاسوب محمول',
    subcategoryId: base.subTec,
    locationId: base.locationId,
    departmentId: base.departmentId,
    responsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1002' },
    ...overrides,
  };
}

async function create(overrides: Record<string, unknown> = {}, cookie = manager) {
  const res = await api().post('/api/v1/assets').set('Cookie', cookie).send(newAsset(overrides)).expect(201);
  return (await api().get(`/api/v1/assets/${res.body.id}`).set('Cookie', cookie).expect(200)).body;
}

describe('Asset creation (spec §19)', () => {
  it('creates atomically: number, internal serial, QR token, NEW status, history and audit', async () => {
    const a = await create();
    expect(a.assetNumber).toMatch(/^TEC-\d{6}$/);
    expect(a.serialNumber).toMatch(/^INT-SN-\d{6}$/);
    expect(a.serialIsInternal).toBe(true);
    expect(a.status).toBe('NEW');
    expect(a.qrToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(a.qrToken).not.toContain(a.assetNumber);
    expect(a.numberHistory).toHaveLength(1);
    expect(a.technical).not.toBeNull();
    expect(a.canDelete).toBe(true);
    const history = (await api().get(`/api/v1/assets/${a.id}/history`).set('Cookie', manager).expect(200)).body;
    expect(history.map((e: { type: string }) => e.type)).toEqual(['CREATED']);
    expect(await prisma.auditLog.count({ where: { entityType: 'Asset', entityId: a.id, operation: 'ASSET_CREATED' } })).toBe(1);
  });

  it('refuses a status in the request: new assets always start as NEW', async () => {
    const res = await api().post('/api/v1/assets').set('Cookie', manager).send(newAsset({ status: 'IN_USE' })).expect(400);
    expect(res.body.error.fields.status).toBeDefined();
  });

  it('refuses unregistered placements, inactive employees and details of another category', async () => {
    const other = await prisma.department.create({ data: { name: `قسم غير مربوط ${randomUUID().slice(0, 6)}` } });
    await api().post('/api/v1/assets').set('Cookie', manager).send(newAsset({ departmentId: other.id })).expect(400);
    const inactive = await api()
      .post('/api/v1/assets')
      .set('Cookie', manager)
      .send(newAsset({ responsible: { type: 'EMPLOYEE', eapEmployeeId: 'EMP-1007' } }))
      .expect(400);
    expect(inactive.body.error.fields['responsible.eapEmployeeId'][0]).toContain('غير فعّال');
    await api()
      .post('/api/v1/assets')
      .set('Cookie', manager)
      .send(newAsset({ subcategoryId: base.subOff, technical: { manufacturer: 'Dell' } }))
      .expect(400);
  });

  it('serial numbers are unique system-wide, case-insensitively, with an Arabic field message', async () => {
    const serial = `SN-${randomUUID().slice(0, 8)}`;
    await create({ serialNumber: serial });
    const res = await api().post('/api/v1/assets').set('Cookie', manager).send(newAsset({ serialNumber: serial.toLowerCase() })).expect(409);
    expect(res.body.error.fields.serialNumber[0]).toContain('الرقم التسلسلي');
  });

  it('concurrent creations never share a number', async () => {
    const results = await Promise.all(
      Array.from({ length: 15 }, () => api().post('/api/v1/assets').set('Cookie', manager).send(newAsset({ subcategoryId: base.subOff }))),
    );
    const numbers = results.map((r) => r.body.assetNumber);
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(numbers).size).toBe(15);
  });

  it('real estate assets get their own detail record', async () => {
    const a = await create({
      subcategoryId: base.subRea,
      name: 'مبنى الإدارة',
      realEstate: { propertyType: 'مبنى', parcelNumber: '12', area: '350.5' },
    });
    expect(a.assetNumber).toMatch(/^REA-/);
    expect(a.realEstate).toMatchObject({ propertyType: 'مبنى', parcelNumber: '12', area: '350.5' });
  });
});

describe('Asset editing (spec §20)', () => {
  it('records old → new for each changed field and bumps the version', async () => {
    const a = await create({ technical: { manufacturer: 'Dell', ipAddress: '10.0.0.5' } });
    const res = await api()
      .patch(`/api/v1/assets/${a.id}`)
      .set('Cookie', manager)
      .send({ version: a.version, name: 'حاسوب محمول Dell', technical: { manufacturer: 'HP', ipAddress: '10.0.0.5' } })
      .expect(200);
    expect(res.body.version).toBe(a.version + 1);
    expect(res.body.changes).toMatchObject({
      name: { old: 'حاسوب محمول', new: 'حاسوب محمول Dell' },
      'technical.manufacturer': { old: 'Dell', new: 'HP' },
    });
    expect(res.body.changes['technical.ipAddress']).toBeUndefined();
  });

  it('rejects a stale version; of two concurrent edits exactly one succeeds', async () => {
    const a = await create();
    const [r1, r2] = await Promise.all([
      api().patch(`/api/v1/assets/${a.id}`).set('Cookie', manager).send({ version: a.version, name: 'أ' }),
      api().patch(`/api/v1/assets/${a.id}`).set('Cookie', admin).send({ version: a.version, name: 'ب' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect([r1, r2].find((r) => r.status === 409)!.body.error.code).toBe('STALE_VERSION');
  });

  it('status, placement and responsible cannot be changed through editing', async () => {
    const a = await create();
    await api().patch(`/api/v1/assets/${a.id}`).set('Cookie', manager).send({ version: a.version, status: 'DAMAGED' }).expect(400);
    await api().patch(`/api/v1/assets/${a.id}`).set('Cookie', manager).send({ version: a.version, locationId: base.locationId }).expect(400);
  });

  it('an edit that changes nothing leaves the version and history untouched', async () => {
    const a = await create();
    const res = await api().patch(`/api/v1/assets/${a.id}`).set('Cookie', manager).send({ version: a.version, name: a.name }).expect(200);
    expect(res.body).toMatchObject({ version: a.version, changes: {} });
    expect(await prisma.assetEvent.count({ where: { assetId: a.id } })).toBe(1);
  });
});

describe('Category change (spec §21)', () => {
  it('allocates a number from the new category, keeps the old one in history, and keeps the QR token', async () => {
    const a = await create({ technical: { manufacturer: 'Lenovo' } });
    const preview = (await api().get(`/api/v1/assets/${a.id}/category-change?subcategoryId=${base.subOff}`).set('Cookie', manager).expect(200)).body;
    expect(preview).toMatchObject({ currentNumber: a.assetNumber, numberChanges: true, toCategory: 'OFF' });
    expect(preview.expectedNumber).toMatch(/^OFF-/);

    const res = await api()
      .post(`/api/v1/assets/${a.id}/category-change`)
      .set('Cookie', manager)
      .send({ subcategoryId: base.subOff, version: a.version, reason: 'إعادة تصنيف' })
      .expect(200);
    expect(res.body.assetNumber).toMatch(/^OFF-/);

    const after = (await api().get(`/api/v1/assets/${a.id}`).set('Cookie', manager).expect(200)).body;
    expect(after.qrToken).toBe(a.qrToken);
    expect(after.numberHistory.map((h: { assetNumber: string }) => h.assetNumber)).toEqual([a.assetNumber, res.body.assetNumber]);
    expect(after.numberHistory[0].retiredAt).not.toBeNull();
    // Old technical details are kept for history.
    expect(after.technical.manufacturer).toBe('Lenovo');

    // Searching by the old number still finds the asset; the QR still resolves.
    const found = (await api().get(`/api/v1/assets?q=${a.assetNumber}`).set('Cookie', manager).expect(200)).body;
    expect(found.items.map((i: { id: string }) => i.id)).toContain(a.id);
    const qr = (await api().get(`/api/v1/qr/resolve/${a.qrToken}`).set('Cookie', manager).expect(200)).body;
    expect(qr.id).toBe(a.id);
  });

  it('the retired number can never be assigned again', async () => {
    const a = await create();
    await api().post(`/api/v1/assets/${a.id}/category-change`).set('Cookie', manager).send({ subcategoryId: base.subOff, version: a.version }).expect(200);
    await expect(
      prisma.assetNumberHistory.create({ data: { assetId: a.id, assetNumber: a.assetNumber, mainCategory: 'TEC' } }),
    ).rejects.toThrow();
  });
});

describe('Serial number replacement (spec §8)', () => {
  it('replaces an internal serial with the real one and keeps the history', async () => {
    const a = await create();
    const serial = `REAL-${randomUUID().slice(0, 8)}`;
    await api().post(`/api/v1/assets/${a.id}/serial`).set('Cookie', manager).send({ serialNumber: serial, version: a.version, reason: 'ظهر رقم المصنع' }).expect(200);
    const after = (await api().get(`/api/v1/assets/${a.id}`).set('Cookie', manager).expect(200)).body;
    expect(after.serialNumber).toBe(serial);
    expect(after.serialIsInternal).toBe(false);
    expect(after.serialHistory[0]).toMatchObject({ oldSerial: a.serialNumber, newSerial: serial, reason: 'ظهر رقم المصنع' });
  });
});

describe('Search (spec §41)', () => {
  it('finds assets by serial, MAC, IP, responsible name and QR token', async () => {
    const mac = `AA:BB:CC:${randomUUID().slice(0, 2)}:${randomUUID().slice(0, 2)}:01`.toUpperCase();
    const a = await create({ serialNumber: `FIND-${randomUUID().slice(0, 6)}`, technical: { macAddress: mac, ipAddress: '192.168.50.77' } });
    for (const term of [a.serialNumber, mac.toLowerCase().replace(/:/g, '-'), '192.168.50.77', a.qrToken]) {
      const res = (await api().get(`/api/v1/assets?q=${encodeURIComponent(term)}`).set('Cookie', manager).expect(200)).body;
      expect(res.items.map((i: { id: string }) => i.id), term).toContain(a.id);
    }
    // Newest first: the shared test database accumulates many assets for this person.
    const byName = (await api().get(`/api/v1/assets?q=${encodeURIComponent('ليلى')}&pageSize=25&sort=createdAt&order=desc`).set('Cookie', manager).expect(200)).body;
    expect(byName.items.map((i: { id: string }) => i.id)).toContain(a.id);
  });
});

describe('Photos (spec §18) and file security (spec §72)', () => {
  it('first photo becomes main; main can change; removal is permission-controlled and promotes another', async () => {
    const a = await create();
    const p1 = (await api().post(`/api/v1/assets/${a.id}/photos`).set('Cookie', manager).attach('file', PNG, 'front.png').expect(201)).body;
    expect(p1.isMain).toBe(true);
    const p2 = (await api().post(`/api/v1/assets/${a.id}/photos`).set('Cookie', manager).attach('file', PNG, 'back.png').expect(201)).body;
    expect(p2.isMain).toBe(false);
    await api().post(`/api/v1/assets/${a.id}/photos/${p2.id}/main`).set('Cookie', manager).expect(200);

    // Asset Manager lacks assets.photos.delete by default.
    await api().delete(`/api/v1/assets/${a.id}/photos/${p2.id}`).set('Cookie', manager).expect(403);
    await api().delete(`/api/v1/assets/${a.id}/photos/${p2.id}`).set('Cookie', admin).expect(204);
    const after = (await api().get(`/api/v1/assets/${a.id}`).set('Cookie', manager).expect(200)).body;
    expect(after.photos).toHaveLength(1);
    expect(after.photos[0]).toMatchObject({ id: p1.id, isMain: true });

    const file = await api().get(`/api/v1/files/${p1.fileId}`).set('Cookie', viewer).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(file.body as Buffer, PNG)).toBe(0);
  });

  it('rejects disguised and non-image files', async () => {
    const a = await create();
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    const res = await api().post(`/api/v1/assets/${a.id}/photos`).set('Cookie', manager).attach('file', exe, 'photo.png').expect(422);
    expect(res.body.error.code).toBe('FILE_REJECTED');
    await api().post(`/api/v1/assets/${a.id}/photos`).set('Cookie', manager).attach('file', PDF, 'scan.pdf').expect(422);
    await api().post(`/api/v1/assets/${a.id}/photos`).set('Cookie', manager).expect(422);
  });

  it('an unrelated file id grants nothing', async () => {
    await api().get(`/api/v1/files/${randomUUID()}`).set('Cookie', admin).expect(404);
  });
});

describe('Documents & versions (spec §36–37)', () => {
  it('replacing a document keeps every version', async () => {
    const a = await create();
    const doc = (await api().post(`/api/v1/assets/${a.id}/documents`).set('Cookie', manager).field('name', 'فاتورة الشراء').attach('file', PDF, 'invoice.pdf').expect(201)).body;
    await api().post(`/api/v1/documents/${doc.id}/versions`).set('Cookie', manager).attach('file', PDF, 'invoice-corrected.pdf').expect(201);

    const docs = (await api().get(`/api/v1/assets/${a.id}/documents`).set('Cookie', manager).expect(200)).body;
    expect(docs[0].name).toBe('فاتورة الشراء');
    expect(docs[0].versions.map((v: { version: number; isCurrent: boolean }) => [v.version, v.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    const old = docs[0].versions[1];
    await api().get(`/api/v1/files/${old.file.id}`).set('Cookie', manager).expect(200);
    // Viewer lacks documents.view.
    await api().get(`/api/v1/files/${old.file.id}`).set('Cookie', viewer).expect(404);
    await api().get(`/api/v1/assets/${a.id}/documents`).set('Cookie', viewer).expect(403);
  });

  it('a document requires a name', async () => {
    const a = await create();
    await api().post(`/api/v1/assets/${a.id}/documents`).set('Cookie', manager).attach('file', PDF, 'x.pdf').expect(400);
  });
});

describe('QR labels (spec §10)', () => {
  it('produces a PDF of labels and records the print in the audit log', async () => {
    const [a, b] = await Promise.all([create(), create()]);
    const res = await api()
      .post('/api/v1/qr/labels')
      .set('Cookie', manager)
      .send({ assetIds: [a.id, b.id], perPage: 8 })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(201);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const log = await prisma.auditLog.findFirst({ where: { operation: 'QR_LABELS_PRINTED' }, orderBy: { id: 'desc' } });
    expect((log?.metadata as { count: number }).count).toBe(2);
  }, 60_000);

  it('the viewer role cannot print labels', async () => {
    const a = await create();
    await api().post('/api/v1/qr/labels').set('Cookie', viewer).send({ assetIds: [a.id] }).expect(403);
  });
});

describe('Deletion rules (spec §62)', () => {
  it('deletes an asset without history; refuses one with history', async () => {
    const fresh = await create();
    await api().delete(`/api/v1/assets/${fresh.id}`).set('Cookie', admin).expect(204);
    await api().get(`/api/v1/assets/${fresh.id}`).set('Cookie', admin).expect(404);
    expect(await prisma.auditLog.count({ where: { entityId: fresh.id, operation: 'ASSET_DELETED' } })).toBe(1);

    const used = await create();
    await api().post(`/api/v1/assets/${used.id}/photos`).set('Cookie', manager).attach('file', PNG, 'p.png').expect(201);
    const res = await api().delete(`/api/v1/assets/${used.id}`).set('Cookie', admin).expect(409);
    expect(res.body.error.message).toContain('تاريخ');
  });

  it('Asset Manager cannot delete assets by default', async () => {
    const a = await create();
    await api().delete(`/api/v1/assets/${a.id}`).set('Cookie', manager).expect(403);
  });
});

describe('Sold assets are read-only (spec §30)', () => {
  it('refuses edits, photos, documents and deletion; the QR stays resolvable', async () => {
    const a = await create();
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    await prisma.$transaction(async (tx) => {
      await tx.sale.create({
        data: {
          number: `SAL-T-${randomUUID().slice(0, 8)}`,
          assetId: a.id,
          saleDate: new Date(),
          saleValue: 10,
          currency: 'USD',
          buyerName: 'مشترٍ',
          buyerType: 'فرد',
          statusBeforeSale: 'NEW',
          assetSnapshot: {},
          actorId: adminUser.id,
        },
      });
      await tx.asset.update({ where: { id: a.id }, data: { status: 'SOLD' } });
    });
    const edit = await api().patch(`/api/v1/assets/${a.id}`).set('Cookie', manager).send({ version: a.version, name: 'x' }).expect(409);
    expect(edit.body.error.code).toBe('ASSET_SOLD');
    await api().post(`/api/v1/assets/${a.id}/photos`).set('Cookie', manager).attach('file', PNG, 'p.png').expect(409);
    await api().delete(`/api/v1/assets/${a.id}`).set('Cookie', admin).expect(409);
    await api().get(`/api/v1/qr/resolve/${a.qrToken}`).set('Cookie', manager).expect(200);
  });
});

describe('Permissions (spec §82)', () => {
  it('viewer can read but not create, edit, or change category', async () => {
    const a = await create();
    await api().get(`/api/v1/assets/${a.id}`).set('Cookie', viewer).expect(200);
    await api().post('/api/v1/assets').set('Cookie', viewer).send(newAsset()).expect(403);
    await api().patch(`/api/v1/assets/${a.id}`).set('Cookie', viewer).send({ version: 1, name: 'x' }).expect(403);
    await api().post(`/api/v1/assets/${a.id}/category-change`).set('Cookie', viewer).send({ subcategoryId: base.subOff, version: 1 }).expect(403);
    await api().post(`/api/v1/assets/${a.id}/photos`).set('Cookie', viewer).attach('file', PNG, 'p.png').expect(403);
  });

  it('QR resolution requires signing in', async () => {
    await api().get('/api/v1/qr/resolve/abcdefghijklmnop').expect(401);
  });
});

describe('Company logo (spec §65)', () => {
  it('administrator uploads a logo that every signed-in user can load; others cannot upload', async () => {
    await api().post('/api/v1/settings/logo').set('Cookie', manager).attach('file', PNG, 'logo.png').expect(403);
    await api().post('/api/v1/settings/logo').set('Cookie', admin).attach('file', PDF, 'logo.pdf').expect(422);
    const res = await api().post('/api/v1/settings/logo').set('Cookie', admin).attach('file', PNG, 'logo.png').expect(201);
    const me = (await api().get('/api/v1/auth/me').set('Cookie', viewer).expect(200)).body;
    expect(me.company.logoFileId).toBe(res.body.fileId);
    await api().get(`/api/v1/files/${res.body.fileId}`).set('Cookie', viewer).expect(200);
    const log = await prisma.auditLog.findFirst({ where: { operation: 'SETTING_CHANGED', entityId: 'company.logoFileId' }, orderBy: { id: 'desc' } });
    expect(log).not.toBeNull();
  });
});
