ALTER TABLE "site_pages" ADD COLUMN "fields_schema" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "site_pages" ADD COLUMN "field_values" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "site_collections" ADD COLUMN "fields_schema" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "site_collection_entries" ADD COLUMN "data" jsonb DEFAULT '{}'::jsonb NOT NULL;
