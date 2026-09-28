# Deployment (Railway)

## Services

| Service | Source | Notes |
| --- | --- | --- |
| PostgreSQL | Railway PostgreSQL plugin | Provides `DATABASE_URL` |
| `api` | `apps/api/Dockerfile` (context: repo root) | Runs `prisma migrate deploy`, then starts. Never seeds. |
| `web` | `apps/web/Dockerfile` (context: repo root) | nginx serves the PWA and proxies `/api` to the API |
| Object storage | S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, …) | Required. Objects are write-once (`If-None-Match: *`); the bucket should be private, ideally with versioning |

The web service proxies `/api` so the browser sees a single origin. The
session cookie is `SameSite=Strict` and would not be sent to a separate API
domain (`*.up.railway.app` is a public suffix).

## Environment variables

Set them in Railway. Never commit them to the repository (spec §77).

API:

| Variable | Value |
| --- | --- |
| `APP_ENV` | `production` (or `staging`) |
| `DATABASE_URL` | from the Railway PostgreSQL plugin |
| `TRUST_PROXY` | `true` (behind Railway's edge and nginx) |
| `WEB_ORIGIN` | public web URL |
| `AUTH_PROVIDER` | `eap` (the app refuses `mock` in staging/production) |
| `EAP_API_URL`, `EAP_CLIENT_ID`, `EAP_CLIENT_SECRET` | from the company EAP team |
| `STORAGE_DRIVER` | `s3` (the app refuses `local` in staging/production) |
| `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | bucket credentials |
| `ENCRYPTION_KEY` | 32+ random bytes, base64 — e.g. `openssl rand -base64 48` |
| `TZ` | `Asia/Hebron` |
| `INITIAL_ADMIN_EAP_EMPLOYEE_ID`, `INITIAL_ADMIN_USERNAME` | the first System Administrator's EAP employee ID and EAP username. Used only while no active System Administrator exists; ignored afterwards and can then be removed |
| `CHROMIUM_PATH` | set by the Docker image (`/usr/bin/chromium-browser`); used to render Arabic PDFs |

Web: `API_UPSTREAM` = the API's private URL (e.g. `http://api.railway.internal:3000`).

## PDF rendering

Labels and official documents are rendered from HTML by headless Chromium, which gives correct Arabic shaping and RTL layout. The API image installs Alpine's `chromium` package. Fonts (IBM Plex Sans Arabic) are embedded into each document, so PDFs never depend on fonts installed on the server. **This image has not been built locally yet** (Docker is unavailable on the development machine); CI builds it.

## CI/CD

`.github/workflows/ci.yml` runs lint → type check → migration-drift check →
unit → integration/API (including the route-by-route permission matrix) →
build → E2E (desktop and phone) → performance budgets → Docker builds → a
smoke test of the web image (security headers on every path, plain-HTTP
redirect). The `deploy` job runs
only on `main`, only after all of those pass. It needs:

- secret `RAILWAY_TOKEN`
- variables `RAILWAY_API_SERVICE`, `RAILWAY_WEB_SERVICE`

If Railway's GitHub auto-deploy is enabled instead, turn on **"Wait for CI"**
so a failing build is never deployed.

## HTTPS

Railway terminates TLS. nginx redirects requests whose `X-Forwarded-Proto` is
`http`. In staging/production the session cookie is `Secure`.

Security headers (HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy,
Permissions-Policy) live in `apps/web/security-headers.conf`. It is included
at server level **and** in every `location` that sets its own header, because
nginx drops inherited `add_header` directives in such a block. CI checks the
headers on the running image.

## Backups (spec §79)

The application has no backup UI. Backups rely on the hosting provider's
PostgreSQL backup capabilities (Railway volume backups / point-in-time
recovery, depending on plan) and on the object-storage provider's versioning
and retention. Before go-live, confirm the retention period with the
provider and run one test restore into a staging database.

## Environments

`APP_ENV` separates development / test / staging / production (spec §85):

- The seed script refuses to run unless `APP_ENV` is `development` or `test`.
- The mock authentication provider and local file storage are refused in staging/production.
- Integration and E2E tests only ever use `TEST_DATABASE_URL`.
