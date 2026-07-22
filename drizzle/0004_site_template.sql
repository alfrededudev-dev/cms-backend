CREATE TABLE "site_pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "site_pages_site_id_slug_unique" UNIQUE("site_id","slug")
);

CREATE TABLE "site_page_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"page_id" integer NOT NULL,
	"component_id" integer NOT NULL,
	"variant_slug" text NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);

ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "site_page_blocks" ADD CONSTRAINT "site_page_blocks_page_id_site_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."site_pages"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "site_page_blocks" ADD CONSTRAINT "site_page_blocks_component_id_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."components"("id") ON DELETE restrict ON UPDATE no action;
