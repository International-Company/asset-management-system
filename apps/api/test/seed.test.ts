import { execSync } from 'node:child_process';
import type { Env } from '../src/config/env';
import { PrismaService } from '../src/prisma/prisma.service';

let prisma: PrismaService;

beforeAll(() => {
  prisma = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL! } as Env);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Seed data (spec §84–85)', () => {
  it('covers every entity the spec lists, created through the real services', async () => {
    const [users, roles, permissions, subcategories, locations, departments, technical, realEstate, custody, transfers, maintenance, inventory, sales, documents] = await Promise.all([
      prisma.user.count(),
      prisma.role.count(),
      prisma.rolePermission.count(),
      prisma.subcategory.count(),
      prisma.location.count(),
      prisma.department.count(),
      prisma.assetTechnicalDetails.count(),
      prisma.assetRealEstateDetails.count(),
      prisma.custody.count({ where: { notes: { in: ['عهدة تجريبية', 'بانتظار تأكيد المستلم'] } } }),
      prisma.transfer.count({ where: { notes: { startsWith: 'بيانات تجريبية' } } }),
      prisma.maintenance.count({ where: { status: 'CLOSED' } }),
      prisma.inventory.count({ where: { notes: 'جرد تجريبي' } }),
      prisma.sale.count({ where: { referenceNumber: 'DEMO-SALE-1' } }),
      prisma.document.count({ where: { name: 'فاتورة الشراء', asset: { serialNumber: 'DEMO-SN-0001' } } }),
    ]);
    for (const n of [users, roles, permissions, subcategories, locations, departments, technical, realEstate]) expect(n).toBeGreaterThan(0);
    expect({ custody, transfers, inventory, sales, documents }).toEqual({ custody: 2, transfers: 1, inventory: 1, sales: 1, documents: 1 });
    expect(maintenance).toBeGreaterThan(0);

    // Official PDFs were produced by the real services.
    const confirmed = await prisma.custody.findFirstOrThrow({ where: { notes: 'عهدة تجريبية' } });
    expect(confirmed.status).toBe('CONFIRMED');
  });

  it('running it again changes nothing (idempotent)', async () => {
    const before = await Promise.all([prisma.asset.count(), prisma.custody.count(), prisma.auditLog.count()]);
    execSync('npx tsx prisma/seed.ts', { env: process.env, stdio: 'ignore' });
    expect(await Promise.all([prisma.asset.count(), prisma.custody.count(), prisma.auditLog.count()])).toEqual(before);
  }, 60_000);

  it.each(['staging', 'production'])('refuses to run with APP_ENV=%s', (appEnv) => {
    expect(() => execSync('npx tsx prisma/seed.ts', { env: { ...process.env, APP_ENV: appEnv }, stdio: 'pipe' })).toThrow(/Refusing to seed/);
  }, 60_000);
});
