-- History tables referenced locations/departments without foreign keys, so a
-- location could be deleted while transfers or inventory rows still pointed
-- at it. These FKs make such deletions impossible (spec §63).

-- Remove duplicate maintenance providers created by repeated dev seeding
-- (only rows no maintenance references) before adding the unique rule.
DELETE FROM maintenance_providers p
USING maintenance_providers q
WHERE p.type = q.type AND p.name = q.name AND p.id > q.id
  AND NOT EXISTS (SELECT 1 FROM maintenances m WHERE m.provider_id = p.id);

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_providers_type_name_key" ON "maintenance_providers"("type", "name");

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_department_id_fkey" FOREIGN KEY ("from_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_department_id_fkey" FOREIGN KEY ("to_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_expected_location_id_fkey" FOREIGN KEY ("expected_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_expected_department_id_fkey" FOREIGN KEY ("expected_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_actual_location_id_fkey" FOREIGN KEY ("actual_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_actual_department_id_fkey" FOREIGN KEY ("actual_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_unregistered_assets" ADD CONSTRAINT "inventory_unregistered_assets_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_unregistered_assets" ADD CONSTRAINT "inventory_unregistered_assets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

