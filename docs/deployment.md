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

## EAP: Company Central Platform

EAP is the company's Central Platform (repository `company-central-platform`). The Asset System uses it for:

| Asset System step | Central Platform |
| --- | --- |
| Username and password | `POST /api/v1/auth/login`. The Platform session it opens is closed at once; the Asset System keeps its own session. |
| Fingerprint | A **passkey**: the device checks the fingerprint, which never leaves it, and signs the Platform's challenge (`/auth/passkey/options`, `/auth/passkey`). The passkey must belong to the same Platform user as the password step. |
| Employees (link, search, daily sync) | `/api/v1/organization/employees` with the application's machine token (client credentials). |

`eapEmployeeId` in the Asset System is the Platform's **employee number**. Asset System usernames must equal Platform usernames.

### Setup in the Platform (by a Platform administrator)

1. Register an application: code `assets`, name «نظام إدارة الأصول».
2. Issue a credential. The client secret is shown **once**.
3. Give the application a role holding `platform.organization.view`, and nothing more.
4. Every person who signs in needs a Platform account linked to their employee record, and a passkey registered on their device.

### Setup in Railway (`api` service)

`AUTH_PROVIDER=eap`, `EAP_API_URL` (the Platform's base URL, e.g. `https://company-central-platform-production.up.railway.app`), `EAP_CLIENT_ID` and `EAP_CLIENT_SECRET`. Set the secret in Railway directly; never commit or paste it elsewhere.

### Passkeys need one company domain

The browser uses a passkey only on the domain it was created for (the "relying party"). Both systems must therefore sit under one company domain. For example, the Platform on `id.company.com`, the Asset System on `assets.company.com`, and on the Platform:

| Platform variable | Value |
| --- | --- |
| `CCP_Identity__WebAuthn__RelyingPartyId` | `company.com` |
| `CCP_Identity__WebAuthn__Origins__0` | `https://id.company.com` |
| `CCP_Identity__WebAuthn__Origins__1` | `https://assets.company.com` |

`*.up.railway.app` domains cannot share passkeys (each is its own site), so custom domains are required. The relying party is baked into every passkey: changing it later means everybody registers again. **As of 2026-09-28 the deployed Platform reports `relyingPartyId: localhost`, so no passkey works yet.**

### Rate limits

Every sign-in reaches the Platform from the Asset System's server, so the Platform sees one source address. Its per-address limit (`CCP_RateLimits__AuthenticationPerAddress`, default 60 a minute, about 20 sign-ins because each costs three calls) applies to the whole company. The per-account limit (10 a minute) still protects each account. Raise the per-address value if sign-ins are refused at peak times.

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
