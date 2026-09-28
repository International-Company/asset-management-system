# نظام إدارة أصول الشركة — Company Asset Management System

Internal platform for tracking company assets through their full lifecycle
(Technical Specification v1.0). Arabic RTL, PWA, modular monolith.

| Layer    | Technology                                                   |
| -------- | ------------------------------------------------------------ |
| API      | Node.js 24, NestJS 12, Prisma 7, PostgreSQL, REST `/api/v1`  |
| Web      | React 19, TypeScript, Vite, PWA (Workbox), custom CSS        |
| Shared   | `packages/shared`: enums, permission keys, Arabic labels     |
| Tests    | Vitest (unit, integration, API, components), Playwright (E2E) |
| Delivery | Docker, GitHub Actions → Railway                             |

## Repository layout

```
apps/api        NestJS API (src/modules/* = one folder per spec module)
apps/api/prisma schema.prisma, SQL migrations, dev seed
apps/web        React PWA
packages/shared Code shared by API and web
e2e             Playwright end-to-end tests
docs            Database, deployment and phase notes
```

## Local development

Requirements: Node.js ≥ 22, and either Docker **or** the bundled local PostgreSQL.

```bash
npm install
cp apps/api/.env.example apps/api/.env

# Database — pick one:
npm run db:up                    # Docker: PostgreSQL + MinIO (host port 5433)
npm run db:local -w @osooli/api  # No Docker: local PostgreSQL 18 on port 5433 (keep it running)

npm run build -w @osooli/shared
npm run db:migrate               # apply migrations
npm run db:seed                  # development data only (refuses outside development/test)

npm run dev:api                  # http://localhost:3000/api/v1
npm run dev:web                  # http://localhost:5173
```

Port 5433 is used so the project never collides with a PostgreSQL service
already installed on 5432.

### Development sign-in (mock EAP provider)

EAP is mocked in development and test (spec §88). Every seeded user signs in
with password `dev-password` and fingerprint code `000000`:

| Username   | Access                                           |
| ---------- | ------------------------------------------------ |
| `admin`    | System Administrator                             |
| `manager`  | Asset Manager                                    |
| `viewer`   | Custom role, `assets.view` only                  |
| `noaccess` | Valid in EAP, but has no Asset System account     |

The mock provider is rejected at startup when `APP_ENV` is `staging` or
`production`.

## Checks

```bash
npm run lint
npm run typecheck
npm test                 # unit + web component tests
npm run test:integration # API + database tests (needs TEST_DATABASE_URL)
npm run build
npx playwright test      # E2E; run test:integration first (migrates and seeds the test DB)
npm run perf             # performance budgets on a throwaway database (20,000 assets)
```

CI runs all of these plus a migration-drift check and Docker builds. Deployment
happens only if every step passes.

## Further reading

- [docs/database.md](docs/database.md) — integrity rules enforced in PostgreSQL
- [docs/deployment.md](docs/deployment.md) — Railway, environment variables, backups
- [docs/phases.md](docs/phases.md) — delivery plan and open decisions
- [docs/go-live.md](docs/go-live.md) — go-live checklist and test coverage map
