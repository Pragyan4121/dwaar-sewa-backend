-- Adds support for providers selecting a different experience level per
-- category (previously experience was a single flat set shared across all
-- of a provider's categories, with no link to which category it applied
-- to).
--
-- The existing provider_experience_types table is left in place and kept
-- in sync (as the distinct union of experience levels chosen across
-- categories) so any existing code reading from it keeps working.

BEGIN;

CREATE TABLE provider_category_experiences (
    id                  SERIAL PRIMARY KEY,
    provider_id         INTEGER NOT NULL,
    category_id         INTEGER NOT NULL,
    experience_type_id  INTEGER NOT NULL,
    created_at          TIMESTAMP(6) NOT NULL DEFAULT now(),
    updated_at          TIMESTAMP(6) NOT NULL DEFAULT now(),

    CONSTRAINT fk_provider_category_experience_provider
        FOREIGN KEY (provider_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_provider_category_experience_category
        FOREIGN KEY (category_id)
        REFERENCES service_categories(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_provider_category_experience_type
        FOREIGN KEY (experience_type_id)
        REFERENCES experience_types(id)
        ON DELETE CASCADE,

    -- One experience level per category per provider.
    CONSTRAINT uq_provider_category_experience
        UNIQUE (provider_id, category_id)
);

CREATE INDEX idx_provider_category_experience_provider
    ON provider_category_experiences (provider_id);

CREATE INDEX idx_provider_category_experience_category
    ON provider_category_experiences (category_id);

CREATE INDEX idx_provider_category_experience_type
    ON provider_category_experiences (experience_type_id);

COMMIT;
