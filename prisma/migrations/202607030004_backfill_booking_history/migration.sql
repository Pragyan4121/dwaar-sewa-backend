BEGIN;

-- Add one initial history record for every existing booking
-- that currently has no history.
INSERT INTO booking_status_history (
    booking_id,
    old_status,
    new_status,
    changed_by_user_id,
    changed_by_role,
    note,
    created_at
)
SELECT
    b.id,
    NULL,
    b.status,
    b.customer_id,
    'system',
    'Initial status history created for an existing booking.',
    b.created_at
FROM bookings b
WHERE NOT EXISTS (
    SELECT 1
    FROM booking_status_history h
    WHERE h.booking_id = b.id
);

-- Fill lifecycle timestamps for old records where possible.

UPDATE bookings
SET accepted_at = COALESCE(accepted_at, updated_at)
WHERE status IN (
    'accepted',
    'assigned',
    'in_progress',
    'completed'
);

UPDATE bookings
SET assigned_at = COALESCE(assigned_at, updated_at)
WHERE status IN (
    'assigned',
    'in_progress',
    'completed'
);

UPDATE bookings
SET started_at = COALESCE(started_at, updated_at)
WHERE status IN (
    'in_progress',
    'completed'
);

UPDATE bookings
SET completed_at = COALESCE(completed_at, updated_at)
WHERE status = 'completed';

UPDATE bookings
SET
    cancelled_at = COALESCE(cancelled_at, updated_at),
    cancelled_by = COALESCE(cancelled_by, 'system'),
    cancellation_reason = COALESCE(
        cancellation_reason,
        'Cancellation information was not available for this existing booking.'
    )
WHERE status = 'cancelled';

COMMIT;