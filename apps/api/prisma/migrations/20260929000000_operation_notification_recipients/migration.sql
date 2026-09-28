-- Default recipients for operation notifications on databases where the
-- types already existed without recipients (fresh databases get them from
-- BootstrapService). Only types that still have no recipients are touched,
-- so an administrator's configuration is never overwritten.

INSERT INTO notification_recipients (id, type_key, role_id, target_responsible)
SELECT gen_random_uuid(), t.key, NULL, true
FROM notification_types t
WHERE t.key IN ('custody.created', 'custody.cancelled', 'custody.returned')
  AND NOT EXISTS (SELECT 1 FROM notification_recipients x WHERE x.type_key = t.key);

INSERT INTO notification_recipients (id, type_key, role_id, target_responsible)
SELECT gen_random_uuid(), t.key, r.id, false
FROM notification_types t
JOIN roles r ON r.key = CASE WHEN t.key = 'sale.created' THEN 'SYSTEM_ADMINISTRATOR' ELSE 'ASSET_MANAGER' END
WHERE t.key IN ('custody.confirmed', 'custody.rejected', 'sale.created')
  AND NOT EXISTS (SELECT 1 FROM notification_recipients x WHERE x.type_key = t.key);
