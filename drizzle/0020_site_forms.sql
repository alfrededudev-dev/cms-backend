CREATE TABLE "site_forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"fields_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "site_forms_site_id_slug_unique" UNIQUE("site_id","slug")
);

CREATE TABLE "site_form_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"form_id" integer NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"page_url" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);

ALTER TABLE "site_forms" ADD CONSTRAINT "site_forms_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "site_form_submissions" ADD CONSTRAINT "site_form_submissions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "site_form_submissions" ADD CONSTRAINT "site_form_submissions_form_id_site_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."site_forms"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "site_form_submissions_site_id_submitted_at_idx" ON "site_form_submissions" ("site_id", "submitted_at" DESC);
CREATE INDEX "site_form_submissions_form_id_submitted_at_idx" ON "site_form_submissions" ("form_id", "submitted_at" DESC);
