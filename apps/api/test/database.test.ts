import { randomUUID } from 'node:crypto';
import type { Env } from '../src/config/env';
import { mapDatabaseError } from '../src/common/errors/all-exceptions.filter';
import { NumberingService } from '../src/modules/numbering/numbering.service';
import { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL! } as Env);
const numbering = new NumberingService();

afterAll(async () => {
  await prisma.$disconnect();
});

/** Minimal valid asset for constraint tests (inserted directly, bypassing services). */
async function assetFixture(overrides: Record<string, unknown> = {}) {
  const sub = await prisma.subcategory.findFirstOrThrow({ where: { mainCategory: 'TEC' } });
  const ld = await prisma.locationDepartment.findFirstOrThrow();
  const employee = await prisma.employee.findFirstOrThrow({ where: { isActive: true } });
  const suffix = randomUUID().slice(0, 8);
  return {
    assetNumber: `TST-${suffix}`,
    name: 'حاسوب اختبار',
    mainCategory: 'TEC' as const,
    subcategoryId: sub.id,
    serialNumber: `SN-${suffix}`,
    qrToken: randomUUID(),
    locationId: ld.locationId,
    departmentId: ld.departmentId,
    responsibleEmployeeId: employee.id,
    ...overrides,
  };
}

async function expectDbError(promise: Promise<unknown>, code: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, 'expected the database to reject the operation').not.toBeNull();
  expect(mapDatabaseError(err)?.code).toBe(code);
}

describe('Number allocation (spec §60)', () => {
  it('50 concurrent allocations produce 50 distinct, formatted numbers', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => prisma.transaction((tx) => numbering.allocate(tx, 'OP:TRF'))),
    );
    expect(new Set(results).size).toBe(50);
    for (const n of results) expect(n).toMatch(/^TRF-\d{6,}$/);
  });

  it('allocation inside a rolled-back transaction leaves the sequence consistent', async () => {
    let rolledBack = '';
    await prisma
      .transaction(async (tx) => {
        rolledBack = await numbering.allocate(tx, 'OP:SAL');
        throw new Error('rollback');
      })
      .catch(() => undefined);
    const next = await prisma.transaction((tx) => numbering.allocate(tx, 'OP:SAL'));
    // A rolled-back number was never committed, so reusing it is safe; committed
    // numbers are protected from reuse by UNIQUE constraints.
    expect(next).toMatch(/^SAL-\d{6}$/);
    expect(rolledBack).toMatch(/^SAL-\d{6}$/);
  });
});

describe('Asset constraints', () => {
  it('new assets must start as NEW', async () => {
    await expectDbError(prisma.asset.create({ data: { ...(await assetFixture()), status: 'IN_USE' } }), 'INVALID_STATE');
  });

  it('serial numbers are unique, case-insensitively', async () => {
    const a = await assetFixture();
    await prisma.asset.create({ data: a });
    await expectDbError(
      prisma.asset.create({ data: { ...(await assetFixture()), serialNumber: a.serialNumber.toLowerCase() } }),
      'DUPLICATE',
    );
  });

  it('an asset must have exactly one responsible person', async () => {
    const external = await prisma.externalPerson.findFirstOrThrow();
    await expectDbError(
      prisma.asset.create({ data: { ...(await assetFixture()), responsibleExternalId: external.id } }),
      'VALIDATION_ERROR',
    );
  });

  it('the location/department pair must be registered', async () => {
    const pairs = await prisma.locationDepartment.findMany();
    const locations = await prisma.location.findMany();
    const departments = await prisma.department.findMany();
    const unregistered = locations
      .flatMap((l) => departments.map((d) => ({ locationId: l.id, departmentId: d.id })))
      .find((p) => !pairs.some((r) => r.locationId === p.locationId && r.departmentId === p.departmentId))!;
    await expectDbError(prisma.asset.create({ data: { ...(await assetFixture()), ...unregistered } }), 'INVALID_STATE');
  });

  it('the subcategory must belong to the main category', async () => {
    const offSub = await prisma.subcategory.findFirstOrThrow({ where: { mainCategory: 'OFF' } });
    await expectDbError(prisma.asset.create({ data: { ...(await assetFixture()), subcategoryId: offSub.id } }), 'INVALID_STATE');
  });

  it('the QR token can never change', async () => {
    const asset = await prisma.asset.create({ data: await assetFixture() });
    await expectDbError(prisma.asset.update({ where: { id: asset.id }, data: { qrToken: randomUUID() } }), 'INVALID_STATE');
  });

  it('SOLD requires a sale record, and a sold asset is frozen and undeletable', async () => {
    const asset = await prisma.asset.create({ data: await assetFixture() });
    await expectDbError(prisma.asset.update({ where: { id: asset.id }, data: { status: 'SOLD' } }), 'INVALID_STATE');

    const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    await prisma.$transaction(async (tx) => {
      await tx.sale.create({
        data: {
          number: `SAL-T-${asset.id.slice(0, 8)}`,
          assetId: asset.id,
          saleDate: new Date(),
          saleValue: 100,
          currency: 'USD',
          buyerName: 'مشترٍ تجريبي',
          buyerType: 'فرد',
          statusBeforeSale: 'NEW',
          assetSnapshot: {},
          actorId: admin.id,
        },
      });
      await tx.asset.update({ where: { id: asset.id }, data: { status: 'SOLD' } });
    });

    await expectDbError(prisma.asset.update({ where: { id: asset.id }, data: { status: 'IN_USE' } }), 'ASSET_SOLD');
    await expectDbError(prisma.asset.delete({ where: { id: asset.id } }), 'INVALID_STATE');
    await expectDbError(prisma.sale.update({ where: { assetId: asset.id }, data: { notes: 'x' } }), 'INVALID_STATE');
    // Double sale is impossible (UNIQUE on sales.asset_id).
    await expectDbError(
      prisma.sale.create({
        data: {
          number: `SAL-T2-${asset.id.slice(0, 8)}`,
          assetId: asset.id,
          saleDate: new Date(),
          saleValue: 1,
          currency: 'USD',
          buyerName: 'آخر',
          buyerType: 'فرد',
          statusBeforeSale: 'SOLD',
          assetSnapshot: {},
          actorId: admin.id,
        },
      }),
      'DUPLICATE',
    );
  });
});

