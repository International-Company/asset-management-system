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

The fingerprint step is handled by the Asset System itself; see "Fingerprint" below.

| Asset System step | Central Platform |
| --- | --- |
| Username and password | `POST /api/v1/auth/login`. The Platform session it opens is closed at once; the Asset System keeps its own session. |
| Employees (link, search, daily sync) | `/api/v1/organization/employees/by-user/{userId}`, `/employees/{id}` and `/employees?q=`, with the application's machine token (client credentials). |

`eapEmployeeId` in the Asset System is the Platform's **employee id** (as the Platform's `docs/development/usooli-integration.md` specifies). Asset System usernames must equal Platform usernames. A Platform account with no employee record, or an inactive employee, cannot sign in.

### Setup in the Platform (by a Platform administrator)

1. Register an application: code `osooli`, name «أصولي».
2. Issue a credential. The client secret is shown **once**.
3. Give the application a role holding `platform.employees.view` at scope All. Optionally add `platform.organization.view` so job titles show by name instead of position code. Never a Platform administrator role.
4. Every person who signs in needs a Platform account linked to their employee record, and a passkey registered on their device.
5. Check the credential before touching the Asset System: `POST /api/v1/oauth/token` (form: `grant_type=client_credentials&client_id=…&client_secret=…`) must return an `access_token`, and `GET /api/v1/organization/employees?pageSize=1` with it must succeed. Then the control panel's system status shows EAP as up.

### Setup in Railway (`api` service)

`AUTH_PROVIDER=eap`, `EAP_API_URL` (the Platform's base URL, e.g. `https://company-central-platform-production.up.railway.app`), `EAP_CLIENT_ID` and `EAP_CLIENT_SECRET`. Set the secret in Railway directly; never commit or paste it elsewhere.

### Fingerprint: passkeys registered in the Asset System

A passkey only works on the domain it was created for, and the Platform and the Asset System are on different domains. So the Asset System registers its own passkeys (`FINGERPRINT_MODE=passkey`, the default with `AUTH_PROVIDER=eap`):

- **First sign-in:** after the password, the person registers the device's fingerprint (phone, laptop with a fingerprint reader, Windows Hello). Every later sign-in asks that device to sign a fresh challenge.
- **Only public keys are stored** (`user_passkeys`). The fingerprint never leaves the device. A user-verification flag is required, so a tap without the fingerprint is refused.
- **More devices:** two ways.
  - On the new device, while signed in there: «جلساتي ← بصماتي ← إضافة هذا الجهاز».
  - A new device that cannot sign in yet, for example a phone when the fingerprint is on the computer: on the signed-in device, «جلساتي ← بصماتي ← ربط جهاز جديد» shows a 6-digit code. On the new device, sign in with the password, choose «جهاز جديد؟ اربطه برمز», type the code, and register that device's fingerprint. The code works once, for 10 minutes. Five wrong codes cancel it, and wrong codes count toward the account lockout. Only an HMAC of the code is stored.
- **Removing:** the last fingerprint cannot be removed.
- **Lost or replaced device:** an administrator uses «إعادة تعيين البصمة» on the user's page. All the user's passkeys are revoked (kept for the record, never deleted), and the next sign-in registers a new one after the password. This is audited and appears in the security log.
- **The domain is `WEB_ORIGIN`.** Passkeys are bound to its host name. Moving the Asset System to another domain (for example from `*.up.railway.app` to a company domain) means every user registers again: reset them all after the move.
- `FINGERPRINT_MODE=code` (the development stand-in) is refused in staging/production.

### Quick sign-in with a 4-digit PIN

After a full sign-in, the app offers to set up a PIN on that device. It only works on that device, five wrong PINs cancel it, and «إعادة تعيين البصمة» cancels it on all of the user's devices. Details and the reasoning are in [phases.md](phases.md#quick-sign-in-with-a-pin-decided-by-the-user-2026-10-03). Nothing to configure. It uses `ENCRYPTION_KEY`, so changing that key cancels every PIN, and users set them up again after a full sign-in.

### Rate limits

Every sign-in reaches the Platform from the Asset System's server, so the Platform sees one source address. Its per-address limit (`CCP_RateLimits__AuthenticationPerAddress`, default 60 a minute; each sign-in costs one `/auth/login` call, since the fingerprint is verified in the Asset System) applies to the whole company. The per-account limit (10 a minute) still protects each account. Raise the per-address value if sign-ins are refused at peak times.

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
