BEGIN;

-- Store the saved address used for a booking.
-- Nullable because customers may also enter an address manually.
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS customer_address_id INTEGER;

-- Add the foreign-key relationship.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_bookings_customer_address'
    ) THEN
        ALTER TABLE bookings
        ADD CONSTRAINT fk_bookings_customer_address
        FOREIGN KEY (customer_address_id)
        REFERENCES customer_addresses(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL;
    END IF;
END
$$;

-- Improve address-related booking lookups.
CREATE INDEX IF NOT EXISTS idx_bookings_customer_address
ON bookings(customer_address_id);

COMMIT;