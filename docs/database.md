# Database integrity

Business rules are enforced in the service layer **and** in PostgreSQL
(spec §8, §59, §61). The database layer is the last line of defence: it holds
even if a bug or a manual query bypasses the API.

Rules Prisma cannot express live in hand-written migrations:
`prisma/migrations/20260927000100_integrity` and later.

## Uniqueness

| Rule | Mechanism |
| --- | --- |
| Asset number never reused, even after a category change | `UNIQUE asset_number_history.asset_number` + `UNIQUE assets.asset_number` |
| Serial number unique system-wide, case-insensitive, including sold assets | `UNIQUE assets(lower(serial_number))` |
| QR token unique and immutable | `UNIQUE assets.qr_token` + `assets_guard` trigger |
| Operation numbers (TRF/CUS/RET/SAL/MNT/INV) unique | `UNIQUE number` on each operation table |
| No double sale | `UNIQUE sales.asset_id` |
| No double custody | partial unique index `custody_items(asset_id) WHERE is_pending` |
| One open maintenance per asset | partial unique index `maintenances(asset_id) WHERE status <> 'CLOSED'` |

## Number allocation

`number_sequences` holds one row per sequence (`ASSET:OFF`, `OP:TRF`, …).
`NumberingService.allocate` runs `UPDATE … SET next_value = next_value + 1
RETURNING`, which row-locks the sequence, so concurrent callers get distinct
values. It must run inside the caller's transaction. Gaps after a rollback are
acceptable (spec §60).

## Immutability (triggers)

| Table | Rule |
| --- | --- |
| `audit_logs`, `security_logs` | No UPDATE, DELETE or TRUNCATE — for anyone |
| `transfers`, `custody_returns(_items)`, `sales`, `serial_number_history`, `inventory_reopenings`, `stored_files` | Final at creation |
| `custodies` | Editable only while `PENDING` |
| `custody_items` | Only `is_pending` may flip true → false |
| `maintenances` | Immutable once `CLOSED` (انتهاء الصيانة) |
| `inventories`, `inventory_items` | Immutable once `CLOSED`; reopening requires an `inventory_reopenings` row (reason, actor) in the same transaction |
| `document_versions` | Only `is_current` may flip true → false |
| `notifications` | Only `read_at` may change; no DELETE |
| `assets` | New assets must start as `NEW`; `SOLD` requires a sale row; sold assets can't change status, location, department or responsible person, and can't be deleted |
| `asset_events`, `asset_number_history` | Append-only. Deletion is allowed only together with an asset that has no history, and only when the service sets `SET LOCAL osooli.asset_purge = 'on'` |

## CHECK constraints (examples)

- An asset has exactly one responsible person: an employee **or** an external person.
- A document belongs to exactly one owner: the asset or a single operation.
- Custody status and its timestamps/reasons agree (rejection and cancellation need a reason).
- Maintenance in `COMPLETED`/`CLOSED` has an after photo, end date and resulting status.
- Money amounts are ≥ 0, and an amount requires a currency.

## History foreign keys

Every location, department and person referenced by history rows (transfers,
custody items, returns, inventory items, unregistered-asset records) has a
RESTRICT foreign key, so a referenced record can only be disabled, never
deleted. Services try the delete and translate a refusal into an Arabic
"disable it instead" message.

## Composite foreign keys

- `assets(location_id, department_id)` → `location_departments`: only registered combinations.
- `assets(subcategory_id, main_category)` → `subcategories(id, main_category)`: the subcategory must belong to the main category.

## Writing new migrations

`prisma migrate dev` ignores partial and expression indexes, so it does not
try to drop them. Still, review every generated migration before committing.
CI fails if the schema and the migrations drift apart.
