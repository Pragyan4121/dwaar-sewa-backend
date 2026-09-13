-- Remove the old global unique constraints.
-- PostgreSQL created these as table constraints, so they must be
-- removed with ALTER TABLE instead of DROP INDEX.

ALTER TABLE "users"
DROP CONSTRAINT IF EXISTS "users_phone_key";

ALTER TABLE "users"
DROP CONSTRAINT IF EXISTS "users_email_key";

-- Allow the same phone number for different roles,
-- while preventing duplicates inside the same role.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_phone_role"
ON "users" ("phone", "role_id");

-- Allow the same email for different roles,
-- while preventing duplicates inside the same role.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_email_role"
ON "users" ("email", "role_id");

-- Improve user lookup by role and account status.
CREATE INDEX IF NOT EXISTS "idx_users_role_active"
ON "users" ("role_id", "is_active");