-- Prisma treats a NULLS NOT DISTINCT index as a plain index and reports drift
-- for it. The same rule as an expression index is invisible to Prisma.
DROP INDEX IF EXISTS user_roles_unique_assignment;

CREATE UNIQUE INDEX user_roles_unique_assignment
  ON user_roles (
    user_id, role_id,
    COALESCE(scope_location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(scope_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
