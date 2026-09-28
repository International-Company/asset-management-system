// Performance check with realistic volume (phase 8).
//
// Creates a throwaway database, loads the dev seed plus 20,000 assets and
// 100,000 audit entries, starts the built API against it and times the
// heaviest read paths. Fails (exit 1) when a budget is exceeded.
//
//   npm run build -w @osooli/api && node apps/api/scripts/perf-check.mjs
//
// Needs the local PostgreSQL (npm run db:dev) or PERF_ADMIN_URL pointing at a
// server where the user may create databases. The database is dropped after.
import { execSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

const apiDir = resolve(import.meta.dirname, '..');
config({ path: resolve(apiDir, '.env') });

const ASSETS = Number(process.env.PERF_ASSETS ?? 20_000);
const AUDIT_ROWS = Number(process.env.PERF_AUDIT_ROWS ?? 100_000);
const PORT = 3200;
const RUNS = 15;

const base = new URL(process.env.PERF_ADMIN_URL ?? process.env.DATABASE_URL);
const dbName = `osooli_perf_${Date.now()}`;
const adminUrl = new URL(base);
adminUrl.pathname = '/postgres';
const perfUrl = new URL(base);
perfUrl.pathname = `/${dbName}`;

/** Budgets in milliseconds (p95 for reads, single run for exports). */
const BUDGETS = {
  list: 500,
  search: 500,
  detail: 300,
  snapshot: 4000,
  preview: 1500,
  audit: 800,
  excel: 20_000,
  pdf: 30_000,
};

const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
await admin.query(`CREATE DATABASE "${dbName}"`);
let server;
let db;
let failed = false;

try {
  const env = { ...process.env, DATABASE_URL: perfUrl.toString(), APP_ENV: 'development', STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: './storage-data/perf' };
  const run = (cmd) => execSync(cmd, { cwd: apiDir, env, stdio: ['ignore', 'ignore', 'inherit'] });
  console.log(`Database ${dbName}: migrating and seeding…`);
  run('npx prisma migrate deploy');
  run('npx tsx prisma/seed.ts');

  db = new pg.Client({ connectionString: perfUrl.toString() });
  db.on('error', () => {});
  await db.connect();
  console.log(`Loading ${ASSETS} assets and ${AUDIT_ROWS} audit entries…`);
  // Varied realistic rows: every active location/department pair, every
  // subcategory, a mix of statuses, responsible employees and purchase data.
  await db.query(
    `INSERT INTO assets (id, asset_number, name, main_category, subcategory_id, serial_number, qr_token,
                         location_id, department_id, responsible_employee_id, status, purchase_value, purchase_currency, updated_at)
     SELECT gen_random_uuid(),
            s.main_category || '-9' || lpad(g::text, 5, '0'),
            (ARRAY['حاسوب','طابعة','مكتب','كرسي','خزانة','شاشة','مبدّل','رافعة'])[1 + g % 8] || ' ' || g,
            s.main_category, s.id,
            'PERF-SN-' || g,
            replace(gen_random_uuid()::text, '-', ''),
            ld.location_id, ld.department_id, e.id,
            'NEW',
            CASE WHEN g % 3 = 0 THEN (g % 5000) + 10 END,
            CASE WHEN g % 3 = 0 THEN (ARRAY['USD','ILS'])[1 + g % 2] END,
            now() - (g || ' minutes')::interval
     FROM generate_series(1, $1) g
     JOIN LATERAL (SELECT id, main_category FROM subcategories ORDER BY id OFFSET (g % (SELECT count(*) FROM subcategories)) LIMIT 1) s ON true
     JOIN LATERAL (SELECT location_id, department_id FROM location_departments ORDER BY location_id, department_id OFFSET (g % (SELECT count(*) FROM location_departments)) LIMIT 1) ld ON true
     JOIN LATERAL (SELECT id FROM employees WHERE is_active ORDER BY id OFFSET (g % (SELECT count(*) FROM employees WHERE is_active)) LIMIT 1) e ON true`,
    [ASSETS],
  );
  // New assets must start as NEW (database rule); spread the statuses afterwards.
  await db.query(
    `UPDATE assets SET status = (ARRAY['NEW','IN_USE','IN_USE','IN_USE','UNUSED','DAMAGED','UNDER_MAINTENANCE']::"AssetStatus"[])[1 + (substring(serial_number from 9)::int % 7)], version = version + 1
     WHERE serial_number LIKE 'PERF-SN-%'`,
  );
  await db.query(
    `INSERT INTO audit_logs (actor_name, operation, entity_type, entity_id, new_data, created_at)
     SELECT 'مستخدم أداء', (ARRAY['ASSET_CREATED','ASSET_UPDATED','TRANSFER_CREATED','CUSTODY_CREATED'])[1 + g % 4], 'Asset',
            gen_random_uuid()::text, jsonb_build_object('n', g), now() - (g || ' seconds')::interval
     FROM generate_series(1, $1) g`,
    [AUDIT_ROWS],
  );
  await db.query('ANALYZE');
  const [{ id: sampleId }] = (await db.query(`SELECT id FROM assets WHERE serial_number = 'PERF-SN-12345' OR serial_number LIKE 'PERF-SN-%' LIMIT 1`)).rows;
  await db.end();
  db = undefined;

  server = spawn(process.execPath, ['dist/main.js'], {
    cwd: apiDir,
    env: { ...env, PORT: String(PORT), NODE_ENV: 'production', LOG_LEVEL: 'warn', AUTH_PROVIDER: 'mock', WEB_ORIGIN: 'http://localhost' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const url = (p) => `http://localhost:${PORT}/api/v1${p}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(url('/health'))).ok) break;
    } catch {
      /* not up yet */
    }
    if (i > 60) throw new Error('API did not start');
    await new Promise((r) => setTimeout(r, 500));
  }

  // Sign in as the seeded administrator (mock EAP).
  const post = (p, body, cookie) =>
    fetch(url(p), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const { challengeId } = await (await post('/auth/login/start', { username: 'admin' })).json();
  await post('/auth/login/password', { challengeId, password: process.env.MOCK_AUTH_PASSWORD ?? 'dev-password' });
  const done = await post('/auth/login/fingerprint', { challengeId, assertion: process.env.MOCK_AUTH_FINGERPRINT ?? '000000' });
  const cookie = done.headers.get('set-cookie').split(';')[0];

  const time = async (fn) => {
    const t = performance.now();
    const res = await fn();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.arrayBuffer();
    return performance.now() - t;
  };
  const get = (p) => () => fetch(url(p), { headers: { Cookie: cookie } });
  const p95 = async (fn) => {
    await time(fn); // warm-up
    const samples = [];
    for (let i = 0; i < RUNS; i++) samples.push(await time(fn));
    samples.sort((a, b) => a - b);
    return { p50: samples[Math.floor(RUNS / 2)], p95: samples[Math.ceil(RUNS * 0.95) - 1] };
  };

  const checks = [
    ['list', 'Asset list, first page', () => p95(get('/assets'))],
    ['list', 'Asset list, filtered + sorted', () => p95(get('/assets?status=IN_USE&sort=assetNumber&order=desc&page=5'))],
    ['search', 'Asset search by name', () => p95(get(`/assets?q=${encodeURIComponent('طابعة 1')}`))],
    ['search', 'Asset search by serial', () => p95(get('/assets?q=PERF-SN-1999'))],
    ['detail', 'Asset detail', () => p95(get(`/assets/${sampleId}`))],
    ['snapshot', `Offline snapshot (${ASSETS} assets)`, () => p95(get('/sync/snapshot'))],
    ['preview', 'Report preview: asset register', () => p95(() => post('/reports/assets/preview', { filters: {} }, cookie))],
    ['preview', 'Report preview: by location', () => p95(() => post('/reports/by-location/preview', { filters: {} }, cookie))],
    ['audit', `Audit log (${AUDIT_ROWS} rows), first page`, () => p95(get('/audit'))],
    ['excel', 'Excel export: asset register', async () => ({ p95: await time(() => post('/reports/assets/export', { filters: {}, format: 'xlsx' }, cookie)) })],
    ['pdf', 'PDF export: asset register (5,000-row cap)', async () => ({ p95: await time(() => post('/reports/assets/export', { filters: {}, format: 'pdf' }, cookie)) })],
  ];

  console.log('');
  console.log('Check'.padEnd(46), 'p50 ms'.padStart(8), 'p95 ms'.padStart(8), 'budget'.padStart(8), '');
  for (const [budgetKey, label, fn] of checks) {
    const r = await fn();
    const ok = r.p95 <= BUDGETS[budgetKey];
    if (!ok) failed = true;
    console.log(label.padEnd(46), (r.p50 === undefined ? '' : r.p50.toFixed(0)).padStart(8), r.p95.toFixed(0).padStart(8), String(BUDGETS[budgetKey]).padStart(8), ok ? 'ok' : 'OVER BUDGET');
  }
} catch (e) {
  failed = true;
  console.error('Performance check failed:', e.message);
} finally {
  await db?.end().catch(() => {});
  server?.kill();
  await new Promise((r) => setTimeout(r, 1000));
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.end();
}
process.exit(failed ? 1 : 0);
