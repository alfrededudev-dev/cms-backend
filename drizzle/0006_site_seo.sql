ALTER TABLE "sites" ADD COLUMN "seo_site_name" text;
ALTER TABLE "sites" ADD COLUMN "seo_title_suffix" text;
ALTER TABLE "sites" ADD COLUMN "seo_default_description" text;
ALTER TABLE "sites" ADD COLUMN "seo_default_og_image" text;
ALTER TABLE "sites" ADD COLUMN "seo_twitter_handle" text;
ALTER TABLE "sites" ADD COLUMN "seo_robots" text DEFAULT 'index,follow' NOT NULL;

CREATE TABLE "site_page_seo" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"page_slug" text NOT NULL,
	"title" text,
	"description" text,
	"og_title" text,
	"og_description" text,
	"og_image" text,
	"canonical_url" text,
	"no_index" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "site_page_seo_site_id_page_slug_unique" UNIQUE("site_id","page_slug")
);

ALTER TABLE "site_page_seo" ADD CONSTRAINT "site_page_seo_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
