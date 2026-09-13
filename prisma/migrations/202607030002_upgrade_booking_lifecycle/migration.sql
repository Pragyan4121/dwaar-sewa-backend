BEGIN;

-- Add lifecycle timestamps and cancellation information.
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP(6),
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP(6),
ADD COLUMN IF NOT EXISTS started_at TIMESTAMP(6),
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP(6),
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP(6),
ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(20),
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Remove the old booking-status check constraint if it exists.
ALTER TABLE bookings
DROP CONSTRAINT IF EXISTS chk_bookings_status;

-- Add the complete booking lifecycle.
ALTER TABLE bookings
ADD CONSTRAINT chk_bookings_status
CHECK (
    status IN (
        'pending',
        'accepted',
        'assigned',
        'in_progress',
        'completed',
        'cancelled'
    )
);

-- Validate who cancelled an order.
ALTER TABLE bookings
DROP CONSTRAINT IF EXISTS chk_bookings_cancelled_by;

ALTER TABLE bookings
ADD CONSTRAINT chk_bookings_cancelled_by
CHECK (
    cancelled_by IS NULL
    OR cancelled_by IN (
        'customer',
        'provider',
        'admin',
        'system'
    )
);

-- Improve status-based customer-history queries.
CREATE INDEX IF NOT EXISTS idx_bookings_customer_status_created
ON bookings(customer_id, status, created_at DESC);

-- Improve provider and admin booking queries.
CREATE INDEX IF NOT EXISTS idx_bookings_provider_status_created
ON bookings(provider_id, status, created_at DESC);

COMMIT;