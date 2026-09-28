import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

export const PASSWORD = process.env.MOCK_AUTH_PASSWORD!;
export const FINGERPRINT = process.env.MOCK_AUTH_FINGERPRINT!;

export async function createApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

/** Runs the full three-step login and returns the session cookie header. */
export async function login(app: INestApplication, username: string): Promise<string> {
  const http = request(app.getHttpServer());
  const start = await http.post('/api/v1/auth/login/start').send({ username }).expect(200);
  const { challengeId } = start.body as { challengeId: string };
  await request(app.getHttpServer())
    .post('/api/v1/auth/login/password')
    .send({ challengeId, password: PASSWORD })
    .expect(200);
  const done = await request(app.getHttpServer())
    .post('/api/v1/auth/login/fingerprint')
    .send({ challengeId, assertion: FINGERPRINT })
    .expect(200);
  const cookie = ([] as string[]).concat(done.headers['set-cookie'] ?? [])[0];
  if (!cookie) throw new Error('No session cookie returned');
  return cookie.split(';')[0];
}

/** Inserts a minimal valid asset directly (bypassing services) for tests that need one. */
export async function createAssetFixture(prisma: PrismaService, overrides: Record<string, unknown> = {}) {
  const { randomUUID } = await import('node:crypto');
  const sub = await prisma.subcategory.findFirstOrThrow({ where: { mainCategory: 'TEC', status: 'ACTIVE' } });
  const ld = await prisma.locationDepartment.findFirstOrThrow({ where: { status: 'ACTIVE' } });
  const employee = await prisma.employee.findFirstOrThrow({ where: { isActive: true } });
  const suffix = randomUUID().slice(0, 8);
  return prisma.asset.create({
    data: {
      assetNumber: `FIX-${suffix}`,
      name: 'أصل اختبار',
      mainCategory: 'TEC',
      subcategoryId: sub.id,
      serialNumber: `FIX-SN-${suffix}`,
      qrToken: randomUUID(),
      locationId: ld.locationId,
      departmentId: ld.departmentId,
      responsibleEmployeeId: employee.id,
      ...overrides,
    },
  });
}
