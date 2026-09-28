import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { toJsonSafe } from '../src/common/redact';
import { PrismaService } from '../src/prisma/prisma.service';
import { createApp, FINGERPRINT, login, PASSWORD } from './helpers';

let app: INestApplication;
let prisma: PrismaService;
const api = () => request(app.getHttpServer());

beforeAll(async () => {
  ({ app, prisma } = await createApp());
});

afterAll(async () => {
  await app.close();
});

async function startChallenge(username: string): Promise<string> {
  const res = await api().post('/api/v1/auth/login/start').send({ username }).expect(200);
  return res.body.challengeId as string;
}

describe('Login flow (username → password → fingerprint)', () => {
  it('creates a session and returns the effective permissions', async () => {
    const cookie = await login(app, 'manager');
    const me = await api().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.username).toBe('manager');
    expect(me.body.roles).toEqual(['ASSET_MANAGER']);
    expect(me.body.permissions).toContain('custody.create');
    expect(me.body.permissions).not.toContain('settings.manage');
  });

  it('does not reveal whether a username exists at step 1', async () => {
    const a = await api().post('/api/v1/auth/login/start').send({ username: 'admin' }).expect(200);
    const b = await api().post('/api/v1/auth/login/start').send({ username: 'nobody-here' }).expect(200);
    expect(Object.keys(a.body)).toEqual(Object.keys(b.body));
  });

  it('rejects a wrong password with an Arabic message', async () => {
    const challengeId = await startChallenge('viewer');
    const res = await api().post('/api/v1/auth/login/password').send({ challengeId, password: 'wrong' }).expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.error.message).toMatch(/كلمة المرور/);
  });

  it('cannot skip the password step', async () => {
    const challengeId = await startChallenge('admin');
    const res = await api()
      .post('/api/v1/auth/login/fingerprint')
      .send({ challengeId, assertion: FINGERPRINT })
      .expect(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('rejects a failed fingerprint and does not issue a session', async () => {
    const challengeId = await startChallenge('viewer');
    await api().post('/api/v1/auth/login/password').send({ challengeId, password: PASSWORD }).expect(200);
    const res = await api()
      .post('/api/v1/auth/login/fingerprint')
      .send({ challengeId, assertion: 'bad' })
      .expect(401);
    expect(res.body.error.code).toBe('FINGERPRINT_FAILED');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('a challenge cannot be reused after login', async () => {
    const challengeId = await startChallenge('viewer');
    await api().post('/api/v1/auth/login/password').send({ challengeId, password: PASSWORD }).expect(200);
    await api().post('/api/v1/auth/login/fingerprint').send({ challengeId, assertion: FINGERPRINT }).expect(200);
    await api().post('/api/v1/auth/login/fingerprint').send({ challengeId, assertion: FINGERPRINT }).expect(401);
  });

  it('denies EAP-valid employees who have no Asset System account', async () => {
    const challengeId = await startChallenge('noaccess');
    const res = await api().post('/api/v1/auth/login/password').send({ challengeId, password: PASSWORD }).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('logout ends the session', async () => {
    const cookie = await login(app, 'viewer');
    await api().post('/api/v1/auth/logout').set('Cookie', cookie).expect(200);
    const res = await api().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });
});

describe('Brute-force protection', () => {
  it('locks the account after the configured number of failures and logs it', async () => {
    // A dedicated account so the lock does not affect other tests.
    const employee = await prisma.employee.findUniqueOrThrow({ where: { eapEmployeeId: 'EMP-1005' } });
    const user = await prisma.user.upsert({
      where: { username: 'staff1' },
      create: { username: 'staff1', employeeId: employee.id },
      update: { failedLoginCount: 0, lockedUntil: null },
    });

    for (let i = 0; i < 5; i++) {
      const challengeId = await startChallenge('staff1');
      await api().post('/api/v1/auth/login/password').send({ challengeId, password: 'wrong' }).expect(401);
    }
    const challengeId = await startChallenge('staff1');
    const res = await api().post('/api/v1/auth/login/password').send({ challengeId, password: PASSWORD }).expect(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');

    const locked = await prisma.securityLog.findFirst({ where: { userId: user.id, type: 'ACCOUNT_LOCKED' } });
    expect(locked).not.toBeNull();

    // No credential material is ever written to the security log.
    const logs = await prisma.securityLog.findMany({ where: { username: 'staff1' } });
    const text = JSON.stringify(toJsonSafe(logs));
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain('wrong');
  });
});

describe('Authorization is enforced by the API, not the UI (spec §82)', () => {
  it('returns 401 without a session', async () => {
    const res = await api().get('/api/v1/health/details').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 403 to a user lacking the permission', async () => {
    const viewer = await login(app, 'viewer');
    await api().get('/api/v1/health/details').set('Cookie', viewer).expect(403);
    await api().get('/api/v1/security/sessions').set('Cookie', viewer).expect(403);
    const anySession = await prisma.session.findFirstOrThrow();
    await api().post(`/api/v1/security/sessions/${anySession.id}/terminate`).set('Cookie', viewer).expect(403);
  });

  it('Asset Manager does not get System Administrator endpoints', async () => {
    const manager = await login(app, 'manager');
    await api().get('/api/v1/health/details').set('Cookie', manager).expect(403);
    await api().get('/api/v1/security/sessions').set('Cookie', manager).expect(403);
  });

  it('a disabled role no longer grants its permissions', async () => {
    const role = await prisma.role.create({ data: { key: `TMP_${Date.now()}`, name: 'مؤقت' } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionKey: 'health.view' } });
    const viewerUser = await prisma.user.findUniqueOrThrow({ where: { username: 'viewer' } });
    await prisma.userRole.create({ data: { userId: viewerUser.id, roleId: role.id } });

    const cookie = await login(app, 'viewer');
    await api().get('/api/v1/health/details').set('Cookie', cookie).expect(200);

    await prisma.role.update({ where: { id: role.id }, data: { status: 'INACTIVE' } });
    await api().get('/api/v1/health/details').set('Cookie', cookie).expect(403);

    await prisma.userRole.deleteMany({ where: { roleId: role.id } });
  });

  it('System Administrator can terminate another session, which then stops working', async () => {
    const admin = await login(app, 'admin');
    const victim = await login(app, 'manager');
    const me = await api().get('/api/v1/security/sessions/mine').set('Cookie', victim).expect(200);
    const current = me.body.items.find((s: { current: boolean }) => s.current);

    await api().post(`/api/v1/security/sessions/${current.id}/terminate`).set('Cookie', admin).expect(200);
    await api().get('/api/v1/auth/me').set('Cookie', victim).expect(401);

    const log = await prisma.securityLog.findFirst({ where: { sessionId: current.id, type: 'SESSION_TERMINATED' } });
    expect(log).not.toBeNull();
  });
});

describe('Health', () => {
  it('liveness is public and reveals nothing internal', async () => {
    const res = await api().get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('details report backend, database, EAP and storage for administrators', async () => {
    const admin = await login(app, 'admin');
    const res = await api().get('/api/v1/health/details').set('Cookie', admin).expect(200);
    expect(Object.keys(res.body.checks).sort()).toEqual(['backend', 'database', 'eap', 'storage']);
    expect(res.body.checks.database.status).toBe('up');
  });
});

describe('Errors', () => {
  it('unknown routes return an Arabic 404 without stack traces', async () => {
    const admin = await login(app, 'admin');
    const res = await api().get('/api/v1/does-not-exist').set('Cookie', admin).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toMatch(/at \w+ \(/);
  });
});
