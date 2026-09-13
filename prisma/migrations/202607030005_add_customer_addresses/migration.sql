BEGIN;

CREATE TABLE IF NOT EXISTS customer_addresses (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    label VARCHAR(50) NOT NULL,
    full_address TEXT NOT NULL,
    service_area VARCHAR(100) NOT NULL,
    landmark VARCHAR(150),
    latitude DECIMAL(10, 7),
    longitude DECIMAL(10, 7),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_customer_addresses_customer
        FOREIGN KEY (customer_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT chk_customer_addresses_label
        CHECK (char_length(trim(label)) >= 1),

    CONSTRAINT chk_customer_addresses_full_address
        CHECK (char_length(trim(full_address)) >= 5),

    CONSTRAINT chk_customer_addresses_service_area
        CHECK (char_length(trim(service_area)) >= 2),

    CONSTRAINT chk_customer_addresses_latitude
        CHECK (
            latitude IS NULL
            OR (latitude >= -90 AND latitude <= 90)
        ),

    CONSTRAINT chk_customer_addresses_longitude
        CHECK (
            longitude IS NULL
            OR (longitude >= -180 AND longitude <= 180)
        )
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer_active
ON customer_addresses(customer_id, is_active);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer_default
ON customer_addresses(customer_id, is_default);

-- Only one active default address is allowed per customer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_addresses_one_default
ON customer_addresses(customer_id)
WHERE is_default = TRUE AND is_active = TRUE;

COMMIT;