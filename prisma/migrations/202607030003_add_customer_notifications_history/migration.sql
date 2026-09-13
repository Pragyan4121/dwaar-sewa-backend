BEGIN;

-- Stores every important booking status change.
CREATE TABLE IF NOT EXISTS booking_status_history (
    id SERIAL PRIMARY KEY,
    booking_id INTEGER NOT NULL,
    old_status VARCHAR(30),
    new_status VARCHAR(30) NOT NULL,
    changed_by_user_id INTEGER,
    changed_by_role VARCHAR(20),
    note TEXT,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_booking_status_history_booking
        FOREIGN KEY (booking_id)
        REFERENCES bookings(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_booking_status_history_user
        FOREIGN KEY (changed_by_user_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT chk_booking_status_history_new_status
        CHECK (
            new_status IN (
                'pending',
                'accepted',
                'assigned',
                'in_progress',
                'completed',
                'cancelled'
            )
        ),

    CONSTRAINT chk_booking_status_history_old_status
        CHECK (
            old_status IS NULL
            OR old_status IN (
                'pending',
                'accepted',
                'assigned',
                'in_progress',
                'completed',
                'cancelled'
            )
        ),

    CONSTRAINT chk_booking_status_history_role
        CHECK (
            changed_by_role IS NULL
            OR changed_by_role IN (
                'customer',
                'provider',
                'admin',
                'system'
            )
        )
);

-- Stores in-app notifications.
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    booking_id INTEGER,
    notification_type VARCHAR(50) NOT NULL,
    title VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMP(6),
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_notifications_booking
        FOREIGN KEY (booking_id)
        REFERENCES bookings(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT chk_notifications_type
        CHECK (
            notification_type IN (
                'booking_created',
                'new_job',
                'job_accepted',
                'job_assigned',
                'job_started',
                'job_completed',
                'booking_cancelled',
                'provider_verified',
                'general'
            )
        )
);

CREATE INDEX IF NOT EXISTS idx_booking_status_history_booking_created
ON booking_status_history(booking_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
ON notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
ON notifications(user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_booking
ON notifications(booking_id);

COMMIT;