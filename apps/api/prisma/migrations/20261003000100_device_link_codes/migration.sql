-- AlterEnum
ALTER TYPE "SecurityEventType" ADD VALUE 'DEVICE_LINK_CODE_CREATED';

-- CreateTable
CREATE TABLE "device_link_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_link_codes_user_id_idx" ON "device_link_codes"("user_id");

-- AddForeignKey
ALTER TABLE "device_link_codes" ADD CONSTRAINT "device_link_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Five wrong codes cancel the code.
ALTER TABLE "device_link_codes" ADD CONSTRAINT "device_link_codes_attempts_chk" CHECK (failed_attempts BETWEEN 0 AND 5);

-- Part of the security record: never deleted.
CREATE TRIGGER device_link_codes_no_delete
  BEFORE DELETE ON device_link_codes FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
