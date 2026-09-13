BEGIN;

CREATE TABLE IF NOT EXISTS service_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    description TEXT,
    image_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT service_categories_name_unique UNIQUE (name),
    CONSTRAINT service_categories_slug_unique UNIQUE (slug),
    CONSTRAINT service_categories_display_order_check
      CHECK (display_order >= 0)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'services'
  ) THEN

    ALTER TABLE services
    ADD COLUMN IF NOT EXISTS category_id INTEGER;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'fk_services_category'
    ) THEN
      ALTER TABLE services
      ADD CONSTRAINT fk_services_category
      FOREIGN KEY (category_id)
      REFERENCES service_categories(id)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
    END IF;

    CREATE INDEX IF NOT EXISTS idx_services_category_id
    ON services(category_id);

    CREATE INDEX IF NOT EXISTS idx_services_category_active
    ON services(category_id, is_active);

  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_service_categories_active_order
ON service_categories(is_active, display_order);

COMMIT;