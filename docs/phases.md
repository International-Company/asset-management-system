# Delivery phases

The spec is delivered in reviewable phases. Each phase ends with lint,
typecheck, unit, integration/API and E2E tests passing.

| # | Phase | Status |
| - | --- | --- |
| 1 | Foundation: monorepo, full database schema + integrity rules, auth (3-step, mock EAP), sessions, RBAC (fail-closed), audit/security logs, numbering, settings, health, RTL shell, control panel, CI/CD, Docker | **Done** |
| 2 | Administration: users & roles (custom roles, last-admin protection), categories/subcategories, locations/departments + combinations, external people, maintenance providers, settings (company, security, files, currencies, numbering), audit & security log viewers, EAP employee sync (daily + manual) with inactive-responsible alerts, control-panel sections | **Done** |
| 3 | Assets: atomic creation (number, INT-SN serial, QR token), descriptive edit with old → new review and optimistic concurrency, category change (new number, old retired, QR unchanged), serial replacement with history, technical & real-estate details, purchase/warranty, photos (main photo, permission-controlled removal), documents with versions, content-based file validation, S3 storage adapter, QR resolution and label PDFs (1/8/24 per page), history timeline, deletion rules, sold assets read-only, company logo | **Done** |
| 4 | Operations: transfers; custody records (multi-asset, confirm by the receiver or on behalf of an external person, reject/cancel with reason); custody returns (per-asset new responsible); maintenance lifecycle with required photos and final close; sales with attachments; official Arabic PDFs archived as immutable documents; current-custody panel; "awaiting your confirmation" on the home page; operation notifications | **Done** |
| 5 | Inventory: scopes (location, location + department, several locations or departments), frozen expected data, camera QR scanning with manual fallback, per-asset checks with photo, discrepancies, not-found, out-of-scope and unregistered assets, closing only when complete with reconciliation, official PDF, exceptional reopening with versioned PDF | **Done** |
| 6 | Advanced asset search (combinable conditions), saved searches with administrator sharing to roles, 12 reports with preview and Arabic PDF/Excel export (each export audited), saved report filters, notification inbox with unread badge, system-wide view for administrators, notification types and recipients management | **Done** |
| 7 | Offline PWA: cached app shell and last signed-in user, per-user local snapshot (IndexedDB), offline asset lookup by QR/number/serial, offline inventory counting with photos and unregistered assets, offline asset notes and photos, idempotent sync queue (Pending / Syncing / Synced / Needs Review) with automatic sync on reconnect, conflict detection that never overwrites newer server data, pending indicator, logout warning, clear local data | **Done** |
| 8 | Hardening: every mandatory E2E item (§81) on desktop and phone, route-by-route permission matrix through the API (§82), all offline cases (§83), seed covering every listed entity (§84) and refusing staging/production (§85), performance budgets at 20,000 assets, security headers fixed and checked in CI, first-administrator creation for a fresh deployment, go-live checklist | **Done** |

## Deferred on purpose

- **Scoped role assignment** (location/department, spec §45): the database supports it, but the API does not accept scopes yet, because permission checks do not evaluate them. Assigning a scoped role today would wrongly grant global access.

## Design decisions in phase 3 (please confirm)

- **Sold assets are fully read-only**, including descriptive fields, photos and documents. The spec only lists operational actions as blocked after a sale; making the whole record read-only keeps it historically intact. Sale documents will attach to the sale operation (phase 4).
- **Editing is split by concern:** the edit form changes descriptive data only. Status, location/department and the responsible person change through operations (phase 4); category and serial have their own confirmed actions with their own permissions.
- **Asset Manager cannot delete assets or remove photos by default** (`assets.delete` and `assets.photos.delete` are System Administrator permissions). An administrator can grant them through a role.

## Operation rules chosen in phase 4 (please confirm)

The spec leaves these open; each is enforced by the API and tested.

