-- Integrity rules Prisma cannot express: CHECK constraints, partial unique
-- indexes and immutability triggers. Business rules are also enforced in the
-- service layer; these are the last line of defence (spec §8, §59, §61).

-- ─────────────────────────────────────────────────────────────
-- Exactly-one / consistency CHECKs
-- ─────────────────────────────────────────────────────────────

ALTER TABLE assets
  ADD CONSTRAINT assets_one_responsible_chk
    CHECK (num_nonnulls(responsible_employee_id, responsible_external_id) = 1),
  ADD CONSTRAINT assets_purchase_value_chk
    CHECK (purchase_value IS NULL OR purchase_value >= 0),
  ADD CONSTRAINT assets_purchase_currency_chk
    CHECK (purchase_value IS NULL OR purchase_currency IS NOT NULL),
  ADD CONSTRAINT assets_name_chk CHECK (length(btrim(name)) > 0),
  ADD CONSTRAINT assets_serial_chk CHECK (length(btrim(serial_number)) > 0),
  ADD CONSTRAINT assets_warranty_chk
    CHECK (warranty_exists OR (warranty_expires_at IS NULL AND warranty_details IS NULL)),
  ADD CONSTRAINT assets_version_chk CHECK (version >= 1);

ALTER TABLE asset_real_estate_details
  ADD CONSTRAINT real_estate_area_chk CHECK (area IS NULL OR area >= 0);

ALTER TABLE number_sequences
  ADD CONSTRAINT number_sequences_next_value_chk CHECK (next_value >= 0),
  ADD CONSTRAINT number_sequences_digits_chk CHECK (digits BETWEEN 1 AND 12),
  ADD CONSTRAINT number_sequences_prefix_chk CHECK (prefix ~ '^[A-Z][A-Z0-9-]{0,15}$');

ALTER TABLE currencies
  ADD CONSTRAINT currencies_code_chk CHECK (code ~ '^[A-Z]{3}$');

ALTER TABLE documents
  ADD CONSTRAINT documents_one_owner_chk CHECK (
    num_nonnulls(asset_id, transfer_id, custody_id, custody_return_id,
                 maintenance_id, sale_id, inventory_id) = 1
  ),
  ADD CONSTRAINT documents_name_chk CHECK (length(btrim(name)) > 0);

ALTER TABLE document_versions
  ADD CONSTRAINT document_versions_version_chk CHECK (version >= 1);

ALTER TABLE stored_files
  ADD CONSTRAINT stored_files_size_chk CHECK (size_bytes >= 0);

ALTER TABLE custodies
  ADD CONSTRAINT custodies_one_new_responsible_chk
    CHECK (num_nonnulls(new_responsible_employee_id, new_responsible_external_id) = 1),
  ADD CONSTRAINT custodies_state_chk CHECK (
    (status = 'PENDING'   AND confirmed_at IS NULL AND rejected_at IS NULL AND cancelled_at IS NULL) OR
    (status = 'CONFIRMED' AND confirmed_at IS NOT NULL AND confirmed_by_id IS NOT NULL) OR
    (status = 'REJECTED'  AND rejected_at IS NOT NULL AND rejection_reason IS NOT NULL
                          AND length(btrim(rejection_reason)) > 0) OR
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL
                          AND length(btrim(cancellation_reason)) > 0)
  );

ALTER TABLE custody_items
  ADD CONSTRAINT custody_items_prev_responsible_chk
    CHECK (num_nonnulls(previous_responsible_employee_id, previous_responsible_external_id) <= 1);

ALTER TABLE custody_return_items
  ADD CONSTRAINT custody_return_items_new_responsible_chk
    CHECK (num_nonnulls(new_responsible_employee_id, new_responsible_external_id) = 1);

ALTER TABLE sales
  ADD CONSTRAINT sales_value_chk CHECK (sale_value >= 0),
  ADD CONSTRAINT sales_buyer_chk CHECK (length(btrim(buyer_name)) > 0);

