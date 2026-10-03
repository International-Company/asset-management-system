import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { isWeakPin } from '@osooli/shared';
import { createApp, login } from './helpers';

/**
 * Quick sign-in with a 4-digit PIN: it works only from the device it was set
 * up on (that device signs a fresh challenge with its own key), five wrong
 * PINs revoke the device, and a disabled account cannot use it.
 */

let app: INestApplication;
let prisma: PrismaService;
const api = () => request(app.getHttpServer());
const PIN = '4827';

beforeAll(async () => {
  ({ app, prisma } = await createApp());
});

// Devices are revoked, never deleted; start each test under the per-user limit.
beforeEach(async () => {
  await prisma.quickLoginDevice.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'test' } });
});

afterAll(async () => {
  await app.close();
});

/** A device as the browser makes it: an ECDSA P-256 key pair; only the public half is sent. */
function newDevice() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privateKey };
}

const signWith = (key: KeyObject, challenge: string) =>
  sign('sha256', Buffer.from(challenge, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }).toString('base64');

async function enable(cookie: string, device: ReturnType<typeof newDevice>, pin = PIN) {
  return api().post('/api/v1/auth/quick/devices').set('Cookie', cookie).send({ publicKey: device.publicKey, pin });
}

async function quickLogin(deviceId: string, key: KeyObject, pin: string) {
  const { challengeId, challenge } = (await api().post('/api/v1/auth/quick/challenge').send({ deviceId }).expect(200)).body;
  return api().post('/api/v1/auth/quick/login').send({ deviceId, challengeId, signature: signWith(key, challenge), pin });
}

describe('Quick sign-in with a PIN', () => {
  it('rejects easy PINs', () => {
    for (const pin of ['0000', '1111', '1234', '6789', '8901', '4321', '3210', '0987']) expect(isWeakPin(pin)).toBe(true);
    for (const pin of ['4827', '1357', '2580', '1122', '9014']) expect(isWeakPin(pin)).toBe(false);
  });

  it('sets up a device after a full sign-in, then signs in with the PIN', async () => {
    const cookie = await login(app, 'viewer');
    const device = newDevice();
    expect((await enable(cookie, device, '1234')).status).toBe(400);
    const res = await enable(cookie, device);
    expect(res.status).toBe(201);
    const { deviceId } = res.body;

    const ok = await quickLogin(deviceId, device.privateKey, PIN);
    expect(ok.status).toBe(200);
    const session = ([] as string[]).concat(ok.headers['set-cookie'] ?? [])[0]?.split(';')[0];
    expect((await api().get('/api/v1/auth/me').set('Cookie', session).expect(200)).body.username).toBe('viewer');

    const devices = (await api().get('/api/v1/auth/quick/devices').set('Cookie', session).expect(200)).body;
    expect(devices.map((d: { id: string }) => d.id)).toContain(deviceId);
    const stored = await prisma.quickLoginDevice.findUniqueOrThrow({ where: { id: deviceId } });
    expect(stored.pinHash).not.toContain(PIN);
    expect(await prisma.securityLog.count({ where: { username: 'viewer', type: 'QUICK_LOGIN_ENABLED' } })).toBeGreaterThan(0);
  });

  it('is useless without the device key, and a challenge is single use', async () => {
    const cookie = await login(app, 'viewer');
    const device = newDevice();
    const { deviceId } = (await enable(cookie, device)).body;

    const other = newDevice();
    expect((await quickLogin(deviceId, other.privateKey, PIN)).status).toBe(409);

    const { challengeId, challenge } = (await api().post('/api/v1/auth/quick/challenge').send({ deviceId }).expect(200)).body;
    const body = { deviceId, challengeId, signature: signWith(device.privateKey, challenge), pin: PIN };
    expect((await api().post('/api/v1/auth/quick/login').send(body)).status).toBe(200);
    expect((await api().post('/api/v1/auth/quick/login').send(body)).body.error.code).toBe('SESSION_EXPIRED');
  });

  it('revokes the device after five wrong PINs', async () => {
    const cookie = await login(app, 'viewer');
    const device = newDevice();
    const { deviceId } = (await enable(cookie, device)).body;

    for (let i = 1; i <= 4; i++) {
      const res = await quickLogin(deviceId, device.privateKey, '9999');
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    const fifth = await quickLogin(deviceId, device.privateKey, '9999');
    expect(fifth.body.error.message).toMatch(/5 مرات/);
    // Even the right PIN no longer works there.
    expect((await quickLogin(deviceId, device.privateKey, PIN)).status).toBe(409);
    expect((await prisma.quickLoginDevice.findUniqueOrThrow({ where: { id: deviceId } })).revokedReason).toBe('too_many_attempts');
  });

  it('a correct PIN resets the wrong-PIN count', async () => {
    const cookie = await login(app, 'viewer');
    const device = newDevice();
    const { deviceId } = (await enable(cookie, device)).body;
    for (let i = 0; i < 3; i++) await quickLogin(deviceId, device.privateKey, '9999');
    expect((await quickLogin(deviceId, device.privateKey, PIN)).status).toBe(200);
    expect((await prisma.quickLoginDevice.findUniqueOrThrow({ where: { id: deviceId } })).failedAttempts).toBe(0);
  });

  it('a disabled account cannot sign in with the PIN', async () => {
    const cookie = await login(app, 'viewer');
    const device = newDevice();
    const { deviceId } = (await enable(cookie, device)).body;
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'viewer' } });
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    try {
      expect((await quickLogin(deviceId, device.privateKey, PIN)).status).toBe(403);
    } finally {
      await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });
    }
  });

  it('the user can remove a device, and an admin fingerprint reset removes all of them', async () => {
    const cookie = await login(app, 'viewer');
    const a = newDevice();
    const b = newDevice();
    const { deviceId: idA } = (await enable(cookie, a)).body;
    const { deviceId: idB } = (await enable(cookie, b)).body;

    await api().delete(`/api/v1/auth/quick/devices/${idA}`).set('Cookie', cookie).expect(204);
    expect((await quickLogin(idA, a.privateKey, PIN)).status).toBe(409);

    const admin = await login(app, 'admin');
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'viewer' } });
    await api().post(`/api/v1/users/${user.id}/passkeys/reset`).set('Cookie', admin).expect(200);
    expect((await quickLogin(idB, b.privateKey, PIN)).status).toBe(409);
    expect(await prisma.quickLoginDevice.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
  });
});
