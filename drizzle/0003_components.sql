CREATE TABLE "components" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"icon" text DEFAULT 'LayoutTemplate' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "components_slug_unique" UNIQUE("slug")
);

CREATE TABLE "component_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"component_id" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"preview_props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "component_variants_component_id_slug_unique" UNIQUE("component_id","slug")
);

ALTER TABLE "component_variants" ADD CONSTRAINT "component_variants_component_id_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."components"("id") ON DELETE cascade ON UPDATE no action;
