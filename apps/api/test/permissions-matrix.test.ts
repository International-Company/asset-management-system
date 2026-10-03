import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import request from 'supertest';
import { ANY_AUTHENTICATED, ANY_PERMISSION_KEY, IS_PUBLIC, PERMISSIONS_KEY } from '../src/common/decorators';
import { PrismaService } from '../src/prisma/prisma.service';
import { createApp, login } from './helpers';

/**
 * Spec §82: permissions are proven through the API, not the UI. Every route
 * of every controller is discovered from Nest's metadata, and a signed-in
 * user without any permission must receive 403 from each protected one.
 * Routes open to any signed-in user, or to everyone, are listed explicitly
 * so a new unprotected route cannot appear unnoticed.
 */

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];

const PUBLIC_ROUTES = [
  'GET /api/v1/auth/config',
  'GET /api/v1/health',
  'POST /api/v1/auth/login/fingerprint',
  'POST /api/v1/auth/login/link',
  'POST /api/v1/auth/login/password',
  'POST /api/v1/auth/login/start',
  'POST /api/v1/auth/quick/challenge',
  'POST /api/v1/auth/quick/login',
];

interface Route {
  key: string;
  method: string;
  path: string;
  access: 'public' | 'authenticated' | 'permission' | 'none';
}

let app: INestApplication;
let prisma: PrismaService;
let routes: Route[];

function discover(): Route[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const found: Route[] = [];
  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const base = ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, metatype) ?? '')[0];
    const proto = Object.getPrototypeOf(instance);
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name];
      const sub = Reflect.getMetadata(PATH_METADATA, handler);
      if (sub === undefined) continue;
      const method = METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as number];
      const path = `/api/v1/${[base, ([] as string[]).concat(sub)[0]].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/').replace(/\/$/, '');
      const targets = [handler, metatype];
      const access = reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)
        ? 'public'
        : reflector.getAllAndOverride(PERMISSIONS_KEY, targets) || reflector.getAllAndOverride(ANY_PERMISSION_KEY, targets)
          ? 'permission'
          : reflector.getAllAndOverride<boolean>(ANY_AUTHENTICATED, targets)
            ? 'authenticated'
            : 'none';
      found.push({ key: `${method} ${path}`, method, path, access });
    }
  }
  return found.sort((a, b) => a.key.localeCompare(b.key));
}

beforeAll(async () => {
  ({ app, prisma } = await createApp());
  routes = discover();
});

afterAll(async () => {
  await app.close();
});

describe('Permission matrix (spec §82)', () => {
  it('discovers the API routes', () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it('every route declares its access rule (the guard denies anything else)', () => {
    expect(routes.filter((r) => r.access === 'none').map((r) => r.key)).toEqual([]);
  });

  it('only the login steps, the auth config and liveness are public', () => {
    expect(routes.filter((r) => r.access === 'public').map((r) => r.key)).toEqual(PUBLIC_ROUTES);
  });

  it('routes open to any signed-in user are only personal or self-checking ones', () => {
    // Each of these either acts on the caller's own data (profile, sessions,
    // notifications, saved searches, custody records they are party to) or
    // checks permissions itself per record (files, sync operations).
    const open = routes.filter((r) => r.access === 'authenticated').map((r) => r.key);
    expect(open).toMatchSnapshot();
  });

  it('a signed-in user without permissions receives 403 from every protected route', async () => {
    // A real account with no role at all.
    const employee = await prisma.employee.findUniqueOrThrow({ where: { eapEmployeeId: 'EMP-1005' } });
    await prisma.user.upsert({ where: { username: 'staff1' }, create: { username: 'staff1', employeeId: employee.id }, update: { isActive: true, failedLoginCount: 0, lockedUntil: null } });
    await prisma.userRole.deleteMany({ where: { user: { username: 'staff1' } } });
    const cookie = await login(app, 'staff1');

    const allowed: string[] = [];
    for (const r of routes.filter((x) => x.access === 'permission')) {
      const url = r.path.replace(/:[A-Za-z]+/g, randomUUID());
      const http = request(app.getHttpServer());
      const res = await http[r.method.toLowerCase() as 'get'](url).set('Cookie', cookie).send({});
      if (res.status !== 403 || res.body?.error?.code !== 'FORBIDDEN') allowed.push(`${r.key} → ${res.status}`);
    }
    expect(allowed).toEqual([]);
  }, 120_000);

  it('without a session every non-public route answers 401', async () => {
    const leaked: string[] = [];
    for (const r of routes.filter((x) => x.access !== 'public')) {
      const res = await request(app.getHttpServer())[r.method.toLowerCase() as 'get'](r.path.replace(/:[A-Za-z]+/g, randomUUID()));
      if (res.status !== 401) leaked.push(`${r.key} → ${res.status}`);
    }
    expect(leaked).toEqual([]);
  }, 120_000);
});
