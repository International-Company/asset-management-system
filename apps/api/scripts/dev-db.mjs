// Runs a local PostgreSQL without Docker (development/tests only).
// Usage: npm run db:local -w @osooli/api   (Ctrl+C to stop)
// Uses the same credentials as docker-compose.yml so .env works with either.
//
// PostgreSQL's initdb fails when its binaries or data directory sit under a
// non-ASCII path (such as an Arabic folder name), so the binaries from
// @embedded-postgres are copied to ~/.osooli and run from there.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const USER = 'osooli';
const PASSWORD = 'osooli_dev';
const PORT = String(process.env.PGPORT ?? 5433);
const DATABASES = ['osooli', 'osooli_test'];

const pkgName = `@embedded-postgres/${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
const pkgDir = dirname(dirname(require.resolve(pkgName))); // <pkg>/dist/index.js → <pkg>
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;

const home = process.env.OSOOLI_PG_HOME ?? join(homedir(), '.osooli');
const binDir = join(home, `pg-${version}`);
const dataDir = join(home, 'pgdata');
const exe = (name) => join(binDir, 'bin', process.platform === 'win32' ? `${name}.exe` : name);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed with ${r.status}`);
}

if (!existsSync(exe('postgres'))) {
  process.stdout.write(`Copying PostgreSQL ${version} binaries to ${binDir}\n`);
  mkdirSync(binDir, { recursive: true });
  cpSync(join(pkgDir, 'native'), binDir, { recursive: true });
}

if (!existsSync(join(dataDir, 'PG_VERSION'))) {
  mkdirSync(home, { recursive: true });
  const pwFile = join(home, 'pwfile');
  writeFileSync(pwFile, PASSWORD);
  run(exe('initdb'), ['-D', dataDir, '-U', USER, `--pwfile=${pwFile}`, '-E', 'UTF8', '--locale=C', '-A', 'scram-sha-256']);
}

const server = spawn(exe('postgres'), ['-D', dataDir, '-p', PORT, '-c', 'timezone=Asia/Hebron'], {
  stdio: ['ignore', 'inherit', 'inherit'],
});

// Wait until the server accepts connections, then create the databases.
const { default: pg } = await import('pg');
const connect = async () => {
  const client = new pg.Client({ host: 'localhost', port: Number(PORT), user: USER, password: PASSWORD, database: 'postgres' });
  await client.connect();
  return client;
};
let client;
for (let i = 0; i < 60 && !client; i++) {
  try {
    client = await connect();
  } catch {
    await new Promise((res) => setTimeout(res, 500));
  }
}
if (!client) throw new Error('PostgreSQL did not start');
for (const db of DATABASES) {
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
  if (!rowCount) await client.query(`CREATE DATABASE ${db}`);
}
await client.end();
process.stdout.write(`PostgreSQL ready on port ${PORT} (data: ${dataDir})\n`);

const stop = () => {
  server.kill('SIGINT');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
