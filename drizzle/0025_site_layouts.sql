CREATE TABLE "site_layouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "site_layouts_site_id_slug_unique" UNIQUE("site_id","slug")
);
--> statement-breakpoint
ALTER TABLE "site_layouts" ADD CONSTRAINT "site_layouts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "site_layouts" ("site_id", "name", "slug", "is_default", "sort_order", "created_at", "updated_at")
SELECT "id", 'Default', 'default', true, 0, NOW(), NOW() FROM "sites";
--> statement-breakpoint
ALTER TABLE "site_layout_blocks" ADD COLUMN "layout_id" integer;
--> statement-breakpoint
UPDATE "site_layout_blocks" AS slb
SET "layout_id" = sl.id
FROM "site_layouts" AS sl
WHERE sl."site_id" = slb."site_id" AND sl."is_default" = true;
--> statement-breakpoint
DELETE FROM "site_layout_blocks" WHERE "layout_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "site_layout_blocks" DROP COLUMN "site_id";
--> statement-breakpoint
DROP INDEX IF EXISTS "site_layout_blocks_site_id_idx";
--> statement-breakpoint
ALTER TABLE "site_layout_blocks" ALTER COLUMN "layout_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "site_layout_blocks" ADD CONSTRAINT "site_layout_blocks_layout_id_site_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."site_layouts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "site_pages" ADD COLUMN "layout_id" integer;
--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_layout_id_site_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."site_layouts"("id") ON DELETE set null ON UPDATE no action;