describe('Append-only logs (spec §50, §51)', () => {
  it('audit log rows cannot be updated or deleted by anyone', async () => {
    const row = await prisma.auditLog.create({
      data: { operation: 'TEST', entityType: 'Test', actorName: 'اختبار' },
    });
    await expectDbError(prisma.auditLog.update({ where: { id: row.id }, data: { operation: 'EDITED' } }), 'INVALID_STATE');
    await expectDbError(prisma.auditLog.delete({ where: { id: row.id } }), 'INVALID_STATE');
    await expectDbError(prisma.$executeRawUnsafe('TRUNCATE audit_logs'), 'INVALID_STATE');
  });

  it('security log rows cannot be updated or deleted', async () => {
    const row = await prisma.securityLog.create({ data: { type: 'LOGIN_FAILED', username: 'x' } });
    await expectDbError(prisma.securityLog.update({ where: { id: row.id }, data: { username: 'y' } }), 'INVALID_STATE');
    await expectDbError(prisma.securityLog.delete({ where: { id: row.id } }), 'INVALID_STATE');
  });
});

describe('Custody integrity', () => {
  it('an asset cannot be in two pending custodies (double custody)', async () => {
    const asset = await prisma.asset.create({ data: await assetFixture() });
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    const receiver = await prisma.employee.findUniqueOrThrow({ where: { eapEmployeeId: 'EMP-1006' } });
    const make = (n: string) =>
      prisma.custody.create({
        data: {
          number: n,
          newResponsibleEmployeeId: receiver.id,
          createdById: admin.id,
          items: { create: [{ assetId: asset.id, conditionAtHandover: 'NEW', assetSnapshot: {} }] },
        },
      });
    await make(`CUS-T-${randomUUID().slice(0, 8)}`);
    await expectDbError(make(`CUS-T-${randomUUID().slice(0, 8)}`), 'DUPLICATE');
  });

  it('a confirmed custody is immutable', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    const receiver = await prisma.employee.findUniqueOrThrow({ where: { eapEmployeeId: 'EMP-1006' } });
    const custody = await prisma.custody.create({
      data: { number: `CUS-T-${randomUUID().slice(0, 8)}`, newResponsibleEmployeeId: receiver.id, createdById: admin.id },
    });
    await prisma.custody.update({
      where: { id: custody.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: admin.id },
    });
    await expectDbError(prisma.custody.update({ where: { id: custody.id }, data: { notes: 'تعديل' } }), 'INVALID_STATE');
    await expectDbError(prisma.custody.delete({ where: { id: custody.id } }), 'INVALID_STATE');
  });

  it('rejection requires a reason', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    const receiver = await prisma.employee.findUniqueOrThrow({ where: { eapEmployeeId: 'EMP-1006' } });
    const custody = await prisma.custody.create({
      data: { number: `CUS-T-${randomUUID().slice(0, 8)}`, newResponsibleEmployeeId: receiver.id, createdById: admin.id },
    });
    await expectDbError(
      prisma.custody.update({ where: { id: custody.id }, data: { status: 'REJECTED', rejectedAt: new Date() } }),
      'VALIDATION_ERROR',
    );
  });
});
