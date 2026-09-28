-- Stored at check time so discrepancy lists can be filtered and paginated in SQL.
-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "has_discrepancy" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "inventory_items_inventory_id_checked_at_idx" ON "inventory_items"("inventory_id", "checked_at");