ALTER TABLE maintenances
  ADD CONSTRAINT maintenances_technician_chk CHECK (
    (technician_type = 'EMPLOYEE' AND technician_employee_id IS NOT NULL AND provider_id IS NULL) OR
    (technician_type IN ('EXTERNAL', 'COMPANY') AND provider_id IS NOT NULL AND technician_employee_id IS NULL)
  ),
  ADD CONSTRAINT maintenances_cost_chk CHECK (cost IS NULL OR cost >= 0),
  ADD CONSTRAINT maintenances_cost_currency_chk CHECK (cost IS NULL OR currency IS NOT NULL),
  ADD CONSTRAINT maintenances_dates_chk CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  ADD CONSTRAINT maintenances_completion_chk CHECK (
    status NOT IN ('COMPLETED', 'CLOSED') OR
    (after_photo_id IS NOT NULL AND end_date IS NOT NULL AND resulting_status IS NOT NULL)
  ),
  ADD CONSTRAINT maintenances_closed_chk CHECK (
    status <> 'CLOSED' OR (closed_at IS NOT NULL AND closed_by_id IS NOT NULL)
  );

ALTER TABLE inventories
  ADD CONSTRAINT inventories_closed_chk CHECK (
    (status = 'CLOSED' AND closed_at IS NOT NULL AND closed_by_id IS NOT NULL) OR status = 'IN_PROGRESS'
  );

ALTER TABLE inventory_scopes
  ADD CONSTRAINT inventory_scopes_nonempty_chk CHECK (num_nonnulls(location_id, department_id) >= 1);

ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_actual_responsible_chk
    CHECK (num_nonnulls(actual_responsible_employee_id, actual_responsible_external_id) <= 1),
  ADD CONSTRAINT inventory_items_checked_chk CHECK (
    (checked_at IS NULL AND "exists" IS NULL) OR
    (checked_at IS NOT NULL AND "exists" IS NOT NULL AND checked_by_id IS NOT NULL)
  );

ALTER TABLE inventory_reopenings
  ADD CONSTRAINT inventory_reopenings_reason_chk CHECK (length(btrim(reason)) > 0);

ALTER TABLE notification_recipients
  ADD CONSTRAINT notification_recipients_target_chk
    CHECK (num_nonnulls(role_id, user_id) + (CASE WHEN target_responsible THEN 1 ELSE 0 END) = 1);

ALTER TABLE saved_search_shares
  ADD CONSTRAINT saved_search_shares_target_chk CHECK (num_nonnulls(role_id, user_id) = 1);

-- ─────────────────────────────────────────────────────────────
-- Partial / special unique indexes
-- ─────────────────────────────────────────────────────────────

-- An asset can be in at most one pending custody (prevents double custody).
CREATE UNIQUE INDEX custody_items_one_pending_per_asset
  ON custody_items (asset_id) WHERE is_pending;

-- At most one open maintenance per asset.
CREATE UNIQUE INDEX maintenances_one_open_per_asset
  ON maintenances (asset_id) WHERE status <> 'CLOSED';

-- One active main photo per asset.
CREATE UNIQUE INDEX asset_photos_one_main
  ON asset_photos (asset_id) WHERE is_main AND removed_at IS NULL;

-- One current version per document.
CREATE UNIQUE INDEX document_versions_one_current
  ON document_versions (document_id) WHERE is_current;

-- One official (archived) PDF per operation.
CREATE UNIQUE INDEX documents_one_official_per_custody
  ON documents (custody_id) WHERE is_official AND custody_id IS NOT NULL;
CREATE UNIQUE INDEX documents_one_official_per_return
  ON documents (custody_return_id) WHERE is_official AND custody_return_id IS NOT NULL;
CREATE UNIQUE INDEX documents_one_official_per_maintenance
  ON documents (maintenance_id) WHERE is_official AND maintenance_id IS NOT NULL;
CREATE UNIQUE INDEX documents_one_official_per_sale
  ON documents (sale_id) WHERE is_official AND sale_id IS NOT NULL;
CREATE UNIQUE INDEX documents_one_official_per_inventory
  ON documents (inventory_id) WHERE is_official AND inventory_id IS NOT NULL;

-- A role is assigned at most once per scope (NULL scope = global).
CREATE UNIQUE INDEX user_roles_unique_assignment
  ON user_roles (user_id, role_id, scope_location_id, scope_department_id) NULLS NOT DISTINCT;

-- Case-insensitive uniqueness for serial numbers (spec §8) and reference names.
CREATE UNIQUE INDEX assets_serial_number_ci ON assets (lower(serial_number));
CREATE UNIQUE INDEX subcategories_name_ci ON subcategories (main_category, lower(name));
CREATE UNIQUE INDEX locations_name_ci ON locations (lower(name));
CREATE UNIQUE INDEX departments_name_ci ON departments (lower(name));

