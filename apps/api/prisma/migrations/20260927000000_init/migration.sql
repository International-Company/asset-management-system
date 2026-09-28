-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MainCategoryCode" AS ENUM ('OFF', 'OPR', 'TEC', 'REA');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('NEW', 'IN_USE', 'UNUSED', 'UNDER_MAINTENANCE', 'DAMAGED', 'LOST', 'DISPOSED', 'SOLD');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CustodyStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'COMPLETED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TechnicianType" AS ENUM ('EMPLOYEE', 'EXTERNAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('IN_PROGRESS', 'CLOSED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'LOGGED_OUT', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'ACCOUNT_LOCKED', 'SESSION_EXPIRED', 'SESSION_TERMINATED', 'ROLE_CHANGED', 'PERMISSION_CHANGED', 'SECURITY_SETTING_CHANGED');

-- CreateEnum
CREATE TYPE "SyncOperationStatus" AS ENUM ('PENDING', 'SYNCING', 'SYNCED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "AssetEventType" AS ENUM ('CREATED', 'UPDATED', 'CATEGORY_CHANGED', 'SERIAL_CHANGED', 'TRANSFERRED', 'CUSTODY_CREATED', 'CUSTODY_CONFIRMED', 'CUSTODY_REJECTED', 'CUSTODY_CANCELLED', 'CUSTODY_RETURNED', 'INVENTORY_CHECKED', 'MAINTENANCE_OPENED', 'MAINTENANCE_UPDATED', 'MAINTENANCE_COMPLETED', 'MAINTENANCE_CLOSED', 'SOLD', 'DOCUMENT_ADDED', 'DOCUMENT_REPLACED', 'PHOTO_ADDED', 'PHOTO_REMOVED', 'MAIN_PHOTO_CHANGED');

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "eap_employee_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "job_title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_key")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_location_id" UUID,
    "scope_department_id" UUID,
    "assigned_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_people" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "organization" TEXT,
    "notes" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "external_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_providers" (
    "id" UUID NOT NULL,
    "type" "TechnicianType" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "maintenance_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "ip" TEXT,
    "user_agent" TEXT,
    "device" TEXT,
    "browser" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "terminated_by_id" UUID,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_challenges" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "provider_ref" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_logs" (
    "id" BIGSERIAL NOT NULL,
    "type" "SecurityEventType" NOT NULL,
    "user_id" UUID,
    "username" TEXT,
    "actor_id" UUID,
    "session_id" UUID,
    "ip" TEXT,
    "device" TEXT,
    "browser" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "actor_name" TEXT,
    "operation" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "old_data" JSONB,
    "new_data" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "currencies" (
    "code" VARCHAR(3) NOT NULL,
    "name_ar" TEXT NOT NULL,
    "symbol" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "key" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "next_value" BIGINT NOT NULL,
    "digits" INTEGER NOT NULL DEFAULT 6,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "main_categories" (
    "code" "MainCategoryCode" NOT NULL,
    "name_ar" TEXT NOT NULL,
    "sequence_key" TEXT NOT NULL,

    CONSTRAINT "main_categories_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "subcategories" (
    "id" UUID NOT NULL,
    "main_category" "MainCategoryCode" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subcategories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_departments" (
    "location_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_departments_pkey" PRIMARY KEY ("location_id","department_id")
);

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_official" BOOLEAN NOT NULL DEFAULT false,
    "asset_id" UUID,
    "transfer_id" UUID,
    "custody_id" UUID,
    "custody_return_id" UUID,
    "maintenance_id" UUID,
    "sale_id" UUID,
    "inventory_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "file_id" UUID NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "asset_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "main_category" "MainCategoryCode" NOT NULL,
    "subcategory_id" UUID NOT NULL,
    "serial_number" TEXT NOT NULL,
    "serial_is_internal" BOOLEAN NOT NULL DEFAULT false,
    "qr_token" TEXT NOT NULL,
    "location_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "responsible_employee_id" UUID,
    "responsible_external_id" UUID,
    "status" "AssetStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "purchase_date" DATE,
    "supplier" TEXT,
    "invoice_number" TEXT,
    "purchase_value" DECIMAL(18,2),
    "purchase_currency" VARCHAR(3),
    "warranty_exists" BOOLEAN NOT NULL DEFAULT false,
    "warranty_expires_at" DATE,
    "warranty_details" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_technical_details" (
    "asset_id" UUID NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "mac_address" TEXT,
    "ip_address" TEXT,
    "operating_system" TEXT,
    "specifications" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "asset_technical_details_pkey" PRIMARY KEY ("asset_id")
);

-- CreateTable
CREATE TABLE "asset_real_estate_details" (
    "asset_id" UUID NOT NULL,
    "property_type" TEXT,
    "property_name" TEXT,
    "location_text" TEXT,
    "area" DECIMAL(14,2),
    "property_number" TEXT,
    "parcel_number" TEXT,
    "ownership_deed" TEXT,
    "ownership_date" DATE,
    "ownership_notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "asset_real_estate_details_pkey" PRIMARY KEY ("asset_id")
);

-- CreateTable
CREATE TABLE "asset_number_history" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "asset_number" TEXT NOT NULL,
    "main_category" "MainCategoryCode" NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMPTZ(3),
    "actor_id" UUID,
    "reason" TEXT,

    CONSTRAINT "asset_number_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serial_number_history" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "old_serial" TEXT NOT NULL,
    "new_serial" TEXT NOT NULL,
    "actor_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "serial_number_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_events" (
    "id" BIGSERIAL NOT NULL,
    "asset_id" UUID NOT NULL,
    "type" "AssetEventType" NOT NULL,
    "actor_id" UUID,
    "operation_type" TEXT,
    "operation_id" UUID,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "snapshot" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_photos" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "added_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(3),
    "removed_by_id" UUID,

    CONSTRAINT "asset_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "asset_id" UUID NOT NULL,
    "from_location_id" UUID NOT NULL,
    "from_department_id" UUID NOT NULL,
    "to_location_id" UUID NOT NULL,
    "to_department_id" UUID NOT NULL,
    "notes" TEXT,
    "actor_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custodies" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "CustodyStatus" NOT NULL DEFAULT 'PENDING',
    "new_responsible_employee_id" UUID,
    "new_responsible_external_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(3),
    "confirmed_by_id" UUID,
    "rejected_at" TIMESTAMPTZ(3),
    "rejected_by_id" UUID,
    "rejection_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancellation_reason" TEXT,

    CONSTRAINT "custodies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custody_items" (
    "id" UUID NOT NULL,
    "custody_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "is_pending" BOOLEAN NOT NULL DEFAULT true,
    "condition_at_handover" "AssetStatus" NOT NULL,
    "notes" TEXT,
    "previous_responsible_employee_id" UUID,
    "previous_responsible_external_id" UUID,
    "asset_snapshot" JSONB NOT NULL,

    CONSTRAINT "custody_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custody_returns" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "notes" TEXT,
    "actor_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custody_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custody_return_items" (
    "id" UUID NOT NULL,
    "custody_return_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "condition_at_return" "AssetStatus" NOT NULL,
    "notes" TEXT,
    "previous_responsible_employee_id" UUID,
    "previous_responsible_external_id" UUID,
    "new_responsible_employee_id" UUID,
    "new_responsible_external_id" UUID,
    "asset_snapshot" JSONB NOT NULL,

    CONSTRAINT "custody_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "asset_id" UUID NOT NULL,
    "sale_date" DATE NOT NULL,
    "sale_value" DECIMAL(18,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "buyer_name" TEXT NOT NULL,
    "buyer_type" TEXT NOT NULL,
    "reference_number" TEXT,
    "notes" TEXT,
    "status_before_sale" "AssetStatus" NOT NULL,
    "asset_snapshot" JSONB NOT NULL,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenances" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "asset_id" UUID NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'NEW',
    "technician_type" "TechnicianType" NOT NULL,
    "technician_employee_id" UUID,
    "provider_id" UUID,
    "start_date" TIMESTAMPTZ(3),
    "end_date" TIMESTAMPTZ(3),
    "cost" DECIMAL(18,2),
    "currency" VARCHAR(3),
    "before_photo_id" UUID NOT NULL,
    "after_photo_id" UUID,
    "what_was_repaired" TEXT,
    "status_before_maintenance" "AssetStatus" NOT NULL,
    "resulting_status" "AssetStatus",
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" UUID,

    CONSTRAINT "maintenances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventories" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "InventoryStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_scopes" (
    "id" UUID NOT NULL,
    "inventory_id" UUID NOT NULL,
    "location_id" UUID,
    "department_id" UUID,

    CONSTRAINT "inventory_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "inventory_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "expected_location_id" UUID NOT NULL,
    "expected_department_id" UUID NOT NULL,
    "expected_responsible_employee_id" UUID,
    "expected_responsible_external_id" UUID,
    "expected_status" "AssetStatus" NOT NULL,
    "checked_at" TIMESTAMPTZ(3),
    "checked_by_id" UUID,
    "exists" BOOLEAN,
    "confirmed_by_qr" BOOLEAN NOT NULL DEFAULT false,
    "actual_location_id" UUID,
    "actual_department_id" UUID,
    "actual_responsible_employee_id" UUID,
    "actual_responsible_external_id" UUID,
    "actual_status" "AssetStatus",
    "notes" TEXT,
    "photo_id" UUID,
    "reconciled_at" TIMESTAMPTZ(3),

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_unregistered_assets" (
    "id" UUID NOT NULL,
    "inventory_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "scanned_code" TEXT,
    "location_id" UUID,
    "department_id" UUID,
    "notes" TEXT,
    "photo_id" UUID,
    "recorded_by_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_unregistered_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_reopenings" (
    "id" UUID NOT NULL,
    "inventory_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_reopenings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_types" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_types_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "notification_recipients" (
    "id" UUID NOT NULL,
    "type_key" TEXT NOT NULL,
    "role_id" UUID,
    "user_id" UUID,
    "target_responsible" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "notification_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_searches" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "columns" JSONB,
    "sort" JSONB,
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_search_shares" (
    "id" UUID NOT NULL,
    "saved_search_id" UUID NOT NULL,
    "role_id" UUID,
    "user_id" UUID,

    CONSTRAINT "saved_search_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_operations" (
    "id" UUID NOT NULL,
    "client_operation_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "base_version" INTEGER,
    "status" "SyncOperationStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "error_code" TEXT,
    "client_created_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_eap_employee_id_key" ON "employees"("eap_employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE INDEX "user_roles_user_id_idx" ON "user_roles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_status_idx" ON "sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "login_challenges_expires_at_idx" ON "login_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "security_logs_type_created_at_idx" ON "security_logs"("type", "created_at");

-- CreateIndex
CREATE INDEX "security_logs_user_id_created_at_idx" ON "security_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "main_categories_sequence_key_key" ON "main_categories"("sequence_key");

-- CreateIndex
CREATE UNIQUE INDEX "subcategories_id_main_category_key" ON "subcategories"("id", "main_category");

-- CreateIndex
CREATE UNIQUE INDEX "subcategories_main_category_name_key" ON "subcategories"("main_category", "name");

-- CreateIndex
CREATE UNIQUE INDEX "locations_name_key" ON "locations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_storage_key_key" ON "stored_files"("storage_key");

-- CreateIndex
CREATE INDEX "documents_asset_id_idx" ON "documents"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_key" ON "document_versions"("document_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "assets_asset_number_key" ON "assets"("asset_number");

-- CreateIndex
CREATE UNIQUE INDEX "assets_serial_number_key" ON "assets"("serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "assets_qr_token_key" ON "assets"("qr_token");

-- CreateIndex
CREATE INDEX "assets_status_idx" ON "assets"("status");

-- CreateIndex
CREATE INDEX "assets_location_id_department_id_idx" ON "assets"("location_id", "department_id");

-- CreateIndex
CREATE INDEX "assets_main_category_subcategory_id_idx" ON "assets"("main_category", "subcategory_id");

-- CreateIndex
CREATE INDEX "assets_responsible_employee_id_idx" ON "assets"("responsible_employee_id");

-- CreateIndex
CREATE INDEX "assets_responsible_external_id_idx" ON "assets"("responsible_external_id");

-- CreateIndex
CREATE INDEX "asset_technical_details_mac_address_idx" ON "asset_technical_details"("mac_address");

-- CreateIndex
CREATE INDEX "asset_technical_details_ip_address_idx" ON "asset_technical_details"("ip_address");

-- CreateIndex
CREATE UNIQUE INDEX "asset_number_history_asset_number_key" ON "asset_number_history"("asset_number");

-- CreateIndex
CREATE INDEX "asset_number_history_asset_id_idx" ON "asset_number_history"("asset_id");

-- CreateIndex
CREATE INDEX "serial_number_history_asset_id_idx" ON "serial_number_history"("asset_id");

-- CreateIndex
CREATE INDEX "asset_events_asset_id_occurred_at_idx" ON "asset_events"("asset_id", "occurred_at");

-- CreateIndex
CREATE INDEX "asset_photos_asset_id_idx" ON "asset_photos"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_number_key" ON "transfers"("number");

-- CreateIndex
CREATE INDEX "transfers_asset_id_idx" ON "transfers"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "custodies_number_key" ON "custodies"("number");

-- CreateIndex
CREATE INDEX "custodies_status_idx" ON "custodies"("status");

-- CreateIndex
CREATE INDEX "custody_items_asset_id_idx" ON "custody_items"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "custody_items_custody_id_asset_id_key" ON "custody_items"("custody_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "custody_returns_number_key" ON "custody_returns"("number");

-- CreateIndex
CREATE INDEX "custody_return_items_asset_id_idx" ON "custody_return_items"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "custody_return_items_custody_return_id_asset_id_key" ON "custody_return_items"("custody_return_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_number_key" ON "sales"("number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_asset_id_key" ON "sales"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenances_number_key" ON "maintenances"("number");

-- CreateIndex
CREATE INDEX "maintenances_asset_id_idx" ON "maintenances"("asset_id");

-- CreateIndex
CREATE INDEX "maintenances_status_idx" ON "maintenances"("status");

-- CreateIndex
CREATE UNIQUE INDEX "inventories_number_key" ON "inventories"("number");

-- CreateIndex
CREATE INDEX "inventories_status_idx" ON "inventories"("status");

-- CreateIndex
CREATE INDEX "inventory_scopes_inventory_id_idx" ON "inventory_scopes"("inventory_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_inventory_id_asset_id_key" ON "inventory_items"("inventory_id", "asset_id");

-- CreateIndex
CREATE INDEX "inventory_unregistered_assets_inventory_id_idx" ON "inventory_unregistered_assets"("inventory_id");

-- CreateIndex
CREATE INDEX "inventory_reopenings_inventory_id_idx" ON "inventory_reopenings"("inventory_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "saved_searches_owner_id_scope_idx" ON "saved_searches"("owner_id", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "sync_operations_client_operation_id_key" ON "sync_operations"("client_operation_id");

-- CreateIndex
CREATE INDEX "sync_operations_user_id_status_idx" ON "sync_operations"("user_id", "status");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_scope_location_id_fkey" FOREIGN KEY ("scope_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_scope_department_id_fkey" FOREIGN KEY ("scope_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcategories" ADD CONSTRAINT "subcategories_main_category_fkey" FOREIGN KEY ("main_category") REFERENCES "main_categories"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_departments" ADD CONSTRAINT "location_departments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_departments" ADD CONSTRAINT "location_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_custody_id_fkey" FOREIGN KEY ("custody_id") REFERENCES "custodies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_custody_return_id_fkey" FOREIGN KEY ("custody_return_id") REFERENCES "custody_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_maintenance_id_fkey" FOREIGN KEY ("maintenance_id") REFERENCES "maintenances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_main_category_fkey" FOREIGN KEY ("main_category") REFERENCES "main_categories"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_subcategory_id_main_category_fkey" FOREIGN KEY ("subcategory_id", "main_category") REFERENCES "subcategories"("id", "main_category") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_location_id_department_id_fkey" FOREIGN KEY ("location_id", "department_id") REFERENCES "location_departments"("location_id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_responsible_employee_id_fkey" FOREIGN KEY ("responsible_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_responsible_external_id_fkey" FOREIGN KEY ("responsible_external_id") REFERENCES "external_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_purchase_currency_fkey" FOREIGN KEY ("purchase_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_technical_details" ADD CONSTRAINT "asset_technical_details_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_real_estate_details" ADD CONSTRAINT "asset_real_estate_details_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_number_history" ADD CONSTRAINT "asset_number_history_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_number_history" ADD CONSTRAINT "serial_number_history_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_photos" ADD CONSTRAINT "asset_photos_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_photos" ADD CONSTRAINT "asset_photos_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custodies" ADD CONSTRAINT "custodies_new_responsible_employee_id_fkey" FOREIGN KEY ("new_responsible_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custodies" ADD CONSTRAINT "custodies_new_responsible_external_id_fkey" FOREIGN KEY ("new_responsible_external_id") REFERENCES "external_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_items" ADD CONSTRAINT "custody_items_custody_id_fkey" FOREIGN KEY ("custody_id") REFERENCES "custodies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_items" ADD CONSTRAINT "custody_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_return_items" ADD CONSTRAINT "custody_return_items_custody_return_id_fkey" FOREIGN KEY ("custody_return_id") REFERENCES "custody_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_return_items" ADD CONSTRAINT "custody_return_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_return_items" ADD CONSTRAINT "custody_return_items_new_responsible_employee_id_fkey" FOREIGN KEY ("new_responsible_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_return_items" ADD CONSTRAINT "custody_return_items_new_responsible_external_id_fkey" FOREIGN KEY ("new_responsible_external_id") REFERENCES "external_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_technician_employee_id_fkey" FOREIGN KEY ("technician_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "maintenance_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_before_photo_id_fkey" FOREIGN KEY ("before_photo_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_after_photo_id_fkey" FOREIGN KEY ("after_photo_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_scopes" ADD CONSTRAINT "inventory_scopes_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_scopes" ADD CONSTRAINT "inventory_scopes_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_scopes" ADD CONSTRAINT "inventory_scopes_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_actual_responsible_employee_id_fkey" FOREIGN KEY ("actual_responsible_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_actual_responsible_external_id_fkey" FOREIGN KEY ("actual_responsible_external_id") REFERENCES "external_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_unregistered_assets" ADD CONSTRAINT "inventory_unregistered_assets_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_unregistered_assets" ADD CONSTRAINT "inventory_unregistered_assets_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reopenings" ADD CONSTRAINT "inventory_reopenings_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_type_key_fkey" FOREIGN KEY ("type_key") REFERENCES "notification_types"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_key_fkey" FOREIGN KEY ("type_key") REFERENCES "notification_types"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_search_shares" ADD CONSTRAINT "saved_search_shares_saved_search_id_fkey" FOREIGN KEY ("saved_search_id") REFERENCES "saved_searches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_search_shares" ADD CONSTRAINT "saved_search_shares_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

