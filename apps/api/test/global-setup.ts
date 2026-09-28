import { execSync } from 'node:child_process';
import { applyTestEnv } from './env';

/** Brings the test database to the latest migration and loads test seed data. */
export default function setup(): void {
  applyTestEnv();
  const opts = { stdio: 'inherit' as const, env: process.env, cwd: process.cwd() };
  execSync('npx prisma migrate deploy', opts);
  execSync('npx tsx prisma/seed.ts', opts);
}