-- ─────────────────────────────────────────────────────────────
-- Immutability triggers
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION osooli_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE: % on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$;

-- Append-only logs: no UPDATE, DELETE or TRUNCATE — for any user.
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION osooli_reject_change();
CREATE TRIGGER security_logs_append_only
  BEFORE UPDATE OR DELETE ON security_logs FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
CREATE TRIGGER security_logs_no_truncate
  BEFORE TRUNCATE ON security_logs FOR EACH STATEMENT EXECUTE FUNCTION osooli_reject_change();

-- Final-at-creation operations.
CREATE TRIGGER transfers_immutable
  BEFORE UPDATE OR DELETE ON transfers FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
CREATE TRIGGER custody_returns_immutable
  BEFORE UPDATE OR DELETE ON custody_returns FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
CREATE TRIGGER custody_return_items_immutable
  BEFORE UPDATE OR DELETE ON custody_return_items FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
CREATE TRIGGER sales_immutable
  BEFORE UPDATE OR DELETE ON sales FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
CREATE TRIGGER serial_history_immutable
  BEFORE UPDATE OR DELETE ON serial_number_history FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
CREATE TRIGGER inventory_reopenings_immutable
  BEFORE UPDATE OR DELETE ON inventory_reopenings FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
CREATE TRIGGER inventory_unregistered_no_delete
  BEFORE DELETE ON inventory_unregistered_assets FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
CREATE TRIGGER documents_no_delete
  BEFORE DELETE ON documents FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
CREATE TRIGGER stored_files_immutable
  BEFORE UPDATE OR DELETE ON stored_files FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
CREATE TRIGGER custodies_no_delete
  BEFORE DELETE ON custodies FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
CREATE TRIGGER custody_items_no_delete
  BEFORE DELETE ON custody_items FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
CREATE TRIGGER maintenances_no_delete
  BEFORE DELETE ON maintenances FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
CREATE TRIGGER inventories_no_delete
  BEFORE DELETE ON inventories FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
CREATE TRIGGER inventory_items_no_delete
  BEFORE DELETE ON inventory_items FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
CREATE TRIGGER notifications_no_delete
  BEFORE DELETE ON notifications FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();

