# Go-live checklist

For whoever deploys and operates the system. Items marked **blocking** must
be done before real company data enters the system.

## 1. Decisions and integrations

- [ ] **Blocking — EAP (Company Central Platform).** The integration is implemented (see [deployment.md](deployment.md#eap-company-central-platform)). Still to do: register the application in the Platform and set `EAP_CLIENT_ID` / `EAP_CLIENT_SECRET`; make sure every user has a Platform account linked to an employee record. Fingerprints are registered in the Asset System at first sign-in.
- [ ] **Blocking — object storage.** Create a private S3-compatible bucket, ideally with versioning, and set the `STORAGE_*` variables.
- [ ] Confirm the rules recorded in [phases.md](phases.md) under "please confirm" (phases 3–7) and the remaining open decisions there.

## 2. Railway setup

- [ ] PostgreSQL plugin, `api` and `web` services as described in [deployment.md](deployment.md).
- [ ] All API variables set; `APP_ENV=production`, `TRUST_PROXY=true`, `TZ=Asia/Hebron`.
- [ ] **Blocking —** `INITIAL_ADMIN_EAP_EMPLOYEE_ID` and `INITIAL_ADMIN_USERNAME` set for the first administrator (see section 4).
- [ ] `ENCRYPTION_KEY` generated fresh for production (`openssl rand -base64 48`) and stored only in Railway.
- [ ] `web` has `API_UPSTREAM` pointing at the API's private URL.
- [ ] Custom domain attached to `web`, with HTTPS active. `WEB_ORIGIN` equals that domain.
- [ ] GitHub: secret `RAILWAY_TOKEN` and variables `RAILWAY_API_SERVICE`, `RAILWAY_WEB_SERVICE` on the `production` environment. Alternatively, Railway auto-deploy with "Wait for CI".
- [ ] A separate **staging** environment with its own database, bucket and key. Never share them with production.

## 3. First deployment

- [ ] CI green on `main`: lint, typecheck, unit, integration and permission matrix, build, E2E, performance budgets, Docker images and web image smoke test.
- [ ] The API applied migrations at start (`prisma migrate deploy`). **The seed never runs in production**, and it refuses to.
- [ ] `GET /api/v1/health` returns `ok`. In the control panel, system status shows the database, EAP and storage as up.
- [ ] Response headers on the public domain include HSTS and a CSP (`curl -I https://<domain>/`). `http://` redirects to `https://`.

## 4. Initial configuration (by the first administrator)

The first System Administrator is created on start-up from `INITIAL_ADMIN_EAP_EMPLOYEE_ID` and `INITIAL_ADMIN_USERNAME`. They must name an active EAP employee. They take effect only while no active System Administrator exists; the creation is recorded in the audit and security logs. After the first sign-in, remove both variables.

- [ ] Settings: company name and logo (they appear on official PDFs), security (session length, lockout), allowed file types and sizes, currencies (USD, ILS), numbering.
- [ ] Categories, subcategories, locations, departments and their combinations.
- [ ] Roles: review the default Asset Manager permissions and create any extra roles.
- [ ] Users: create accounts for the people who need the system.
- [ ] External people and maintenance providers.
- [ ] Notification types and recipients.
- [ ] Run the EAP employee sync once manually. Check the inactive-responsible list.

## 5. Acceptance on staging

Run through these by hand on staging with fictional data, on a desktop and on a phone:

- [ ] Sign-in (3 steps), sign-out, session expiry and lockout.
- [ ] Create an asset, then edit it, change its category and change its serial.
- [ ] Print a QR label and scan it with a phone camera.
- [ ] Transfer; custody (confirm, reject, cancel); return; maintenance through closing; sale.
- [ ] Open, check and close an inventory with a discrepancy, then reopen it.
- [ ] Fingerprint: first sign-in registers the device, the next sign-in uses it, a second device is added from «بصماتي», and an administrator reset forces re-registration.
- [ ] Offline: download data, count and photograph without network, reconnect, and confirm sync.
- [ ] Reports: preview, PDF and Excel export.
- [ ] Official PDFs render Arabic correctly, with the company name and logo.
- [ ] A user without permission is refused, both in the UI and through the API.

## 6. Backups and recovery (spec §79)

- [ ] Confirm the PostgreSQL backup plan and retention with Railway. Point-in-time recovery depends on the plan.
- [ ] Confirm bucket versioning and retention with the storage provider.
- [ ] **Do one test restore** of the database into staging and check that assets, history and files open.
- [ ] Record who can restore and how long it takes.

## 7. After go-live

- [ ] Watch the security log for failed sign-ins and lockouts during the first week.
- [ ] Review the technical logs for errors. Secrets are never logged.
- [ ] Keep dependencies patched: `npm audit` runs clean today. Re-run it on each release.

## Test coverage map

Where each mandatory item of the spec is tested. E2E tests run on desktop and on a phone viewport.

| Spec item | Where |
| --- | --- |
| Login | `e2e/login.spec.ts`, `apps/api/test/auth.test.ts` |
| Fingerprint (passkeys, real signatures) | `e2e/passkey.spec.ts` (Chromium virtual authenticator), `apps/api/test/passkeys.test.ts` (software authenticator) |
| Asset creation, editing | `e2e/assets.spec.ts`, `apps/api/test/assets.test.ts` |
| Category change | `e2e/assets.spec.ts` |
| Serial uniqueness | `e2e/assets-extra.spec.ts`, `apps/api/test/assets.test.ts`, database unique index |
| QR | `e2e/assets-extra.spec.ts`, `e2e/assets.spec.ts`, `e2e/inventory.spec.ts` (scan) |
| Transfer, maintenance, maintenance completion, sale | `e2e/operations.spec.ts`, `apps/api/test/operations.test.ts` |
| Custody, confirmation | `e2e/operations.spec.ts` |
| Custody rejection, cancellation, return | `e2e/custody-flows.spec.ts` |
| Inventory, discrepancy | `e2e/inventory.spec.ts`, `apps/api/test/inventory.test.ts` |
| Documents | `e2e/assets-extra.spec.ts` |
| Reports | `e2e/reports.spec.ts`, `apps/api/test/search-reports.test.ts` |
| Permissions (§82: 403 through the API) | `apps/api/test/permissions-matrix.test.ts` (every route), `e2e/permissions.spec.ts` |
| Offline start, QR, inventory, photo, queue, reconnect, auto sync, failed sync, conflict, retry, clear local data (§83) | `e2e/offline.spec.ts`, `apps/web/src/offline/offline.test.tsx`, `apps/api/test/sync.test.ts` |
| Seed data and environment separation (§84–85) | `apps/api/test/seed.test.ts` |
| Phone layout (no sideways scrolling) | `e2e/permissions.spec.ts` |
| Performance | `npm run perf` (budgets in `apps/api/scripts/perf-check.mjs`) |
