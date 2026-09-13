BEGIN;

CREATE TABLE IF NOT EXISTS system_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) NOT NULL,
    setting_value TEXT,
    value_type VARCHAR(20) NOT NULL DEFAULT 'string',
    description TEXT,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by INTEGER,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_system_settings_key
        UNIQUE (setting_key),

    CONSTRAINT fk_system_settings_updated_by
        FOREIGN KEY (updated_by)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT chk_system_settings_value_type
        CHECK (
            value_type IN (
                'string',
                'number',
                'boolean',
                'json'
            )
        )
);

CREATE INDEX IF NOT EXISTS idx_system_settings_public
ON system_settings(is_public);

INSERT INTO system_settings (
    setting_key,
    setting_value,
    value_type,
    description,
    is_public
)
VALUES
    (
        'business_name',
        'Dwaar Sewa',
        'string',
        'Public business name displayed in the application',
        TRUE
    ),
    (
        'support_phone',
        '',
        'string',
        'Customer support phone number',
        TRUE
    ),
    (
        'support_email',
        '',
        'string',
        'Customer support email address',
        TRUE
    ),
    (
        'default_service_area',
        'Bharatpur',
        'string',
        'Default service area for initial operations',
        TRUE
    ),
    (
        'provider_commission_percent',
        '15',
        'number',
        'Commission percentage charged to providers',
        FALSE
    ),
    (
        'customer_cancellation_window_minutes',
        '60',
        'number',
        'Minimum minutes before service time for customer cancellation',
        FALSE
    ),
    (
        'cash_payment_enabled',
        'true',
        'boolean',
        'Allow cash payment for bookings',
        TRUE
    ),
    (
        'maintenance_mode',
        'false',
        'boolean',
        'Temporarily disable normal customer and provider operations',
        TRUE
    )
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;