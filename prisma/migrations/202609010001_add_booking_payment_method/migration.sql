BEGIN;

-- Customer-selected payment method for the booking (cash or an online gateway).
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'cash';

-- Restrict to the gateways supported by the app.
ALTER TABLE bookings
DROP CONSTRAINT IF EXISTS chk_bookings_payment_method;

ALTER TABLE bookings
ADD CONSTRAINT chk_bookings_payment_method
CHECK (
    payment_method IN (
        'cash',
        'esewa',
        'khalti',
        'connectips'
    )
);

-- Provider wallet balances now legitimately go negative (cash-collected
-- commission owed back to the platform), so drop any non-negative guard
-- that may have been added on the database side previously.
ALTER TABLE wallets
DROP CONSTRAINT IF EXISTS chk_wallets_balance_non_negative;

COMMIT;
