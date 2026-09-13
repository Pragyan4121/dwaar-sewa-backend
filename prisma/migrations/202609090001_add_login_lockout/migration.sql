BEGIN;

-- Brute-force protection: track consecutive failed login attempts and a
-- temporary lockout window per user. Enforced today only for the admin
-- role (highest-privilege account), but available for all roles.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP(6) NULL;

COMMIT;
