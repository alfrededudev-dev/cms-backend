ALTER TABLE "site_pages" ADD COLUMN "page_type" text DEFAULT 'static' NOT NULL;

UPDATE "site_pages" AS sp
SET "page_type" = 'collection'
FROM "site_collections" AS sc
WHERE sc."site_id" = sp."site_id"
  AND sc."slug" = sp."slug";
