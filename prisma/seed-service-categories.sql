BEGIN;

INSERT INTO service_categories (
    name,
    slug,
    description,
    image_url,
    is_active,
    display_order
)
VALUES
    (
        'AC Services',
        'ac-services',
        'Professional AC repair, installation and maintenance services.',
        NULL,
        TRUE,
        1
    ),
    (
        'Plumbing Services',
        'plumbing-services',
        'Professional plumbing, leakage repair and pipe maintenance services.',
        NULL,
        TRUE,
        2
    ),
    (
        'Electrical Services',
        'electrical-services',
        'Household electrical inspection, installation and repair services.',
        NULL,
        TRUE,
        3
    ),
    (
        'Cleaning Services',
        'cleaning-services',
        'Reliable home, kitchen, bathroom and general cleaning services.',
        NULL,
        TRUE,
        4
    ),
    (
        'Appliance Repair',
        'appliance-repair',
        'Repair and maintenance services for household appliances.',
        NULL,
        TRUE,
        5
    ),
    (
        'Carpentry Services',
        'carpentry-services',
        'Furniture repair, woodwork and general carpentry services.',
        NULL,
        TRUE,
        6
    ),
    (
        'Painting Services',
        'painting-services',
        'Interior and exterior residential painting services.',
        NULL,
        TRUE,
        7
    ),
    (
        'Water Purifier Services',
        'water-purifier-services',
        'Water purifier installation, servicing and repair.',
        NULL,
        TRUE,
        8
    ),
    (
        'Pest Control',
        'pest-control',
        'Professional pest inspection and pest control services.',
        NULL,
        TRUE,
        9
    )
ON CONFLICT (slug) DO UPDATE
SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active,
    display_order = EXCLUDED.display_order,
    updated_at = CURRENT_TIMESTAMP;

-- Link plumbing-related existing services.
UPDATE services
SET category_id = (
    SELECT id
    FROM service_categories
    WHERE slug = 'plumbing-services'
)
WHERE
    LOWER(name) LIKE '%plumb%'
    OR LOWER(name) LIKE '%pipe%'
    OR LOWER(name) LIKE '%tap%';

-- Link electrical-related existing services.
UPDATE services
SET category_id = (
    SELECT id
    FROM service_categories
    WHERE slug = 'electrical-services'
)
WHERE
    LOWER(name) LIKE '%electric%'
    OR LOWER(name) LIKE '%wiring%';

-- Link cleaning-related existing services.
UPDATE services
SET category_id = (
    SELECT id
    FROM service_categories
    WHERE slug = 'cleaning-services'
)
WHERE
    LOWER(name) LIKE '%clean%';

-- Link AC-related existing services.
UPDATE services
SET category_id = (
    SELECT id
    FROM service_categories
    WHERE slug = 'ac-services'
)
WHERE
    LOWER(name) LIKE '%ac repair%'
    OR LOWER(name) LIKE '%ac installation%'
    OR LOWER(name) LIKE '%ac maintenance%'
    OR LOWER(name) LIKE '%air conditioner%';

-- Link appliance-related existing services.
UPDATE services
SET category_id = (
    SELECT id
    FROM service_categories
    WHERE slug = 'appliance-repair'
)
WHERE
    LOWER(name) LIKE '%appliance%'
    OR LOWER(name) LIKE '%refrigerator%'
    OR LOWER(name) LIKE '%washing machine%'
    OR LOWER(name) LIKE '%microwave%';

-- Link carpentry-related existing services.
UPDATE services
SET category_id = (
    SELECT id
    FROM service_categories
    WHERE slug = 'carpentry-services'
)
WHERE
    LOWER(name) LIKE '%carpenter%'
    OR LOWER(name) LIKE '%carpentry%'
    OR LOWER(name) LIKE '%furniture%';

-- Link painting-related existing services.
UPDATE services
SET category_id = (
    SELECT id
    FROM service_categories
    WHERE slug = 'painting-services'
)
WHERE
    LOWER(name) LIKE '%paint%';

-- Link water purifier services.
UPDATE services
SET category_id = (
    SELECT id
    FROM service_categories
    WHERE slug = 'water-purifier-services'
)
WHERE
    LOWER(name) LIKE '%water purifier%'
    OR LOWER(name) LIKE '%ro repair%';

-- Link pest-control services.
UPDATE services
SET category_id = (
    SELECT id
    FROM service_categories
    WHERE slug = 'pest-control'
)
WHERE
    LOWER(name) LIKE '%pest%'
    OR LOWER(name) LIKE '%termite%';

COMMIT;