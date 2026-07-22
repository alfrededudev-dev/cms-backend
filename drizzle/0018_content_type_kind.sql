ALTER TABLE "site_collections" ADD COLUMN "kind" text DEFAULT 'collection' NOT NULL;
ALTER TABLE "site_collections" ADD COLUMN "single_data" jsonb DEFAULT '{}' NOT NULL;
