BEGIN;

-- ============================================================
-- 1. Experience types managed by admin
-- Examples: AC Technician, Plumber, Electrician
-- ============================================================

CREATE TABLE IF NOT EXISTS experience_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_experience_types_name UNIQUE (name),
    CONSTRAINT uq_experience_types_slug UNIQUE (slug),

    CONSTRAINT chk_experience_types_display_order
        CHECK (display_order >= 0)
);

-- ============================================================
-- 2. Provider detailed profile
-- One provider user can have one provider profile
-- ============================================================

CREATE TABLE IF NOT EXISTS provider_profiles (
    id SERIAL PRIMARY KEY,
    provider_id INTEGER NOT NULL,
    address TEXT,
    profile_photo_url TEXT,
    years_of_experience INTEGER NOT NULL DEFAULT 0,
    bio TEXT,
    verification_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    verification_note TEXT,
    verified_at TIMESTAMP(6),
    verified_by INTEGER,
    suspended_at TIMESTAMP(6),
    rejection_reason TEXT,
    average_rating DECIMAL(3, 2) NOT NULL DEFAULT 0,
    total_reviews INTEGER NOT NULL DEFAULT 0,
    total_completed_jobs INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_provider_profiles_provider UNIQUE (provider_id),

    CONSTRAINT fk_provider_profiles_provider
        FOREIGN KEY (provider_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_provider_profiles_verified_by
        FOREIGN KEY (verified_by)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT chk_provider_profiles_experience
        CHECK (years_of_experience >= 0),

    CONSTRAINT chk_provider_profiles_verification_status
        CHECK (
            verification_status IN (
                'pending',
                'verified',
                'rejected',
                'suspended'
            )
        ),

    CONSTRAINT chk_provider_profiles_rating
        CHECK (
            average_rating >= 0
            AND average_rating <= 5
        ),

    CONSTRAINT chk_provider_profiles_total_reviews
        CHECK (total_reviews >= 0),

    CONSTRAINT chk_provider_profiles_completed_jobs
        CHECK (total_completed_jobs >= 0)
);

-- ============================================================
-- 3. Provider experience types
-- A provider can select multiple experience types
-- ============================================================

CREATE TABLE IF NOT EXISTS provider_experience_types (
    id SERIAL PRIMARY KEY,
    provider_id INTEGER NOT NULL,
    experience_type_id INTEGER NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_provider_experience_type
        UNIQUE (provider_id, experience_type_id),

    CONSTRAINT fk_provider_experience_provider
        FOREIGN KEY (provider_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_provider_experience_type
        FOREIGN KEY (experience_type_id)
        REFERENCES experience_types(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

-- ============================================================
-- 4. Link service categories to experience types
-- Used for matching jobs to qualified providers
-- ============================================================

CREATE TABLE IF NOT EXISTS category_experience_types (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL,
    experience_type_id INTEGER NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_category_experience_type
        UNIQUE (category_id, experience_type_id),

    CONSTRAINT fk_category_experience_category
        FOREIGN KEY (category_id)
        REFERENCES service_categories(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_category_experience_type
        FOREIGN KEY (experience_type_id)
        REFERENCES experience_types(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

-- ============================================================
-- 5. Provider verification documents
-- ============================================================

CREATE TABLE IF NOT EXISTS provider_documents (
    id SERIAL PRIMARY KEY,
    provider_id INTEGER NOT NULL,
    document_type VARCHAR(50) NOT NULL,
    document_number VARCHAR(100),
    file_url TEXT NOT NULL,
    verification_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    rejection_reason TEXT,
    reviewed_at TIMESTAMP(6),
    reviewed_by INTEGER,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_provider_documents_provider
        FOREIGN KEY (provider_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_provider_documents_reviewed_by
        FOREIGN KEY (reviewed_by)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT chk_provider_documents_type
        CHECK (
            document_type IN (
                'citizenship',
                'national_id',
                'passport',
                'driving_license',
                'training_certificate',
                'experience_certificate',
                'other'
            )
        ),

    CONSTRAINT chk_provider_documents_status
        CHECK (
            verification_status IN (
                'pending',
                'verified',
                'rejected'
            )
        )
);

-- ============================================================
-- 6. Helpful indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_experience_types_active_order
ON experience_types(is_active, display_order);

CREATE INDEX IF NOT EXISTS idx_provider_profiles_status
ON provider_profiles(verification_status);

CREATE INDEX IF NOT EXISTS idx_provider_profiles_rating
ON provider_profiles(average_rating DESC);

CREATE INDEX IF NOT EXISTS idx_provider_experience_provider
ON provider_experience_types(provider_id);

CREATE INDEX IF NOT EXISTS idx_provider_experience_type
ON provider_experience_types(experience_type_id);

CREATE INDEX IF NOT EXISTS idx_category_experience_category
ON category_experience_types(category_id);

CREATE INDEX IF NOT EXISTS idx_category_experience_type
ON category_experience_types(experience_type_id);

CREATE INDEX IF NOT EXISTS idx_provider_documents_provider
ON provider_documents(provider_id);

CREATE INDEX IF NOT EXISTS idx_provider_documents_status
ON provider_documents(verification_status);

-- ============================================================
-- 7. Create profiles for existing providers
-- ============================================================

INSERT INTO provider_profiles (
    provider_id,
    verification_status,
    years_of_experience,
    average_rating,
    total_reviews,
    total_completed_jobs
)
SELECT
    u.id,
    CASE
        WHEN u.is_active = TRUE THEN 'verified'
        ELSE 'pending'
    END,
    0,
    0,
    0,
    0
FROM users u
INNER JOIN roles r
    ON r.id = u.role_id
WHERE r.name = 'provider'
ON CONFLICT (provider_id) DO NOTHING;

COMMIT;