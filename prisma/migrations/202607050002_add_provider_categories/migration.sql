CREATE TABLE "provider_categories" (
    "id" SERIAL NOT NULL,
    "provider_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_categories_pkey"
    PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_provider_category"
ON "provider_categories" ("provider_id", "category_id");

CREATE INDEX "idx_provider_categories_provider"
ON "provider_categories" ("provider_id");

CREATE INDEX "idx_provider_categories_category"
ON "provider_categories" ("category_id");

ALTER TABLE "provider_categories"
ADD CONSTRAINT "fk_provider_categories_provider"
FOREIGN KEY ("provider_id")
REFERENCES "users" ("id")
ON DELETE CASCADE
ON UPDATE NO ACTION;

ALTER TABLE "provider_categories"
ADD CONSTRAINT "fk_provider_categories_category"
FOREIGN KEY ("category_id")
REFERENCES "service_categories" ("id")
ON DELETE CASCADE
ON UPDATE NO ACTION;