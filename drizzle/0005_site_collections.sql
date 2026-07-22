CREATE TABLE "site_collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "site_collections_site_id_slug_unique" UNIQUE("site_id","slug")
);

CREATE TABLE "site_collection_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"collection_id" integer NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"body" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "site_collection_entries_collection_id_slug_unique" UNIQUE("collection_id","slug")
);

ALTER TABLE "site_collections" ADD CONSTRAINT "site_collections_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "site_collection_entries" ADD CONSTRAINT "site_collection_entries_collection_id_site_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."site_collections"("id") ON DELETE cascade ON UPDATE no action;