-- Asset history rows may only be removed together with an asset that has no
-- history (spec §62). The service verifies that and sets
-- `SET LOCAL osooli.asset_purge = 'on'` inside the deleting transaction.
CREATE OR REPLACE FUNCTION osooli_asset_history_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('osooli.asset_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'asset_number_history'
     AND OLD.retired_at IS NULL AND NEW.retired_at IS NOT NULL
     AND NEW.asset_number = OLD.asset_number AND NEW.asset_id = OLD.asset_id THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE: % on % is not allowed', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER asset_events_guard
  BEFORE UPDATE OR DELETE ON asset_events FOR EACH ROW EXECUTE FUNCTION osooli_asset_history_guard();
CREATE TRIGGER asset_number_history_guard
  BEFORE UPDATE OR DELETE ON asset_number_history FOR EACH ROW EXECUTE FUNCTION osooli_asset_history_guard();

-- Custody: editable only while PENDING; final states are immutable.
CREATE OR REPLACE FUNCTION osooli_custody_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'IMMUTABLE: custody % is final (%)', OLD.number, OLD.status USING ERRCODE = 'P0001';
  END IF;
  IF NEW.number <> OLD.number OR NEW.created_by_id <> OLD.created_by_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'IMMUTABLE: custody identity columns cannot change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER custodies_guard
  BEFORE UPDATE ON custodies FOR EACH ROW EXECUTE FUNCTION osooli_custody_guard();

-- Custody items: only the is_pending flag may flip true → false.
CREATE OR REPLACE FUNCTION osooli_custody_item_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_pending AND NOT NEW.is_pending
     AND (to_jsonb(NEW) - 'is_pending') = (to_jsonb(OLD) - 'is_pending') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE: custody item cannot be modified' USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER custody_items_guard
  BEFORE UPDATE ON custody_items FOR EACH ROW EXECUTE FUNCTION osooli_custody_item_guard();

-- Maintenance: immutable once CLOSED ("انتهاء الصيانة").
CREATE OR REPLACE FUNCTION osooli_maintenance_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'IMMUTABLE: maintenance % is closed', OLD.number USING ERRCODE = 'P0001';
  END IF;
  IF NEW.number <> OLD.number OR NEW.asset_id <> OLD.asset_id OR NEW.before_photo_id <> OLD.before_photo_id THEN
    RAISE EXCEPTION 'IMMUTABLE: maintenance identity columns cannot change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER maintenances_guard
  BEFORE UPDATE ON maintenances FOR EACH ROW EXECUTE FUNCTION osooli_maintenance_guard();

-- Inventory: immutable once CLOSED, except an exceptional reopening that is
-- recorded (with reason) in inventory_reopenings in the same transaction.
CREATE OR REPLACE FUNCTION osooli_inventory_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'CLOSED' THEN
    IF NEW.status = 'IN_PROGRESS' AND EXISTS (
      SELECT 1 FROM inventory_reopenings r
      WHERE r.inventory_id = OLD.id AND r.created_at >= OLD.closed_at
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'IMMUTABLE: inventory % is closed', OLD.number USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventories_guard
  BEFORE UPDATE ON inventories FOR EACH ROW EXECUTE FUNCTION osooli_inventory_guard();

CREATE OR REPLACE FUNCTION osooli_inventory_item_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM inventories WHERE id = OLD.inventory_id) = 'CLOSED' THEN
    RAISE EXCEPTION 'IMMUTABLE: inventory is closed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_items_guard
  BEFORE UPDATE ON inventory_items FOR EACH ROW EXECUTE FUNCTION osooli_inventory_item_guard();

-- Document versions: only is_current may flip true → false (on replacement).
CREATE OR REPLACE FUNCTION osooli_document_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.is_current AND NOT NEW.is_current
     AND (to_jsonb(NEW) - 'is_current') = (to_jsonb(OLD) - 'is_current') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE: document versions cannot be modified' USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER document_versions_guard
  BEFORE UPDATE OR DELETE ON document_versions FOR EACH ROW EXECUTE FUNCTION osooli_document_version_guard();

-- Notifications: only read_at may be set.
CREATE OR REPLACE FUNCTION osooli_notification_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'read_at') = (to_jsonb(OLD) - 'read_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE: notifications cannot be modified' USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER notifications_guard
  BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION osooli_notification_guard();

-- Assets: sold assets can never be deleted, and their operational fields
-- (status, location, department, responsible) are frozen. SOLD can only be
-- set when a sale row exists.
CREATE OR REPLACE FUNCTION osooli_asset_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'SOLD' OR EXISTS (SELECT 1 FROM sales WHERE asset_id = OLD.id) THEN
      RAISE EXCEPTION 'IMMUTABLE: sold asset % cannot be deleted', OLD.asset_number USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'SOLD' AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.location_id IS DISTINCT FROM OLD.location_id
    OR NEW.department_id IS DISTINCT FROM OLD.department_id
    OR NEW.responsible_employee_id IS DISTINCT FROM OLD.responsible_employee_id
    OR NEW.responsible_external_id IS DISTINCT FROM OLD.responsible_external_id
  ) THEN
    RAISE EXCEPTION 'ASSET_SOLD: operational fields of sold asset % are frozen', OLD.asset_number
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = 'SOLD' AND OLD.status <> 'SOLD'
     AND NOT EXISTS (SELECT 1 FROM sales WHERE asset_id = NEW.id) THEN
    RAISE EXCEPTION 'INVALID_STATE: asset % cannot be SOLD without a sale record', OLD.asset_number
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.qr_token <> OLD.qr_token THEN
    RAISE EXCEPTION 'IMMUTABLE: QR token cannot change' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER assets_guard
  BEFORE UPDATE OR DELETE ON assets FOR EACH ROW EXECUTE FUNCTION osooli_asset_guard();

-- New assets always start as NEW (spec §11).
CREATE OR REPLACE FUNCTION osooli_asset_insert_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'NEW' THEN
    RAISE EXCEPTION 'INVALID_STATE: new assets must start with status NEW' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assets_insert_guard
  BEFORE INSERT ON assets FOR EACH ROW EXECUTE FUNCTION osooli_asset_insert_guard();