- **Custody hand-over is refused** for assets that are sold, lost, disposed, under maintenance, or have an open maintenance request.
- **Custody confirmation** by an external person is recorded by a user with `custody.confirm_external`, on their behalf; the PDF and audit log say so.
- **Return:** the condition at return (in use / unused / damaged) becomes the asset's status. A return is refused while the asset is in a pending custody or under maintenance.
- **Maintenance:** the asset becomes "under maintenance" when work *starts*, not when the request is opened; completion sets the resulting status (in use / unused / damaged / disposed); closing ("انتهاء الصيانة") makes the request and its cost final. Lost or disposed assets cannot enter maintenance.
- **Sale:** allowed whatever the status (spec), but refused while a custody is pending or maintenance is open, so no operation is left dangling on a sold asset. Buyer types offered: فرد / شركة / جهة حكومية / أخرى.
- **Transfers have no official PDF**, since spec §38 lists PDFs only for custody, return, inventory, maintenance and sale.

## Inventory rules chosen in phase 5 (please confirm)

- **Sold and disposed assets are not counted.** A disposed asset has left service; include it if you want disposed items physically verified.
- **Discrepancies are applied when the inventory closes**, not at each check, so a count can be corrected freely while in progress.
- **Conflicting updates are skipped and reported, not forced:** a responsible change while a custody is pending, or a status change while maintenance is open. The skip appears in the audit log and the asset history.
- **A registered asset found outside the scope** can be added to the count; its actual location is then applied on close. Truly unknown codes become "أصل غير مسجل" records; no asset is created.
- **Re-closing after a reopening** applies only the items re-checked since, and issues the official PDF as a new version of the same document.
- **Inventory settings (spec §64)** are still undefined; nothing depends on them yet.

## Reporting notes (phase 6)

- **Export limits:** PDF exports up to 5,000 rows and says so when truncated; Excel exports up to 50,000 rows. Previews show the first 200 rows.
- **Report permissions:** every report needs `reports.view` plus the view permission of its data (e.g. the sales report also needs `sales.view`); exporting needs `reports.export`. The audit and security reports are therefore administrator-only by default.
- **Audit and security logs** are exported through their reports, with the same filters as the log screens.

## Offline rules chosen in phase 7 (please confirm)

- **Allowed offline:** asset lookup, inventory checks (found / not found, actual location, department and status, notes, photo), unregistered assets, and asset notes and photos. Everything else needs a connection, including changing the actual responsible person during a count, which is a sensitive change.
- **What the device keeps:** the snapshot holds up to 20,000 active (not sold) assets with lookup fields only: no purchase values, suppliers, documents, contact details or logs. It also holds open inventories (only for users with `inventory.manage`) and active locations. It belongs to the signed-in user and is wiped on logout or when another user signs in on the device.
- **Conflicts:** each queued operation carries the server state it was based on (the item's check time, or the asset's version). If another user changed the record in the meantime, or the inventory was closed, the operation becomes "تحتاج مراجعة" and nothing is overwritten. The user reviews the current record and repeats the operation if needed.
- **Retries are safe:** every operation has a client ID. Sending it again after a lost response never applies it twice. Network errors, server errors and an expired session keep operations pending; after signing in again they are sent automatically.
- **Logging out needs a connection** so the server session really ends. With unsynced operations, the user is warned that logging out deletes them from the device.

## Hardening notes (phase 8)

- **Test coverage map:** [go-live.md](go-live.md) lists where each spec item is tested.
- **Permission matrix:** `apps/api/test/permissions-matrix.test.ts` discovers every API route. It fails if a route has no access rule, if a route open to every signed-in user is added without review, or if a user without permissions gets anything other than 403.
- **Performance** (`npm run perf`, also in CI) with 20,000 assets and 100,000 audit entries: lists, searches and previews under 60 ms (p95); offline snapshot about 0.4 s; Excel export about 1.4 s; PDF export (5,000 rows) about 3.4 s.
- **Fixed during hardening:**
  - nginx dropped the security headers (HSTS, CSP…) on the app pages because of how `add_header` inheritance works.
  - A wide table inside a fieldset stretched pages sideways on phones.
  - A fresh production database had no way to get its first administrator.
- **Not verified on this machine:** the Docker images (Docker does not run here). CI builds them and now smoke-tests the web image.

## Open decisions (need input before production)

1. **EAP integration contract (spec §88).** Endpoints, payloads, and how the company fingerprint mechanism returns its verification result. Until then `EapHttpProvider` refuses every call; development uses the mock provider.
2. **Object storage provider** for production (any S3-compatible service works).
3. **"Inventory settings"** in spec §64 are not specified. Which settings are needed?
4. **One open maintenance per asset.** The database enforces this to keep asset status consistent. Please confirm that is the intended rule.
