-- History rows kept previous/expected responsible people without foreign keys,
-- so an external person could be deleted while history still referenced them.

ALTER TABLE "custody_items" ADD CONSTRAINT "custody_items_previous_responsible_employee_id_fkey" FOREIGN KEY ("previous_responsible_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "custody_items" ADD CONSTRAINT "custody_items_previous_responsible_external_id_fkey" FOREIGN KEY ("previous_responsible_external_id") REFERENCES "external_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "custody_return_items" ADD CONSTRAINT "custody_return_items_previous_responsible_employee_id_fkey" FOREIGN KEY ("previous_responsible_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "custody_return_items" ADD CONSTRAINT "custody_return_items_previous_responsible_external_id_fkey" FOREIGN KEY ("previous_responsible_external_id") REFERENCES "external_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_expected_responsible_employee_id_fkey" FOREIGN KEY ("expected_responsible_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_expected_responsible_external_id_fkey" FOREIGN KEY ("expected_responsible_external_id") REFERENCES "external_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

