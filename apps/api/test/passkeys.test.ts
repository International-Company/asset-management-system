import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createApp, login, PASSWORD } from './helpers';
import { SoftAuthenticator } from './soft-authenticator';

/**
 * The fingerprint step with passkeys registered in the Asset System (spec §47),
 * end to end over HTTP, with real WebAuthn signatures from a software
 * authenticator. The fingerprint itself never reaches the server.
 */

const ORIGIN = 'https://assets.test';
let app: INestApplication;
let prisma: PrismaService;
const saved = { mode: process.env.FINGERPRINT_MODE, origin: process.env.WEB_ORIGIN };
const api = () => request(app.getHttpServer());

beforeAll(async () => {
  process.env.FINGERPRINT_MODE = 'passkey';
  process.env.WEB_ORIGIN = ORIGIN;
  ({ app, prisma } = await createApp());
});

afterAll(async () => {
  await app.close();
  process.env.FINGERPRINT_MODE = saved.mode;
  process.env.WEB_ORIGIN = saved.origin;
});

/** A clean slate for one account: revoke (never delete) its passkeys, clear lockout. */
async function fresh(username: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  await prisma.userPasskey.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  return user;
}

/** Steps 1–2; returns the challenge id and the fingerprint instructions. */
async function passwordStep(username: string) {
  const { challengeId } = (await api().post('/api/v1/auth/login/start').send({ username }).expect(200)).body;
  const res = await api().post('/api/v1/auth/login/password').send({ challengeId, password: PASSWORD }).expect(200);
  return { challengeId: challengeId as string, fingerprint: res.body.fingerprint };
}

async function fingerprintStep(challengeId: string, credential: unknown) {
  return api().post('/api/v1/auth/login/fingerprint').send({ challengeId, assertion: JSON.stringify(credential) });
}

const cookieOf = (res: request.Response) => ([] as string[]).concat(res.headers['set-cookie'] ?? [])[0]?.split(';')[0];

describe('Fingerprint with passkeys registered in the Asset System', () => {
  it('first sign-in registers the device, later sign-ins verify its signature', async () => {
    await fresh('viewer');
    const device = new SoftAuthenticator(ORIGIN);

    const first = await passwordStep('viewer');
    expect(first.fingerprint.type).toBe('passkey-register');
    expect(first.fingerprint.options).toMatchObject({ rp: { id: 'assets.test' }, authenticatorSelection: { userVerification: 'required' } });
    const registered = await fingerprintStep(first.challengeId, device.register(first.fingerprint.options.challenge));
    expect(registered.status).toBe(200);
    const cookie = cookieOf(registered);
    expect((await api().get('/api/v1/auth/passkeys').set('Cookie', cookie).expect(200)).body).toHaveLength(1);

    const second = await passwordStep('viewer');
    expect(second.fingerprint.type).toBe('passkey');
    expect(second.fingerprint.options.allowCredentials).toEqual([expect.objectContaining({ id: device.id })]);
    const assertion = device.authenticate(second.fingerprint.options.challenge);
    expect((await fingerprintStep(second.challengeId, assertion)).status).toBe(200);

    // Replaying that signature on a new attempt fails: the challenge differs.
    const third = await passwordStep('viewer');
    expect((await fingerprintStep(third.challengeId, assertion)).body.error.code).toBe('FINGERPRINT_FAILED');

    const events = await prisma.securityLog.count({ where: { username: 'viewer', type: 'PASSKEY_REGISTERED' } });
    expect(events).toBeGreaterThan(0);
  });

  it("refuses another person's passkey, a signature without the fingerprint, and the wrong site", async () => {
    await fresh('viewer');
    await fresh('manager');
    const viewerDevice = new SoftAuthenticator(ORIGIN);
    const managerDevice = new SoftAuthenticator(ORIGIN);
    for (const [username, device] of [['viewer', viewerDevice], ['manager', managerDevice]] as const) {
      const step = await passwordStep(username);
      expect((await fingerprintStep(step.challengeId, device.register(step.fingerprint.options.challenge))).status).toBe(200);
    }

    let step = await passwordStep('viewer');
    expect((await fingerprintStep(step.challengeId, managerDevice.authenticate(step.fingerprint.options.challenge))).status).toBe(401);

    step = await passwordStep('viewer');
    expect((await fingerprintStep(step.challengeId, viewerDevice.authenticate(step.fingerprint.options.challenge, { userVerified: false }))).status).toBe(401);

    step = await passwordStep('viewer');
    expect((await fingerprintStep(step.challengeId, viewerDevice.authenticate(step.fingerprint.options.challenge, { origin: 'https://phishing.test' }))).status).toBe(401);

    // A second device cannot be registered through the sign-in flow once one exists.
    step = await passwordStep('viewer');
    const intruder = new SoftAuthenticator(ORIGIN);
    expect((await fingerprintStep(step.challengeId, intruder.register(step.fingerprint.options.challenge))).status).toBe(401);
  });

  it('adds a device while signed in, removes one, keeps the last, and an administrator reset forces re-registration', async () => {
    const viewer = await fresh('viewer');
    const phone = new SoftAuthenticator(ORIGIN);
    let step = await passwordStep('viewer');
    const cookie = cookieOf(await fingerprintStep(step.challengeId, phone.register(step.fingerprint.options.challenge)));

    const laptop = new SoftAuthenticator(ORIGIN);
    const begin = (await api().post('/api/v1/auth/passkeys/options').set('Cookie', cookie).expect(200)).body;
    expect(begin.options.excludeCredentials).toEqual([expect.objectContaining({ id: phone.id })]);
    const list = (await api().post('/api/v1/auth/passkeys').set('Cookie', cookie).send({ challengeId: begin.challengeId, credential: laptop.register(begin.options.challenge) }).expect(201)).body;
    expect(list).toHaveLength(2);
    // The same add challenge cannot be used twice.
    await api().post('/api/v1/auth/passkeys').set('Cookie', cookie).send({ challengeId: begin.challengeId, credential: new SoftAuthenticator(ORIGIN).register(begin.options.challenge) }).expect(401);

    await api().delete(`/api/v1/auth/passkeys/${list[0].id}`).set('Cookie', cookie).expect(204);
    const remaining = (await api().get('/api/v1/auth/passkeys').set('Cookie', cookie).expect(200)).body;
    expect(remaining).toHaveLength(1);
    const last = await api().delete(`/api/v1/auth/passkeys/${remaining[0].id}`).set('Cookie', cookie).expect(409);
    expect(last.body.error.code).toBe('INVALID_STATE');

    // Passkeys are revoked, never deleted.
    await expect(prisma.userPasskey.deleteMany({ where: { userId: viewer.id } })).rejects.toThrow();

    const admin = await loginAdminWithPasskey();
    const reset = (await api().post(`/api/v1/users/${viewer.id}/passkeys/reset`).set('Cookie', admin).expect(200)).body;
    expect(reset.passkeys).toBe(0);
    step = await passwordStep('viewer');
    expect(step.fingerprint.type).toBe('passkey-register');
    expect(await prisma.auditLog.count({ where: { entityId: viewer.id, operation: 'USER_PASSKEYS_RESET' } })).toBeGreaterThan(0);
  });

  it('the development code is refused in this mode', async () => {
    await fresh('viewer');
    await expect(login(app, 'viewer')).rejects.toThrow();
  });
});

async function loginAdminWithPasskey(): Promise<string> {
  await fresh('admin');
  const device = new SoftAuthenticator(ORIGIN);
  const step = await passwordStep('admin');
  return cookieOf(await fingerprintStep(step.challengeId, device.register(step.fingerprint.options.challenge)));
}
