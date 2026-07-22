ALTER TABLE "site_pages" DROP CONSTRAINT IF EXISTS "site_pages_site_id_slug_unique";
--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_site_id_slug_page_type_unique" UNIQUE("site_id", "slug", "page_type");
