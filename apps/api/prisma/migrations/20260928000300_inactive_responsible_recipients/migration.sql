-- Backfill the default recipient (System Administrator role) for the
-- inactive-responsible alert on databases where the type already existed
-- without recipients. Fresh databases get it from BootstrapService.
INSERT INTO notification_recipients (id, type_key, role_id, target_responsible)
SELECT gen_random_uuid(), t.key, r.id, false
FROM notification_types t
JOIN roles r ON r.key = 'SYSTEM_ADMINISTRATOR'
WHERE t.key = 'employee.inactive_responsible'
  AND NOT EXISTS (SELECT 1 FROM notification_recipients x WHERE x.type_key = t.key);
