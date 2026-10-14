BEGIN;

-- Lets a service be booked either as a full home visit (existing
-- behavior, base_price) or as a paid video consultation at its own,
-- typically lower, price. NULL means this service isn't offered as a
-- video consultation.
ALTER TABLE services
ADD COLUMN IF NOT EXISTS video_consultation_price NUMERIC(10, 2) NULL;

-- Which kind of booking this is. Home visit is the existing/default
-- behavior; video_consultation is the new paid-guidance-call flow.
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS booking_type VARCHAR(20) NOT NULL DEFAULT 'home_visit';

ALTER TABLE bookings
DROP CONSTRAINT IF EXISTS chk_bookings_booking_type;

ALTER TABLE bookings
ADD CONSTRAINT chk_bookings_booking_type
CHECK (
    booking_type IN ('home_visit', 'video_consultation')
);

-- Set by the provider at the end of a video consultation. NULL until
-- then; 'resolved' means no home visit is needed; 'needs_visit' means
-- the consultation earns the customer a credit toward a follow-up home
-- visit (see consultation_credits below).
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS consultation_outcome VARCHAR(20) NULL;

ALTER TABLE bookings
DROP CONSTRAINT IF EXISTS chk_bookings_consultation_outcome;

ALTER TABLE bookings
ADD CONSTRAINT chk_bookings_consultation_outcome
CHECK (
    consultation_outcome IS NULL
    OR consultation_outcome IN ('resolved', 'needs_visit')
);

-- One row per paid video consultation that resulted in a
-- 'needs_visit' outcome. Mirrors promotion_redemptions: a single-use,
-- row-lockable credit rather than a raw balance, so it can't be
-- double-spent across two home-visit bookings, and its origin (which
-- consultation earned it) is always traceable.
CREATE TABLE IF NOT EXISTS consultation_credits (
    id                      SERIAL PRIMARY KEY,
    consultation_booking_id INTEGER NOT NULL UNIQUE
        REFERENCES bookings (id) ON DELETE RESTRICT,
    customer_id             INTEGER NOT NULL
        REFERENCES users (id) ON DELETE RESTRICT,
    credit_amount           NUMERIC(10, 2) NOT NULL,
    status                  VARCHAR(20) NOT NULL DEFAULT 'available',
    redeemed_booking_id     INTEGER NULL UNIQUE
        REFERENCES bookings (id) ON DELETE SET NULL,
    expires_at              TIMESTAMP(6) NOT NULL,
    created_at              TIMESTAMP(6) NOT NULL DEFAULT now(),
    redeemed_at             TIMESTAMP(6) NULL
);

ALTER TABLE consultation_credits
DROP CONSTRAINT IF EXISTS chk_consultation_credits_status;

ALTER TABLE consultation_credits
ADD CONSTRAINT chk_consultation_credits_status
CHECK (
    status IN ('available', 'redeemed', 'expired')
);

CREATE INDEX IF NOT EXISTS idx_consultation_credits_customer_status
ON consultation_credits (customer_id, status);

CREATE INDEX IF NOT EXISTS idx_consultation_credits_expires
ON consultation_credits (status, expires_at);

-- Configurable window (in days) before an unused consultation credit
-- expires. Kept in system_settings rather than hardcoded so it can be
-- tuned from the admin panel without a deploy.
INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_public)
VALUES (
    'consultation_credit_expiry_days',
    '14',
    'integer',
    'Number of days a video-consultation credit stays valid before it expires unused.',
    false
)
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
