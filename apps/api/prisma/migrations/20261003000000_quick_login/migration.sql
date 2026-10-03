-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityEventType" ADD VALUE 'QUICK_LOGIN_ENABLED';
ALTER TYPE "SecurityEventType" ADD VALUE 'QUICK_LOGIN_REVOKED';

-- CreateTable
CREATE TABLE "quick_login_devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "public_key" BYTEA NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "device_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,

    CONSTRAINT "quick_login_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quick_login_devices_user_id_idx" ON "quick_login_devices"("user_id");

-- AddForeignKey
ALTER TABLE "quick_login_devices" ADD CONSTRAINT "quick_login_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Five wrong PINs revoke the device; the counter never exceeds that.
ALTER TABLE "quick_login_devices" ADD CONSTRAINT "quick_login_devices_attempts_chk" CHECK (failed_attempts BETWEEN 0 AND 5);

-- Part of the security record: revoke, never delete.
CREATE TRIGGER quick_login_devices_no_delete
  BEFORE DELETE ON quick_login_devices FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
